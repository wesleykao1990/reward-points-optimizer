-- Staged from db/0028_p0_route_graph_open_ended_windows.sql; edit the canonical source, not this file.
-- P0 route-graph projection support for one-sided applicability windows.
--
-- The generic catalogue projection deliberately keeps its historical
-- closed-calendar-window contract.  Route-graph facts also carry legitimate
-- open-ended windows (for example, effective_from with no effective_to), so
-- they need a route-specific gate.  Route windows are half-open:
-- effective_from <= local_date < effective_to, with either side nullable.

begin;

create or replace function app_private.p0_route_graph_window_active(
    p_claim_type text,
    p_reason text,
    p_applicability jsonb,
    p_effective_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
    v_from_text text;
    v_to_text text;
    v_from date;
    v_to date;
    v_local_date date;
begin
    -- Preserve the generic catalogue's unbounded-fact compatibility rule.
    -- A legacy ended/future fact, or a campaign period, still needs at least
    -- one explicit bound before it can enter an effective-at projection.
    if coalesce(p_claim_type, '') <> 'campaign_period'
       and coalesce(p_reason, '') <> 'ended_or_future_inactive'
       and (
           not (coalesce(p_applicability, '{}'::jsonb) ? 'effective_from')
           or jsonb_typeof(p_applicability->'effective_from') = 'null'
       )
       and (
           not (coalesce(p_applicability, '{}'::jsonb) ? 'effective_to')
           or jsonb_typeof(p_applicability->'effective_to') = 'null'
       )
    then
        return true;
    end if;

    if p_effective_at is null
       or jsonb_typeof(p_applicability) is distinct from 'object'
       or p_applicability->>'timezone' is distinct from 'Asia/Tokyo'
    then
        return false;
    end if;

    v_from_text := p_applicability->>'effective_from';
    v_to_text := p_applicability->>'effective_to';

    -- Either side may be absent or JSON null.  Non-null values remain
    -- strict date-only Japan boundaries; malformed dates fail closed.
    if v_from_text is not null then
        if v_from_text !~ '^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        then
            return false;
        end if;
        begin
            v_from := v_from_text::date;
        exception when others then
            return false;
        end;
    end if;

    if v_to_text is not null then
        if v_to_text !~ '^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        then
            return false;
        end if;
        begin
            v_to := v_to_text::date;
        exception when others then
            return false;
        end;
    end if;

    -- An empty or reversed half-open interval is never active.
    if v_from is not null and v_to is not null and v_from >= v_to then
        return false;
    end if;

    v_local_date := (p_effective_at at time zone 'Asia/Tokyo')::date;
    return (v_from is null or v_local_date >= v_from)
       and (v_to is null or v_local_date < v_to);
end;
$$;

revoke all on function
    app_private.p0_route_graph_window_active(text,text,jsonb,timestamptz)
    from public;

create or replace function app_private.p0_route_graph_facts_at(
    p_effective_at timestamptz
)
returns table (
    claim_id text,
    family_id text,
    source_role_id text,
    claim_type text,
    subject text,
    predicate text,
    source_ids jsonb,
    value jsonb,
    applicability jsonb,
    research_artifact_id text,
    implementation_version text,
    implementation_hash text,
    as_of timestamptz,
    source_identity jsonb,
    exclusions jsonb
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
    with current_snapshot as (
        select distinct on (snapshot.research_artifact_id)
               snapshot.snapshot_id,
               snapshot.research_artifact_id,
               snapshot.implementation_version,
               snapshot.implementation_hash,
               snapshot.as_of
          from app_private.p0_implementation_snapshots as snapshot
         order by snapshot.research_artifact_id asc,
                  snapshot.as_of desc,
                  snapshot.created_at desc,
                  snapshot.snapshot_id desc
    )
    select distinct on (fact.parent_claim_id)
        fact.parent_claim_id,
        fact.family_id,
        fact.source_role_id,
        fact.claim_type,
        fact.subject,
        fact.predicate,
        fact.source_ids,
        fact.value,
        fact.applicability,
        current_snapshot.research_artifact_id,
        current_snapshot.implementation_version,
        current_snapshot.implementation_hash,
        current_snapshot.as_of,
        fact.source_identity,
        fact.exclusions
      from app_private.p0_implementation_facts as fact
      join current_snapshot
        on current_snapshot.snapshot_id = fact.snapshot_id
     where not exists (
         select 1
           from app_private.p0_implementation_fact_corrections as correction
          where correction.fact_id = fact.fact_id
            and correction.implementation_hash = fact.implementation_hash
            and correction.parent_claim_id = fact.parent_claim_id
            and correction.fact_version = fact.fact_version
     )
       and app_private.p0_route_graph_window_active(
           fact.claim_type,
           fact.reason,
           fact.applicability,
           p_effective_at
       )
     order by fact.parent_claim_id asc, fact.fact_version desc
     limit 2049
$$;

revoke all on function
    app_private.p0_route_graph_facts_at(timestamptz)
    from public;

grant execute on function
    app_private.p0_route_graph_facts_at(timestamptz)
    to jro_runtime;

comment on function app_private.p0_route_graph_window_active(text,text,jsonb,timestamptz) is
    'Half-open Asia/Tokyo effective-date gate for route-graph facts; either applicability boundary may be null, while malformed or reversed dates fail closed.';

comment on function app_private.p0_route_graph_facts_at(timestamptz) is
    'Bounded private route-graph projection of the current uncorrected implementation facts, including exact stored source identities and exclusions. Applicability uses half-open Asia/Tokyo effective-date windows with nullable boundaries; no browser or evidence surface is widened.';

commit;
