-- Automatically reflect explicitly requested, signature-verified Agent Feed findings
-- into the user-correctable experimental projection consumed by catalogue and
-- optimization coverage. This path is intentionally non-canonical.

begin;

create or replace function app_private.reflect_verified_agent_feed_experimental_finding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_projection jsonb := new.raw_attributes->'experimental_projection';
    v_receipt app_private.agent_feed_receipts%rowtype;
    v_finding_id text := new.agent_feed->>'finding_id';
    v_run_id text := new.agent_feed->>'run_id';
    v_stream_id text := new.agent_feed->>'stream_id';
    v_family_ids text[];
    v_source_urls text[];
    v_finding_kind text;
    v_title text;
    v_claims jsonb;
    v_evidence jsonb;
    v_scope jsonb;
    v_metadata jsonb;
    v_confidence numeric;
    v_evidence_completeness text;
begin
    -- Projection is opt-in. Ordinary Agent Feed observations remain unchanged.
    if v_projection is null then
        return new;
    end if;

    -- Fail closed for an explicitly requested but malformed projection.
    if jsonb_typeof(v_projection) is distinct from 'object'
       or array(select jsonb_object_keys(v_projection) order by 1) is distinct from
          array['claims','evidence','family_ids','finding_kind','metadata','scope','source_urls','title','version']::text[]
       or v_projection->>'version' is distinct from 'agent-feed-experimental-projection.v1'
    then
        raise exception 'Agent Feed experimental projection shape is invalid'
            using errcode = '22023';
    end if;

    -- The source observation is not itself an authorization boundary. Require
    -- the exact durable receipt created by the signed Agent Feed consumer and
    -- bind all transport identities before projecting anything user-visible.
    select receipt.* into v_receipt
      from app_private.agent_feed_receipts as receipt
     where receipt.id = new.receipt_id
     for share;

    if not found
       or v_receipt.signature_verified is distinct from true
       or v_receipt.event_type is distinct from 'finding.submitted'
       or v_receipt.finding_id is distinct from v_finding_id
       or v_receipt.run_id is distinct from v_run_id
       or v_receipt.stream_id is distinct from v_stream_id
       or new.agent_feed->>'protocol_version' is distinct from '0.1'
    then
        raise exception 'Agent Feed experimental projection is not bound to a verified finding receipt'
            using errcode = '28000';
    end if;

    -- Never reflect quarantined or security-flagged observations.
    if coalesce(new.trust_state, 'untrusted') = 'quarantined'
       or jsonb_typeof(new.security_flags) is distinct from 'array'
       or jsonb_array_length(new.security_flags) > 0
    then
        raise exception 'Agent Feed experimental projection is security blocked'
            using errcode = '28000';
    end if;

    if not app_private.is_jsonb_unique_string_array(v_projection->'family_ids')
       or jsonb_array_length(v_projection->'family_ids') not between 1 and 8
       or not app_private.is_jsonb_unique_string_array(v_projection->'source_urls')
       or jsonb_array_length(v_projection->'source_urls') not between 1 and 8
       or jsonb_typeof(v_projection->'claims') is distinct from 'array'
       or jsonb_typeof(v_projection->'evidence') is distinct from 'array'
       or jsonb_typeof(v_projection->'scope') is distinct from 'object'
       or jsonb_typeof(v_projection->'metadata') is distinct from 'object'
       or jsonb_typeof(v_projection->'finding_kind') is distinct from 'string'
       or v_projection->>'finding_kind' not in ('reward','payment_acceptance','stored_value')
       or jsonb_typeof(v_projection->'title') is distinct from 'string'
       or char_length(btrim(v_projection->>'title')) not between 3 and 512
    then
        raise exception 'Agent Feed experimental projection fields are invalid'
            using errcode = '22023';
    end if;

    if exists (
        select 1
          from jsonb_array_elements_text(v_projection->'source_urls') as source_url(value)
         where source_url.value !~ '^https://[^[:space:]]+$'
    ) then
        raise exception 'Agent Feed experimental projection source URL is invalid'
            using errcode = '22023';
    end if;

    if v_finding_id is null or char_length(v_finding_id) < 3
       or v_run_id is null or char_length(v_run_id) < 8
       or v_stream_id is null or char_length(v_stream_id) < 1
    then
        raise exception 'Agent Feed experimental projection identity is invalid'
            using errcode = '22023';
    end if;

    v_confidence := case
        when jsonb_typeof(new.discovery_assessment->'agent_confidence') = 'number'
            then (new.discovery_assessment->>'agent_confidence')::numeric
        else null
    end;
    v_evidence_completeness := new.discovery_assessment->>'evidence_completeness';
    if v_confidence is null or v_confidence < 0 or v_confidence > 1
       or v_evidence_completeness not in ('complete','partial')
    then
        raise exception 'Agent Feed experimental projection assessment is invalid'
            using errcode = '22023';
    end if;

    select array_agg(item.value order by item.ordinality)
      into v_family_ids
      from jsonb_array_elements_text(v_projection->'family_ids')
           with ordinality as item(value, ordinality);
    select array_agg(item.value order by item.ordinality)
      into v_source_urls
      from jsonb_array_elements_text(v_projection->'source_urls')
           with ordinality as item(value, ordinality);

    v_finding_kind := v_projection->>'finding_kind';
    v_title := btrim(v_projection->>'title');
    v_claims := v_projection->'claims';
    v_evidence := v_projection->'evidence';
    v_scope := v_projection->'scope';
    v_metadata := (v_projection->'metadata') || jsonb_build_object(
        'canonical', false,
        'reflection_mode', 'verified_agent_feed',
        'signature_verified', true,
        'source_observation_id', new.id
    );

    insert into app_private.agent_feed_experimental_findings (
        projection_id, finding_id, run_id, stream_id, producer,
        family_ids, finding_kind, title, summary, claims, source_urls,
        evidence, confidence, evidence_completeness, scope, status,
        correction_enabled, first_reflected_at, updated_at, metadata
    ) values (
        'afp_' || md5(v_finding_id), v_finding_id, v_run_id, v_stream_id,
        'chatgpt-scheduled-task', v_family_ids, v_finding_kind, v_title,
        new.summary, v_claims, v_source_urls, v_evidence, v_confidence,
        v_evidence_completeness, v_scope, 'active_experimental', true,
        new.created_at, now(), v_metadata
    )
    on conflict (finding_id) do update set
        run_id = excluded.run_id,
        stream_id = excluded.stream_id,
        family_ids = excluded.family_ids,
        finding_kind = excluded.finding_kind,
        title = excluded.title,
        summary = excluded.summary,
        claims = excluded.claims,
        source_urls = excluded.source_urls,
        evidence = excluded.evidence,
        confidence = excluded.confidence,
        evidence_completeness = excluded.evidence_completeness,
        scope = excluded.scope,
        metadata = excluded.metadata,
        updated_at = now(),
        status = case
            when app_private.agent_feed_experimental_findings.status in
                 ('disputed','quarantined','superseded')
                then app_private.agent_feed_experimental_findings.status
            else 'active_experimental'
        end;

    return new;
end;
$$;

revoke all on function app_private.reflect_verified_agent_feed_experimental_finding()
    from public;

-- Trigger name sorts after the canonical-document sync and typed-rule trigger,
-- but all AFTER-trigger effects remain in the same transaction and roll back
-- together if this projection fails closed.
drop trigger if exists source_observations_verified_experimental_projection
    on app_private.source_observations;
create trigger source_observations_verified_experimental_projection
after insert on app_private.source_observations
for each row
execute function app_private.reflect_verified_agent_feed_experimental_finding();

comment on function app_private.reflect_verified_agent_feed_experimental_finding() is
    'Opt-in projection of signature-verified Agent Feed findings into the active, user-correctable, non-canonical experimental findings catalogue.';

commit;
