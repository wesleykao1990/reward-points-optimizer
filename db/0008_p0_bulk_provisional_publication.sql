-- Atomic P0 provisional-publication batches.
--
-- This remains a private experimental lane. The trusted TypeScript adapter
-- owns canonical SHA-256 computation and full contract admission. PostgreSQL
-- validates the exact transport shape, the sealed P0 role plan, source/role
-- eligibility, lifecycle state, idempotency, and all-or-nothing persistence.

begin;

create table app_private.provisional_publication_batches (
    batch_id text primary key,
    batch_hash text not null unique,
    version text not null check (version = 'provisional-publication-batch.v1'),
    plan_sha256 text not null
        references app_private.p0_source_plan_versions(plan_sha256) on delete restrict,
    published_at timestamptz not null,
    member_count integer not null check (member_count between 1 and 32),
    batch_payload jsonb not null,
    created_at timestamptz not null default now(),
    check (batch_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
    check (batch_hash ~ '^sha256:[0-9a-f]{64}$'),
    check (jsonb_typeof(batch_payload) = 'object')
);

create table app_private.provisional_publication_batch_members (
    batch_id text not null
        references app_private.provisional_publication_batches(batch_id) on delete restrict,
    ordinal integer not null check (ordinal >= 0 and ordinal < 32),
    member_id text not null,
    publication_identity text not null unique,
    candidate_id uuid not null unique
        references app_private.provisional_rule_candidates(id) on delete restrict,
    candidate_hash text not null,
    definition_hash text not null,
    created_at timestamptz not null default now(),
    primary key (batch_id, ordinal),
    unique (batch_id, member_id),
    unique (batch_id, candidate_hash),
    check (member_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
    check (length(btrim(publication_identity)) > 0),
    check (candidate_hash ~ '^sha256:[0-9a-f]{64}$'),
    check (definition_hash ~ '^sha256:[0-9a-f]{64}$')
);

comment on table app_private.provisional_publication_batches is
    'Immutable trusted-adapter receipts for atomic provisional experimental publication; never canonical rule publication.';
comment on table app_private.provisional_publication_batch_members is
    'Exact candidate/version members bound to one immutable provisional publication batch.';

create or replace function app_private.protect_provisional_publication_batch()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    if tg_op = 'TRUNCATE' then
        raise exception 'provisional publication batches cannot be truncated'
            using errcode = '55000';
    end if;
    if tg_op <> 'INSERT' then
        raise exception 'provisional publication batches are append-only'
            using errcode = '55000';
    end if;
    if coalesce(current_setting('app_private.provisional_write_context', true), '')
         <> 'publication_batch' then
        raise exception 'provisional publication batches are DB-owned'
            using errcode = '55000';
    end if;
    return new;
end;
$$;

revoke execute on function app_private.protect_provisional_publication_batch() from public;

create trigger provisional_publication_batches_append_only
before insert or update or delete on app_private.provisional_publication_batches
for each row execute function app_private.protect_provisional_publication_batch();

create trigger provisional_publication_batches_no_truncate
before truncate on app_private.provisional_publication_batches
for each statement execute function app_private.protect_provisional_publication_batch();

create trigger provisional_publication_batch_members_append_only
before insert or update or delete on app_private.provisional_publication_batch_members
for each row execute function app_private.protect_provisional_publication_batch();

create trigger provisional_publication_batch_members_no_truncate
before truncate on app_private.provisional_publication_batch_members
for each statement execute function app_private.protect_provisional_publication_batch();

create or replace function app_private.publish_provisional_candidate_batch(
    p_batch jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_batch_id text;
    v_batch_hash text;
    v_plan_sha256 text;
    v_published_at timestamptz;
    v_members jsonb;
    v_member_count integer;
    v_existing app_private.provisional_publication_batches%rowtype;
    v_member record;
    v_candidate_id uuid;
    v_candidate_status text;
begin
    if p_batch is null
       or jsonb_typeof(p_batch) is distinct from 'object'
       or not (p_batch ?& array[
           'version','batch_id','plan_sha256','published_at','batch_hash','members'
       ])
       or exists (
           select 1 from jsonb_object_keys(p_batch) as key(name)
            where key.name not in (
                'version','batch_id','plan_sha256','published_at','batch_hash','members'
            )
       )
       or jsonb_typeof(p_batch->'version') is distinct from 'string'
       or p_batch->>'version' is distinct from 'provisional-publication-batch.v1'
       or jsonb_typeof(p_batch->'batch_id') is distinct from 'string'
       or jsonb_typeof(p_batch->'plan_sha256') is distinct from 'string'
       or jsonb_typeof(p_batch->'published_at') is distinct from 'string'
       or jsonb_typeof(p_batch->'batch_hash') is distinct from 'string'
       or jsonb_typeof(p_batch->'members') is distinct from 'array'
    then
        raise exception 'publication batch representation is invalid'
            using errcode = '22023';
    end if;

    v_batch_id := p_batch->>'batch_id';
    v_batch_hash := p_batch->>'batch_hash';
    v_plan_sha256 := p_batch->>'plan_sha256';
    v_published_at := (p_batch->>'published_at')::timestamptz;
    v_members := p_batch->'members';
    v_member_count := jsonb_array_length(v_members);

    if v_batch_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
       or v_batch_hash !~ '^sha256:[0-9a-f]{64}$'
       or v_plan_sha256 is distinct from 'sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003'
       or v_published_at is null
       or v_member_count < 1
       or v_member_count > 32
    then
        raise exception 'publication batch fields are invalid'
            using errcode = '22023';
    end if;
    if not exists (
        select 1
          from app_private.p0_source_plan_versions as plan
         where plan.plan_sha256 = v_plan_sha256
           and plan.sealed_at is not null
    ) then
        raise exception 'publication batch must bind the sealed P0 source-role plan'
            using errcode = '55000';
    end if;

    -- The complete batch is checked before the first write or lifecycle call.
    for v_member in
        select item.value as payload, item.ordinality::integer - 1 as ordinal
          from jsonb_array_elements(v_members) with ordinality as item(value, ordinality)
    loop
        if jsonb_typeof(v_member.payload) is distinct from 'object'
           or not (v_member.payload ?& array[
               'member_id','candidate_hash','definition_hash','candidate_payload'
           ])
           or exists (
               select 1 from jsonb_object_keys(v_member.payload) as key(name)
                where key.name not in (
                    'member_id','candidate_hash','definition_hash','candidate_payload'
                )
           )
           or jsonb_typeof(v_member.payload->'member_id') is distinct from 'string'
           or (v_member.payload->>'member_id') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
           or jsonb_typeof(v_member.payload->'candidate_hash') is distinct from 'string'
           or (v_member.payload->>'candidate_hash') !~ '^sha256:[0-9a-f]{64}$'
           or jsonb_typeof(v_member.payload->'definition_hash') is distinct from 'string'
           or (v_member.payload->>'definition_hash') !~ '^sha256:[0-9a-f]{64}$'
           or not app_private.provisional_candidate_shape_valid(
               v_member.payload->'candidate_payload'
           )
        then
            raise exception 'publication batch member % is invalid', v_member.ordinal
                using errcode = '22023';
        end if;
        if not exists (
            select 1
              from app_private.p0_source_role_operational_state as state
             where state.plan_sha256 = v_plan_sha256
               and state.family_id = v_member.payload->'candidate_payload'->>'p0_family_id'
               and state.source_role_id = v_member.payload->'candidate_payload'->>'source_role_id'
               and state.experimental_eligible
        ) then
            raise exception 'publication member is not experimentally eligible in the sealed P0 plan'
                using errcode = '55000';
        end if;
    end loop;

    if exists (
        select 1 from jsonb_array_elements(v_members) as member(value)
         group by member.value->>'member_id' having count(*) > 1
    ) or exists (
        select 1 from jsonb_array_elements(v_members) as member(value)
         group by member.value->>'candidate_hash' having count(*) > 1
    ) or exists (
        select 1 from jsonb_array_elements(v_members) as member(value)
         where member.value->'candidate_payload' ? 'candidate_id'
         group by member.value->'candidate_payload'->>'candidate_id'
        having count(*) > 1
    ) then
        raise exception 'publication batch member, candidate, and candidate input IDs must be unique'
            using errcode = '22023';
    end if;
    if (
        select array_agg(member.value->>'candidate_hash' order by member.ordinality)
               is distinct from
               array_agg(member.value->>'candidate_hash' order by member.value->>'candidate_hash')
          from jsonb_array_elements(v_members) with ordinality as member(value, ordinality)
    ) then
        raise exception 'publication batch members must be sorted by candidate hash'
            using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_batch_id, 0));
    select * into v_existing
      from app_private.provisional_publication_batches as batch
     where batch.batch_id = v_batch_id
     for update;
    if found then
        if v_existing.batch_hash is not distinct from v_batch_hash
           and v_existing.batch_payload is not distinct from p_batch
        then
            return v_existing.member_count;
        end if;
        raise exception 'publication batch ID was reused with different content'
            using errcode = '55000';
    end if;

    -- Match all provisional lifecycle routines: candidate-hash locks first,
    -- in deterministic order, before any candidate or observation row lock.
    for v_member in
        select member.value->>'candidate_hash' as candidate_hash
          from jsonb_array_elements(v_members) as member(value)
         order by member.value->>'candidate_hash'
    loop
        perform pg_advisory_xact_lock(hashtextextended(v_member.candidate_hash, 0));
    end loop;

    perform set_config('app_private.provisional_write_context', 'publication_batch', true);
    insert into app_private.provisional_publication_batches (
        batch_id, batch_hash, version, plan_sha256, published_at,
        member_count, batch_payload
    ) values (
        v_batch_id, v_batch_hash, p_batch->>'version', v_plan_sha256,
        v_published_at, v_member_count, p_batch
    );
    perform set_config('app_private.provisional_write_context', '', true);

    for v_member in
        select item.value as payload, item.ordinality::integer - 1 as ordinal
          from jsonb_array_elements(v_members) with ordinality as item(value, ordinality)
         order by item.ordinality
    loop
        v_candidate_id := app_private.persist_provisional_rule_candidate(
            v_member.payload->>'candidate_hash',
            v_member.payload->>'definition_hash',
            v_member.payload->'candidate_payload'
        );
        select candidate.status into v_candidate_status
          from app_private.provisional_rule_candidates as candidate
         where candidate.id = v_candidate_id;
        if v_candidate_status = 'machine_checked' then
            perform app_private.activate_provisional_rule_candidate(
                v_member.payload->>'candidate_hash',
                v_published_at,
                'atomic provisional publication batch:' || v_batch_id
            );
        elsif v_candidate_status is distinct from 'active_experimental' then
            raise exception 'publication member is not activatable'
                using errcode = '55000';
        end if;

        perform set_config('app_private.provisional_write_context', 'publication_batch', true);
        insert into app_private.provisional_publication_batch_members (
            batch_id, ordinal, member_id, publication_identity, candidate_id,
            candidate_hash, definition_hash
        ) values (
            v_batch_id, v_member.ordinal, v_member.payload->>'member_id',
            coalesce(
                v_member.payload->'candidate_payload'->>'candidate_id',
                v_member.payload->>'member_id'
            ),
            v_candidate_id, v_member.payload->>'candidate_hash',
            v_member.payload->>'definition_hash'
        );
        perform set_config('app_private.provisional_write_context', '', true);
    end loop;

    return v_member_count;
exception when others then
    perform set_config('app_private.provisional_write_context', '', true);
    raise;
end;
$$;

revoke execute on function app_private.publish_provisional_candidate_batch(jsonb) from public;

create view app_api.active_experimental_provisional_publications
with (security_invoker = true, security_barrier = true) as
select
    batch.batch_id,
    batch.batch_hash,
    batch.plan_sha256,
    batch.published_at,
    member.ordinal,
    member.member_id,
    member.publication_identity,
    active.candidate_hash,
    active.definition_hash,
    active.candidate_id,
    active.p0_family_id,
    active.source_role_id,
    active.machine_checked_at
  from app_private.provisional_publication_batches as batch
  join app_private.provisional_publication_batch_members as member
    on member.batch_id = batch.batch_id
  join app_api.active_experimental_provisional_rules as active
    on active.candidate_hash = member.candidate_hash
   and active.definition_hash = member.definition_hash;

revoke all on app_private.provisional_publication_batches from public;
revoke all on app_private.provisional_publication_batch_members from public;
revoke all on app_api.active_experimental_provisional_publications from public;
revoke execute on all functions in schema app_private from public;
revoke execute on all functions in schema app_api from public;

commit;
