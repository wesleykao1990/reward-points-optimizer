-- P0 source-family and semantic-role operations control plane.
-- Planning records remain private metadata. They are not source evidence,
-- selectable products, reward rules, publication authority, or user advice.

begin;

create table app_private.p0_source_plan_versions (
    plan_sha256 text primary key
        check (plan_sha256 = 'sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003'),
    version text not null unique check (version = 'p0-source-role-plan.v0.1'),
    source_branch text not null,
    source_commit text not null check (source_commit ~ '^[0-9a-f]{40}$'),
    source_path text not null,
    source_sha256 text not null check (source_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    family_count integer not null check (family_count = 44),
    stream_count integer not null check (stream_count = 19),
    required_role_count integer not null check (required_role_count = 301),
    created_at timestamptz not null default now(),
    sealed_at timestamptz check (sealed_at is null or sealed_at >= created_at)
);

create table app_private.p0_source_families (
    plan_sha256 text not null references app_private.p0_source_plan_versions(plan_sha256) on delete restrict,
    family_id text not null check (family_id ~ '^[a-z0-9][a-z0-9._-]+$'),
    category text not null check (category in (
        'credit_card_issuer','e_money_transit','merchant','payment_wallet','point_program','regulatory'
    )),
    provider_or_scope text not null check (length(btrim(provider_or_scope)) > 0),
    priority text not null check (priority = 'P0'),
    baseline_planning_status text not null check (baseline_planning_status in ('covered','partial','missing')),
    stream_id text not null references app_private.monitor_stream_expectations(stream_id) on delete restrict,
    recommended_cadence_seconds integer not null check (
        recommended_cadence_seconds in (21600,86400,604800,2592000)
    ),
    primary key (plan_sha256, family_id)
);

create table app_private.p0_source_role_requirements (
    plan_sha256 text not null,
    family_id text not null,
    source_role_id text not null check (source_role_id ~ '^[a-z][a-z0-9_]+$'),
    primary key (plan_sha256, family_id, source_role_id),
    foreign key (plan_sha256, family_id)
        references app_private.p0_source_families(plan_sha256, family_id) on delete restrict
);

create table app_private.p0_source_role_operational_state (
    plan_sha256 text not null,
    family_id text not null,
    source_role_id text not null,
    producer_status text not null check (producer_status in ('missing','local_unverified','authorized')),
    permission_status text not null check (permission_status in (
        'not_reviewed','approved_manual','approved_automated','restricted','prohibited'
    )),
    technical_status text not null check (technical_status in (
        'unknown','plain_http','manual_capture','partner_feed','unavailable'
    )),
    liveness_status text not null check (liveness_status in (
        'unregistered','never_seen','healthy','degraded','overdue','disabled'
    )),
    evidence_status text not null check (evidence_status in (
        'absent','lead_only','discovery_only','canonical_current','canonical_stale','conservative_exclusion'
    )),
    impact_status text not null check (impact_status in ('unmapped','mapped')),
    experimental_eligible boolean not null default false,
    recorded_at timestamptz not null default now(),
    primary key (plan_sha256, family_id, source_role_id),
    foreign key (plan_sha256, family_id, source_role_id)
        references app_private.p0_source_role_requirements(plan_sha256, family_id, source_role_id)
        on delete restrict
);

create or replace function app_private.reject_p0_source_operations_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    raise exception 'P0 source-operation snapshots are immutable; add a new reviewed plan/snapshot'
        using errcode = '55000';
end;
$$;

create or replace function app_private.seal_p0_source_operations_plan()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    if tg_op <> 'UPDATE'
       or old.sealed_at is not null
       or new.sealed_at is null
       or (to_jsonb(new) - 'sealed_at') is distinct from (to_jsonb(old) - 'sealed_at')
    then
        raise exception 'P0 source-operation plan permits only its one-way seal transition'
            using errcode = '55000';
    end if;

    if (select count(*) from app_private.p0_source_families
         where plan_sha256 = new.plan_sha256) <> new.family_count
       or (select count(distinct stream_id) from app_private.p0_source_families
            where plan_sha256 = new.plan_sha256) <> new.stream_count
       or (select count(*) from app_private.p0_source_role_requirements
            where plan_sha256 = new.plan_sha256) <> new.required_role_count
       or (select count(*) from app_private.p0_source_role_operational_state
            where plan_sha256 = new.plan_sha256) <> new.required_role_count
       or (select count(*) from app_private.p0_source_families
            where plan_sha256 = new.plan_sha256 and baseline_planning_status = 'covered') <> 34
       or (select count(*) from app_private.p0_source_families
            where plan_sha256 = new.plan_sha256 and baseline_planning_status = 'partial') <> 8
       or (select count(*) from app_private.p0_source_families
            where plan_sha256 = new.plan_sha256 and baseline_planning_status = 'missing') <> 2
    then
        raise exception 'P0 source-operation plan cannot seal with incomplete or drifted contents'
            using errcode = '55000';
    end if;

    return new;
end;
$$;

create or replace function app_private.reject_p0_source_operations_insert_after_seal()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
    v_sealed_at timestamptz;
begin
    select plan.sealed_at
      into v_sealed_at
      from app_private.p0_source_plan_versions as plan
     where plan.plan_sha256 = new.plan_sha256
       for share;

    if v_sealed_at is not null then
        raise exception 'P0 source-operation plan is sealed; child inserts are forbidden'
            using errcode = '55000';
    end if;

    return new;
end;
$$;

create or replace function app_private.reject_p0_source_operations_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    raise exception 'P0 source-operation snapshots cannot be truncated'
        using errcode = '55000';
end;
$$;

create trigger p0_source_plan_versions_seal_once
before update or delete on app_private.p0_source_plan_versions
for each row execute function app_private.seal_p0_source_operations_plan();

create trigger p0_source_families_insert_before_seal
before insert on app_private.p0_source_families
for each row execute function app_private.reject_p0_source_operations_insert_after_seal();

create trigger p0_source_families_immutable
before update or delete on app_private.p0_source_families
for each row execute function app_private.reject_p0_source_operations_mutation();

create trigger p0_source_role_requirements_insert_before_seal
before insert on app_private.p0_source_role_requirements
for each row execute function app_private.reject_p0_source_operations_insert_after_seal();

create trigger p0_source_role_requirements_immutable
before update or delete on app_private.p0_source_role_requirements
for each row execute function app_private.reject_p0_source_operations_mutation();

create trigger p0_source_role_operational_state_insert_before_seal
before insert on app_private.p0_source_role_operational_state
for each row execute function app_private.reject_p0_source_operations_insert_after_seal();

create trigger p0_source_role_operational_state_immutable
before update or delete on app_private.p0_source_role_operational_state
for each row execute function app_private.reject_p0_source_operations_mutation();

create trigger p0_source_plan_versions_no_truncate
before truncate on app_private.p0_source_plan_versions
for each statement execute function app_private.reject_p0_source_operations_truncate();

create trigger p0_source_families_no_truncate
before truncate on app_private.p0_source_families
for each statement execute function app_private.reject_p0_source_operations_truncate();

create trigger p0_source_role_requirements_no_truncate
before truncate on app_private.p0_source_role_requirements
for each statement execute function app_private.reject_p0_source_operations_truncate();

create trigger p0_source_role_operational_state_no_truncate
before truncate on app_private.p0_source_role_operational_state
for each statement execute function app_private.reject_p0_source_operations_truncate();

create view app_private.p0_source_role_readiness
with (security_invoker = true, security_barrier = true)
as
select
    state.plan_sha256,
    state.family_id,
    state.source_role_id,
    family.baseline_planning_status,
    family.stream_id,
    state.experimental_eligible,
    to_jsonb(array_remove(array[
        case when state.producer_status <> 'authorized' then 'producer_not_authorized' end,
        case when state.permission_status not in ('approved_manual','approved_automated') then 'permission_not_approved' end,
        case when state.technical_status = 'unknown' then 'technical_path_unknown' end,
        case when state.technical_status = 'unavailable'
                   and state.evidence_status <> 'conservative_exclusion'
             then 'technical_path_unavailable' end,
        case when state.liveness_status <> 'healthy' then 'liveness_not_healthy' end,
        case when state.evidence_status in ('absent','lead_only','discovery_only')
             then 'canonical_evidence_missing' end,
        case when state.evidence_status = 'canonical_stale' then 'canonical_evidence_stale' end,
        case when state.impact_status <> 'mapped' then 'impact_not_mapped' end
    ]::text[], null)) as blockers,
    state.producer_status = 'authorized'
        and state.permission_status in ('approved_manual','approved_automated')
        and (
            state.technical_status in ('plain_http','manual_capture','partner_feed')
            or (
                state.technical_status = 'unavailable'
                and state.evidence_status = 'conservative_exclusion'
            )
        )
        and state.liveness_status = 'healthy'
        and state.evidence_status in ('canonical_current','conservative_exclusion')
        and state.impact_status = 'mapped' as ready
from app_private.p0_source_role_operational_state as state
join app_private.p0_source_families as family
  on family.plan_sha256 = state.plan_sha256
 and family.family_id = state.family_id;

create view app_private.p0_source_family_readiness
with (security_invoker = true, security_barrier = true)
as
select
    role.plan_sha256,
    role.family_id,
    min(role.baseline_planning_status) as baseline_planning_status,
    count(*)::integer as required_role_count,
    count(*) filter (where role.ready)::integer as ready_role_count,
    count(*) filter (where role.experimental_eligible)::integer as experimental_role_count,
    bool_and(role.ready) as ready
from app_private.p0_source_role_readiness as role
group by role.plan_sha256, role.family_id;

comment on table app_private.p0_source_families is
    'Rewards-owned P0 planning families. A covered baseline is not a support or product-SKU claim.';
comment on table app_private.p0_source_role_requirements is
    'Every semantic source role required before a P0 family can be called supported.';
comment on table app_private.p0_source_role_operational_state is
    'Immutable initial readiness facts; discovery and lead-only evidence cannot satisfy canonical readiness.';
comment on column app_private.p0_source_plan_versions.sealed_at is
    'One-way snapshot seal. Exact child counts are checked before sealing; all later mutations are rejected.';

revoke all on table app_private.p0_source_plan_versions from public;
revoke all on table app_private.p0_source_families from public;
revoke all on table app_private.p0_source_role_requirements from public;
revoke all on table app_private.p0_source_role_operational_state from public;
revoke all on table app_private.p0_source_role_readiness from public;
revoke all on table app_private.p0_source_family_readiness from public;
revoke execute on function app_private.reject_p0_source_operations_mutation() from public;
revoke execute on function app_private.seal_p0_source_operations_plan() from public;
revoke execute on function app_private.reject_p0_source_operations_insert_after_seal() from public;
revoke execute on function app_private.reject_p0_source_operations_truncate() from public;

commit;
