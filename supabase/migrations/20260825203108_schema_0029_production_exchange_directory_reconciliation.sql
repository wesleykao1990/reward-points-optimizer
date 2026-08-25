-- Staged from db/0029_production_exchange_directory_reconciliation.sql; edit the canonical source, not this file.
-- Automatic Agent Feed exchange-directory reconciliation.
--
-- A signed rewards.transfer_change finding may carry one complete or partial
-- `production-exchange-directory-snapshot.v1` in raw_attributes.  The mapped
-- SourceObservation remains the transport/source record; this migration adds
-- an immutable normalized directory ledger and exposes only exact executable
-- claims to the existing route graph. Incomplete rows become explicit research
-- tasks. No background cache is required: recommendation reads see the newest
-- committed directory version on their next query.

begin;

create table app_private.production_exchange_directory_snapshots (
    snapshot_id uuid primary key default gen_random_uuid(),
    source_observation_id uuid not null unique
        references app_private.source_observations(id) on delete restrict,
    directory_id text not null,
    family_id text not null,
    source_role_id text not null,
    source_asset_id text not null,
    complete boolean not null,
    sources jsonb not null,
    payload_hash text not null,
    observed_at timestamptz not null,
    created_at timestamptz not null default now(),
    check (directory_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
    check (family_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
    check (source_role_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
    check (source_asset_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
    check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) between 1 and 64),
    check (payload_hash ~ '^sha256:[0-9a-f]{64}$')
);

create index production_exchange_directory_snapshots_current_idx
    on app_private.production_exchange_directory_snapshots
       (directory_id, observed_at desc, created_at desc, snapshot_id desc);

create table app_private.production_exchange_directory_entries (
    snapshot_id uuid not null
        references app_private.production_exchange_directory_snapshots(snapshot_id)
        on delete restrict,
    entry_id text not null,
    destination_asset_id text not null,
    disposition text not null check (disposition in (
        'exact_executable','incomplete_parameters','inactive','informational_excluded'
    )),
    primary_claim_id text,
    claims jsonb not null,
    research_request jsonb,
    created_at timestamptz not null default now(),
    primary key (snapshot_id, entry_id),
    check (entry_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
    check (destination_asset_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
    check (primary_claim_id is null or primary_claim_id ~ '^claim\.[A-Za-z0-9._:-]{1,240}$'),
    check (jsonb_typeof(claims) = 'array' and jsonb_array_length(claims) <= 16),
    check (
        (disposition = 'exact_executable'
         and primary_claim_id is not null
         and jsonb_array_length(claims) > 0
         and research_request is null)
        or
        (disposition = 'incomplete_parameters'
         and primary_claim_id is null
         and jsonb_array_length(claims) = 0
         and jsonb_typeof(research_request) = 'object')
        or
        (disposition in ('inactive','informational_excluded')
         and primary_claim_id is null
         and jsonb_array_length(claims) = 0
         and research_request is null)
    )
);

create table app_private.production_exchange_graph_change_events (
    change_event_id uuid primary key default gen_random_uuid(),
    snapshot_id uuid not null unique
        references app_private.production_exchange_directory_snapshots(snapshot_id)
        on delete restrict,
    directory_id text not null,
    rebuild_mode text not null check (rebuild_mode in ('complete_directory','changed_entries')),
    affected_asset_ids jsonb not null,
    affected_rule_ids jsonb not null,
    created_at timestamptz not null default now(),
    check (jsonb_typeof(affected_asset_ids) = 'array'),
    check (jsonb_typeof(affected_rule_ids) = 'array')
);

create table app_private.production_exchange_research_tasks (
    research_task_id uuid primary key default gen_random_uuid(),
    snapshot_id uuid not null
        references app_private.production_exchange_directory_snapshots(snapshot_id)
        on delete restrict,
    entry_id text not null,
    directory_id text not null,
    source_asset_id text not null,
    destination_asset_id text not null,
    missing_fields jsonb not null,
    question_ja text not null,
    created_at timestamptz not null default now(),
    unique (snapshot_id, entry_id),
    check (jsonb_typeof(missing_fields) = 'array' and jsonb_array_length(missing_fields) between 1 and 64),
    check (char_length(question_ja) between 1 and 500)
);

create trigger production_exchange_directory_snapshots_append_only
before update or delete on app_private.production_exchange_directory_snapshots
for each row execute function app_private.protect_agent_feed_typed_rule_append_only();
create trigger production_exchange_directory_snapshots_no_truncate
before truncate on app_private.production_exchange_directory_snapshots
for each statement execute function app_private.protect_agent_feed_typed_rule_append_only();
create trigger production_exchange_directory_entries_append_only
before update or delete on app_private.production_exchange_directory_entries
for each row execute function app_private.protect_agent_feed_typed_rule_append_only();
create trigger production_exchange_directory_entries_no_truncate
before truncate on app_private.production_exchange_directory_entries
for each statement execute function app_private.protect_agent_feed_typed_rule_append_only();
create trigger production_exchange_graph_change_events_append_only
before update or delete on app_private.production_exchange_graph_change_events
for each row execute function app_private.protect_agent_feed_typed_rule_append_only();
create trigger production_exchange_graph_change_events_no_truncate
before truncate on app_private.production_exchange_graph_change_events
for each statement execute function app_private.protect_agent_feed_typed_rule_append_only();
create trigger production_exchange_research_tasks_append_only
before update or delete on app_private.production_exchange_research_tasks
for each row execute function app_private.protect_agent_feed_typed_rule_append_only();
create trigger production_exchange_research_tasks_no_truncate
before truncate on app_private.production_exchange_research_tasks
for each statement execute function app_private.protect_agent_feed_typed_rule_append_only();

create or replace function app_private.materialize_production_exchange_directory_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_snapshot jsonb;
    v_entry jsonb;
    v_claim jsonb;
    v_source jsonb;
    v_request jsonb;
    v_transfer jsonb;
    v_snapshot_id uuid;
    v_payload_hash text;
    v_entry_ids text[] := array[]::text[];
    v_source_ids text[] := array[]::text[];
    v_affected_assets jsonb;
    v_affected_rules jsonb;
    v_source_id text;
begin
    if jsonb_typeof(new.raw_attributes) is distinct from 'object'
       or not (new.raw_attributes ? 'exchange_directory_snapshot') then
        return new;
    end if;
    v_snapshot := new.raw_attributes->'exchange_directory_snapshot';
    if new.change_type is distinct from 'transfer'
       or new.security_flags <> '[]'::jsonb
       or jsonb_typeof(v_snapshot) is distinct from 'object'
       or not app_private.is_jsonb_object_with_exact_keys(v_snapshot, array[
           'version','directory_id','family_id','source_role_id','source_asset_id',
           'complete','sources','entries'
       ])
       or v_snapshot->>'version' is distinct from 'production-exchange-directory-snapshot.v1'
       or jsonb_typeof(v_snapshot->'complete') is distinct from 'boolean'
       or jsonb_typeof(v_snapshot->'sources') is distinct from 'array'
       or jsonb_array_length(v_snapshot->'sources') not between 1 and 64
       or jsonb_typeof(v_snapshot->'entries') is distinct from 'array'
       or jsonb_array_length(v_snapshot->'entries') not between 1 and 256
       or v_snapshot->>'directory_id' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
       or v_snapshot->>'family_id' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
       or v_snapshot->>'source_role_id' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
       or v_snapshot->>'source_asset_id' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    then
        raise exception 'production exchange directory snapshot is invalid'
            using errcode = '22023';
    end if;

    for v_source in select item.value from jsonb_array_elements(v_snapshot->'sources') as item(value)
    loop
        if jsonb_typeof(v_source) is distinct from 'object'
           or not app_private.is_jsonb_object_with_exact_keys(v_source, array[
               'source_id','family_id','roles','url','publisher','official_domain'
           ])
           or v_source->>'source_id' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
           or v_source->>'family_id' is distinct from v_snapshot->>'family_id'
           or jsonb_typeof(v_source->'roles') is distinct from 'array'
           or not (v_source->'roles' @> jsonb_build_array(v_snapshot->>'source_role_id'))
           or v_source->>'url' !~ '^https://[^[:space:]]+$'
           or char_length(v_source->>'publisher') not between 1 and 512
           or char_length(v_source->>'official_domain') not between 1 and 255
        then
            raise exception 'production exchange directory source is invalid'
                using errcode = '22023';
        end if;
        v_source_id := v_source->>'source_id';
        if v_source_id = any(v_source_ids) then
            raise exception 'production exchange directory source is duplicated'
                using errcode = '22023';
        end if;
        v_source_ids := array_append(v_source_ids, v_source_id);
    end loop;

    -- Validate the complete snapshot before the first write.
    for v_entry in select item.value from jsonb_array_elements(v_snapshot->'entries') as item(value)
    loop
        if jsonb_typeof(v_entry) is distinct from 'object'
           or not app_private.is_jsonb_object_with_exact_keys(v_entry, array[
               'entry_id','destination_asset_id','disposition','primary_claim_id',
               'claims','research_request'
           ])
           or v_entry->>'entry_id' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
           or v_entry->>'destination_asset_id' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
           or v_entry->>'disposition' not in (
               'exact_executable','incomplete_parameters','inactive','informational_excluded'
           )
           or jsonb_typeof(v_entry->'claims') is distinct from 'array'
           or jsonb_array_length(v_entry->'claims') > 16
           or v_entry->>'entry_id' = any(v_entry_ids)
        then
            raise exception 'production exchange directory entry is invalid'
                using errcode = '22023';
        end if;
        v_entry_ids := array_append(v_entry_ids, v_entry->>'entry_id');

        if v_entry->>'disposition' = 'exact_executable' then
            if jsonb_typeof(v_entry->'primary_claim_id') is distinct from 'string'
               or v_entry->>'primary_claim_id' !~ '^claim\.[A-Za-z0-9._:-]{1,240}$'
               or jsonb_array_length(v_entry->'claims') = 0
               or jsonb_typeof(v_entry->'research_request') is distinct from 'null'
            then
                raise exception 'executable directory entry claim is invalid'
                    using errcode = '22023';
            end if;
            v_claim := null;
            select item.value into v_claim
              from jsonb_array_elements(v_entry->'claims') as item(value)
             where item.value->>'claim_id' = v_entry->>'primary_claim_id';
            v_transfer := v_claim #> '{value,transfer}';
            if v_claim is null
               or not (v_claim ?& array[
                   'claim_id','family_id','source_role_id','source_ids','claim_type',
                   'subject','predicate','value','applicability','exclusions'
               ])
               or v_claim->>'family_id' is distinct from v_snapshot->>'family_id'
               or v_claim->>'source_role_id' is distinct from v_snapshot->>'source_role_id'
               or v_claim->>'claim_type' is distinct from 'transfer_rule'
               or jsonb_typeof(v_claim->'source_ids') is distinct from 'array'
               or exists (
                   select 1 from jsonb_array_elements_text(v_claim->'source_ids') as source(value)
                    where not (source.value = any(v_source_ids))
               )
               or jsonb_typeof(v_claim->'applicability') is distinct from 'object'
               or jsonb_typeof(v_claim->'exclusions') is distinct from 'array'
               or jsonb_array_length(v_claim->'exclusions') <> 0
               or jsonb_typeof(v_transfer) is distinct from 'object'
               or not (v_transfer ?& array[
                   'route_id','operation','source_asset_ref','destination_asset_ref',
                   'source_units','destination_units','minimum_source_units',
                   'increment_source_units','maximum_source_units_per_request',
                   'maximum_source_units_per_period','maximum_period','fee_source_units',
                   'processing_time_days_min','processing_time_days_max',
                   'cancellation_policy','validity','prerequisite_ids','requires_rule_ids',
                   'required_conditions_ja','requires_direct_source','partial_consumption'
               ])
               or v_transfer->>'source_asset_ref' is distinct from v_snapshot->>'source_asset_id'
               or v_transfer->>'destination_asset_ref' is distinct from v_entry->>'destination_asset_id'
               or v_transfer->>'route_id' !~ '^[a-z0-9][a-z0-9.-]{1,119}$'
            then
                raise exception 'executable directory entry is not an exact structured transfer'
                    using errcode = '22023';
            end if;
        elsif v_entry->>'disposition' = 'incomplete_parameters' then
            v_request := v_entry->'research_request';
            if jsonb_typeof(v_entry->'primary_claim_id') is distinct from 'null'
               or jsonb_array_length(v_entry->'claims') <> 0
               or jsonb_typeof(v_request) is distinct from 'object'
               or not app_private.is_jsonb_object_with_exact_keys(v_request, array[
                   'missing_fields','question_ja'
               ])
               or jsonb_typeof(v_request->'missing_fields') is distinct from 'array'
               or jsonb_array_length(v_request->'missing_fields') not between 1 and 64
               or char_length(v_request->>'question_ja') not between 1 and 500
            then
                raise exception 'incomplete directory entry research request is invalid'
                    using errcode = '22023';
            end if;
        elsif jsonb_typeof(v_entry->'primary_claim_id') is distinct from 'null'
              or jsonb_array_length(v_entry->'claims') <> 0
              or jsonb_typeof(v_entry->'research_request') is distinct from 'null'
        then
            raise exception 'non-executable directory entry must not carry calculation claims'
                using errcode = '22023';
        end if;
    end loop;

    v_payload_hash := 'sha256:' || encode(
        extensions.digest(convert_to(v_snapshot::text, 'utf8'), 'sha256'), 'hex'
    );
    insert into app_private.production_exchange_directory_snapshots (
        source_observation_id, directory_id, family_id, source_role_id,
        source_asset_id, complete, sources, payload_hash, observed_at
    ) values (
        new.id, v_snapshot->>'directory_id', v_snapshot->>'family_id',
        v_snapshot->>'source_role_id', v_snapshot->>'source_asset_id',
        (v_snapshot->>'complete')::boolean, v_snapshot->'sources',
        v_payload_hash, new.created_at
    ) on conflict (source_observation_id) do nothing
    returning snapshot_id into v_snapshot_id;
    if v_snapshot_id is null then return new; end if;

    for v_entry in select item.value from jsonb_array_elements(v_snapshot->'entries') as item(value)
    loop
        insert into app_private.production_exchange_directory_entries (
            snapshot_id, entry_id, destination_asset_id, disposition,
            primary_claim_id, claims, research_request
        ) values (
            v_snapshot_id, v_entry->>'entry_id', v_entry->>'destination_asset_id',
            v_entry->>'disposition', v_entry->>'primary_claim_id',
            v_entry->'claims',
            case when jsonb_typeof(v_entry->'research_request') = 'null'
                 then null else v_entry->'research_request' end
        );
        if v_entry->>'disposition' = 'incomplete_parameters' then
            insert into app_private.production_exchange_research_tasks (
                snapshot_id, entry_id, directory_id, source_asset_id,
                destination_asset_id, missing_fields, question_ja
            ) values (
                v_snapshot_id, v_entry->>'entry_id', v_snapshot->>'directory_id',
                v_snapshot->>'source_asset_id', v_entry->>'destination_asset_id',
                v_entry #> '{research_request,missing_fields}',
                v_entry #>> '{research_request,question_ja}'
            );
        end if;
    end loop;

    select jsonb_agg(value order by value) into v_affected_assets
      from (
          select distinct value
            from unnest(array[v_snapshot->>'source_asset_id'] ||
                 array(select item.value->>'destination_asset_id'
                         from jsonb_array_elements(v_snapshot->'entries') as item(value))) as item(value)
      ) as affected;
    select jsonb_agg(value order by value) into v_affected_rules
      from (
          select distinct 'p0.transfer.' ||
                 (item.value #>> '{value,transfer,route_id}') as value
            from jsonb_array_elements(v_snapshot->'entries') as entry(value)
            cross join lateral jsonb_array_elements(entry.value->'claims') as item(value)
           where entry.value->>'disposition' = 'exact_executable'
             and item.value->>'claim_id' = entry.value->>'primary_claim_id'
      ) as affected;
    insert into app_private.production_exchange_graph_change_events (
        snapshot_id, directory_id, rebuild_mode, affected_asset_ids, affected_rule_ids
    ) values (
        v_snapshot_id, v_snapshot->>'directory_id',
        case when (v_snapshot->>'complete')::boolean then 'complete_directory'
             else 'changed_entries' end,
        coalesce(v_affected_assets, '[]'::jsonb),
        coalesce(v_affected_rules, '[]'::jsonb)
    );
    return new;
end;
$$;

create trigger source_observations_production_exchange_directory_snapshot
after insert on app_private.source_observations
for each row execute function app_private.materialize_production_exchange_directory_snapshot();

-- A complete snapshot replaces its directory. A partial snapshot replaces
-- only the entry IDs it carries and inherits untouched rows back to the most
-- recent complete snapshot. The latest observation remains authoritative: if
-- it is rejected/closed/quarantined, the directory contributes no graph rows.
create or replace function app_private.production_exchange_directory_claims_at(
    p_effective_at timestamptz
)
returns table (
    claim_id text, family_id text, source_role_id text, claim_type text,
    subject text, predicate text, source_ids jsonb, value jsonb,
    applicability jsonb, research_artifact_id text,
    implementation_version text, implementation_hash text, as_of timestamptz,
    source_identity jsonb, exclusions jsonb
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
    with latest_directory as (
        select distinct on (snapshot.directory_id)
               snapshot.*
          from app_private.production_exchange_directory_snapshots as snapshot
         order by snapshot.directory_id, snapshot.observed_at desc,
                  snapshot.created_at desc, snapshot.snapshot_id desc
    ),
    active_directory as (
        select latest.*
          from latest_directory as latest
          join app_private.source_observations as observation
            on observation.id = latest.source_observation_id
         where observation.status not in ('rejected','closed')
           and coalesce(observation.trust_state, 'untrusted') <> 'quarantined'
           and observation.security_flags = '[]'::jsonb
    ),
    last_complete as (
        select active.directory_id,
               max(snapshot.observed_at) filter (where snapshot.complete) as observed_at
          from active_directory as active
          join app_private.production_exchange_directory_snapshots as snapshot
            on snapshot.directory_id = active.directory_id
           and snapshot.observed_at <= active.observed_at
         group by active.directory_id
    ),
    current_entries as (
        select distinct on (snapshot.directory_id, entry.entry_id)
               active.snapshot_id as current_snapshot_id,
               active.payload_hash as current_payload_hash,
               active.observed_at as current_observed_at,
               active.sources as current_sources,
               snapshot.directory_id, snapshot.family_id, snapshot.source_role_id,
               snapshot.source_asset_id, entry.*
          from active_directory as active
          join last_complete as boundary on boundary.directory_id = active.directory_id
          join app_private.production_exchange_directory_snapshots as snapshot
            on snapshot.directory_id = active.directory_id
           and snapshot.observed_at <= active.observed_at
           and (boundary.observed_at is null or snapshot.observed_at >= boundary.observed_at)
          join app_private.production_exchange_directory_entries as entry
            on entry.snapshot_id = snapshot.snapshot_id
         order by snapshot.directory_id, entry.entry_id,
                  snapshot.observed_at desc, snapshot.created_at desc,
                  snapshot.snapshot_id desc
    ),
    claims as (
        select current.*, claim.value as claim
          from current_entries as current
          cross join lateral jsonb_array_elements(current.claims) as claim(value)
         where current.disposition = 'exact_executable'
    )
    select claim->>'claim_id', current.family_id, current.source_role_id,
           claim->>'claim_type', claim->>'subject', claim->>'predicate',
           claim->'source_ids', claim->'value', claim->'applicability',
           'agent-feed.exchange-directory.' || current.directory_id,
           'production-exchange-directory.v1', current.current_payload_hash,
           current.current_observed_at,
           (
               select jsonb_agg(source.value order by wanted.ordinality)
                 from jsonb_array_elements_text(claim->'source_ids') with ordinality as wanted(source_id, ordinality)
                 join lateral jsonb_array_elements(current.current_sources) as source(value)
                   on source.value->>'source_id' = wanted.source_id
           ),
           claim->'exclusions'
      from claims as current
     where app_private.p0_route_graph_window_active(
               claim->>'claim_type', null, claim->'applicability', p_effective_at
           )
     order by claim->>'claim_id'
     limit 4097
$$;

create or replace function app_private.p0_route_graph_facts_at(
    p_effective_at timestamptz
)
returns table (
    claim_id text, family_id text, source_role_id text, claim_type text,
    subject text, predicate text, source_ids jsonb, value jsonb,
    applicability jsonb, research_artifact_id text,
    implementation_version text, implementation_hash text, as_of timestamptz,
    source_identity jsonb, exclusions jsonb
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
    with current_snapshot as (
        select distinct on (snapshot.research_artifact_id)
               snapshot.snapshot_id, snapshot.research_artifact_id,
               snapshot.implementation_version, snapshot.implementation_hash,
               snapshot.as_of
          from app_private.p0_implementation_snapshots as snapshot
         order by snapshot.research_artifact_id, snapshot.as_of desc,
                  snapshot.created_at desc, snapshot.snapshot_id desc
    ),
    static_facts as (
        select distinct on (fact.parent_claim_id)
               fact.parent_claim_id as claim_id, fact.family_id, fact.source_role_id,
               fact.claim_type, fact.subject, fact.predicate, fact.source_ids,
               fact.value, fact.applicability, current.research_artifact_id,
               current.implementation_version, current.implementation_hash,
               current.as_of, fact.source_identity, fact.exclusions
          from app_private.p0_implementation_facts as fact
          join current_snapshot as current on current.snapshot_id = fact.snapshot_id
         where not exists (
             select 1 from app_private.p0_implementation_fact_corrections as correction
              where correction.fact_id = fact.fact_id
                and correction.implementation_hash = fact.implementation_hash
                and correction.parent_claim_id = fact.parent_claim_id
                and correction.fact_version = fact.fact_version
         )
           and app_private.p0_route_graph_window_active(
               fact.claim_type, fact.reason, fact.applicability, p_effective_at
           )
         order by fact.parent_claim_id, fact.fact_version desc
    ),
    all_facts as (
        select * from static_facts
        union all
        select * from app_private.production_exchange_directory_claims_at(p_effective_at)
    )
    select distinct on (fact.claim_id) fact.*
      from all_facts as fact
     order by fact.claim_id, fact.as_of desc, fact.research_artifact_id desc
     limit 4097
$$;

revoke all on app_private.production_exchange_directory_snapshots from public;
revoke all on app_private.production_exchange_directory_entries from public;
revoke all on app_private.production_exchange_graph_change_events from public;
revoke all on app_private.production_exchange_research_tasks from public;
revoke all on function app_private.materialize_production_exchange_directory_snapshot() from public;
revoke all on function app_private.production_exchange_directory_claims_at(timestamptz) from public;
revoke all on function app_private.p0_route_graph_facts_at(timestamptz) from public;
grant execute on function app_private.p0_route_graph_facts_at(timestamptz) to jro_runtime;

comment on table app_private.production_exchange_graph_change_events is
    'Immutable affected-node/rule ledger. The route graph itself is query-time current, so no asynchronous rebuild or stale cache is required.';
comment on table app_private.production_exchange_research_tasks is
    'Precise missing-parameter tasks emitted by official directory enumeration; these rows never enter calculation.';
comment on function app_private.production_exchange_directory_claims_at(timestamptz) is
    'Current exact Agent Feed directory claims after complete/partial snapshot reconciliation. Incomplete, inactive and informational rows are excluded from arithmetic.';

commit;
