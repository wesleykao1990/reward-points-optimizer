-- Staged from db/0023_experimental_findings_ui_projection.sql; edit the canonical source, not this file.
-- Feed active, user-correctable non-P0 Agent Feed findings into the bounded
-- implementation-fact projection already consumed by the app information UI.

begin;

create or replace function app_private.agent_feed_experimental_fact_id(
    p_finding_id text,
    p_family_id text
)
returns uuid
language sql
immutable
strict
set search_path = pg_catalog
as $$
    select (
        substr(md5(p_finding_id || ':' || p_family_id), 1, 8) || '-' ||
        substr(md5(p_finding_id || ':' || p_family_id), 9, 4) || '-5' ||
        substr(md5(p_finding_id || ':' || p_family_id), 14, 3) || '-a' ||
        substr(md5(p_finding_id || ':' || p_family_id), 18, 3) || '-' ||
        substr(md5(p_finding_id || ':' || p_family_id), 21, 12)
    )::uuid
$$;

revoke all on function
    app_private.agent_feed_experimental_fact_id(text,text)
    from public;

create table if not exists app_private.agent_feed_experimental_finding_corrections (
    correction_id text primary key,
    fact_id uuid not null,
    finding_id text not null
        references app_private.agent_feed_experimental_findings(finding_id)
        on delete restrict,
    reason text not null,
    reported_at timestamptz not null default now(),
    check (correction_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'),
    unique (fact_id)
);

revoke all on app_private.agent_feed_experimental_finding_corrections
    from public;

create or replace function app_private.p0_active_implementation_fact_provenance_rows_at(
    p_effective_at timestamptz
)
returns table (
    fact_id uuid,
    implementation_version text,
    fact_version integer,
    family_id text,
    source_role_id text,
    source_ids jsonb,
    claim_type text,
    subject text,
    predicate text,
    short_paraphrase text,
    disposition text,
    reason text,
    reason_detail text,
    source_url text,
    checked_at timestamptz,
    effective_from text,
    effective_to text
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
    select
        fact.fact_id,
        fact.implementation_version,
        fact.fact_version,
        fact.family_id,
        fact.source_role_id,
        fact.source_ids,
        fact.claim_type,
        fact.subject,
        fact.predicate,
        fact.short_paraphrase,
        fact.disposition,
        fact.reason,
        fact.reason_detail,
        (
            select identity_item->>'url'
              from jsonb_array_elements(fact.source_identity) as identity_item
             where identity_item->>'source_id' = fact.source_ids->>0
               and identity_item->>'url' ~ '^https://[^[:space:]]+$'
             order by identity_item->>'url'
             limit 1
        ) as source_url,
        snapshot.as_of as checked_at,
        nullif(fact.applicability->>'effective_from', '') as effective_from,
        nullif(fact.applicability->>'effective_to', '') as effective_to
      from app_private.p0_implementation_facts as fact
      join app_private.p0_implementation_snapshots as snapshot
        on snapshot.snapshot_id = fact.snapshot_id
     where not exists (
         select 1
           from app_private.p0_implementation_fact_corrections as correction
          where correction.fact_id = fact.fact_id
            and correction.implementation_hash = fact.implementation_hash
            and correction.parent_claim_id = fact.parent_claim_id
            and correction.fact_version = fact.fact_version
     )
       and app_private.p0_implementation_window_active(
           fact.claim_type,
           fact.reason,
           fact.applicability,
           p_effective_at
       )

    union all

    select
        app_private.agent_feed_experimental_fact_id(
            finding.finding_id,
            family.family_id
        ) as fact_id,
        'p0-agent-feed-experimental.implementation.v1'::text,
        1,
        family.family_id,
        case
            when finding.finding_kind = 'payment_acceptance'
                then 'payment_methods'
            when family.family_id like 'point.%'
                then 'earn_rules'
            else 'stored_value_rules'
        end,
        jsonb_build_array('agent-feed:' || finding.finding_id),
        case
            when finding.finding_kind = 'payment_acceptance'
                then 'merchant_acceptance'
            when family.family_id like 'point.%'
                then 'earn_rule'
            else 'funding_rule'
        end,
        finding.title,
        case
            when finding.finding_kind = 'payment_acceptance'
                then 'is_accepted_at_scope'
            when family.family_id like 'point.%'
                then 'awards_points_per_amount'
            else 'stores_value_for_payment'
        end,
        finding.summary,
        'catalogue_fact'::text,
        'agent_feed_experimental'::text,
        'User-correctable, non-canonical Agent Feed finding.'::text,
        finding.source_urls[1],
        finding.first_reflected_at,
        null::text,
        null::text
      from app_private.agent_feed_experimental_findings as finding
      cross join lateral unnest(finding.family_ids) as family(family_id)
     where finding.status = 'active_experimental'
       and finding.correction_enabled
       and finding.first_reflected_at <= p_effective_at
       and not exists (
           select 1
             from app_private.agent_feed_experimental_finding_corrections as correction
            where correction.fact_id =
                app_private.agent_feed_experimental_fact_id(
                    finding.finding_id,
                    family.family_id
                )
       )
$$;

create or replace function app_private.record_p0_implementation_fact_correction_by_id(
    p_fact_id uuid,
    p_correction_id text,
    p_reason text
)
returns table (outcome text, fact_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_fact app_private.p0_implementation_facts%rowtype;
    v_finding app_private.agent_feed_experimental_findings%rowtype;
    v_existing app_private.agent_feed_experimental_finding_corrections%rowtype;
begin
    if p_fact_id is null then
        raise exception 'P0 implementation fact key is invalid'
            using errcode = '22023';
    end if;

    select * into v_fact
      from app_private.p0_implementation_facts as fact
     where fact.fact_id = p_fact_id
     for update;
    if found then
        return query
          select correction.outcome, correction.fact_id
            from app_private.record_p0_implementation_fact_correction(
                v_fact.parent_claim_id,
                v_fact.implementation_version,
                v_fact.implementation_hash,
                v_fact.fact_version,
                p_correction_id,
                p_reason
            ) as correction;
        return;
    end if;

    if p_correction_id is null
       or p_correction_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
       or p_reason is null
       or char_length(p_reason) < 1
       or char_length(p_reason) > 256
    then
        raise exception 'Experimental finding correction is invalid'
            using errcode = '22023';
    end if;

    select finding.* into v_finding
      from app_private.agent_feed_experimental_findings as finding
     where exists (
         select 1
           from unnest(finding.family_ids) as family(family_id)
          where app_private.agent_feed_experimental_fact_id(
                    finding.finding_id,
                    family.family_id
                ) = p_fact_id
     )
     for update;
    if not found then
        raise exception 'P0 implementation fact key was not found'
            using errcode = '23503';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_correction_id, 0));
    select * into v_existing
      from app_private.agent_feed_experimental_finding_corrections as correction
     where correction.correction_id = p_correction_id
        or correction.fact_id = p_fact_id
     order by (correction.correction_id = p_correction_id) desc
     limit 1
     for update;
    if found then
        if v_existing.correction_id = p_correction_id
           and v_existing.fact_id = p_fact_id
           and v_existing.finding_id = v_finding.finding_id
           and v_existing.reason = p_reason
        then
            return query select 'duplicate'::text, p_fact_id;
            return;
        end if;
        raise exception 'Experimental finding correction identity was reused'
            using errcode = '55000';
    end if;

    insert into app_private.agent_feed_experimental_finding_corrections
        (correction_id, fact_id, finding_id, reason)
    values
        (p_correction_id, p_fact_id, v_finding.finding_id, p_reason);

    update app_private.agent_feed_experimental_findings
       set status = 'disputed',
           updated_at = now()
     where finding_id = v_finding.finding_id
       and status = 'active_experimental';

    return query select 'recorded'::text, p_fact_id;
end;
$$;

revoke all on function
    app_private.record_p0_implementation_fact_correction_by_id(uuid,text,text)
    from public;
grant execute on function
    app_private.record_p0_implementation_fact_correction_by_id(uuid,text,text)
    to jro_runtime;

comment on function
    app_private.p0_active_implementation_fact_provenance_rows_at(timestamptz)
is 'Bounded current fact projection consumed by the app UI, including active non-canonical Agent Feed experimental findings.';

commit;
