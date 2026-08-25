-- Reflect explicit, safe native Agent Feed findings into the existing
-- user-correctable, non-canonical experimental projection.
--
-- This trigger is deferred so the finding_evidence links created in the same
-- Agent Feed transaction are visible before the projection is admitted.

begin;

create or replace function app_private.reflect_native_agent_feed_experimental_finding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_projection jsonb := new.payload #> '{attributes,experimental_projection}';
    v_run agent_feed.runs%rowtype;
    v_family_ids text[];
    v_source_urls text[];
    v_confidence numeric;
    v_evidence_completeness text;
    v_ref_count integer;
    v_safe_count integer;
begin
    if v_projection is null then
        return new;
    end if;

    select r.* into v_run
      from agent_feed.runs as r
     where r.id = new.run_id
       and r.tenant_id = new.tenant_id;

    if not found
       or v_run.producer_id is distinct from 'chatgpt-scheduled-task'
       or v_run.stream_id !~ '^economy[.]'
    then
        raise exception 'Native Agent Feed projection is outside the approved producer scope'
            using errcode = '28000';
    end if;

    if jsonb_typeof(v_projection) is distinct from 'object'
       or array(select jsonb_object_keys(v_projection) order by 1) is distinct from
          array['claims','evidence','family_ids','finding_kind','metadata','scope','source_urls','title','version']::text[]
       or v_projection->>'version' is distinct from 'agent-feed-experimental-projection.v1'
       or jsonb_typeof(new.payload->'security_flags') is distinct from 'array'
       or jsonb_array_length(new.payload->'security_flags') <> 0
    then
        raise exception 'Native Agent Feed projection shape is invalid'
            using errcode = '22023';
    end if;

    if not app_private.is_jsonb_unique_string_array(v_projection->'family_ids')
       or jsonb_array_length(v_projection->'family_ids') not between 1 and 8
       or not app_private.is_jsonb_unique_string_array(v_projection->'source_urls')
       or jsonb_array_length(v_projection->'source_urls') not between 1 and 8
       or jsonb_typeof(v_projection->'claims') is distinct from 'array'
       or jsonb_typeof(v_projection->'evidence') is distinct from 'array'
       or jsonb_typeof(v_projection->'scope') is distinct from 'object'
       or jsonb_typeof(v_projection->'metadata') is distinct from 'object'
       or v_projection->>'finding_kind' not in ('reward','payment_acceptance','stored_value')
       or char_length(btrim(v_projection->>'title')) not between 3 and 512
    then
        raise exception 'Native Agent Feed projection fields are invalid'
            using errcode = '22023';
    end if;

    if exists (
        select 1
          from jsonb_array_elements_text(v_projection->'source_urls') as u(value)
         where u.value !~ '^https://[^[:space:]]+$'
    ) then
        raise exception 'Native Agent Feed projection source URL is invalid'
            using errcode = '22023';
    end if;

    if jsonb_typeof(new.payload->'evidence_refs') is distinct from 'array'
       or not app_private.is_jsonb_unique_string_array(new.payload->'evidence_refs')
    then
        raise exception 'Native Agent Feed evidence_refs are invalid'
            using errcode = '22023';
    end if;

    select count(*) into v_ref_count
      from jsonb_array_elements_text(new.payload->'evidence_refs');

    select count(*) into v_safe_count
      from jsonb_array_elements_text(new.payload->'evidence_refs')
           with ordinality as ref(evidence_key, ordinality)
      join agent_feed.finding_evidence as fe
        on fe.finding_id = new.id
       and fe.tenant_id = new.tenant_id
      join agent_feed.submitted_evidence as se
        on se.id = fe.evidence_id
       and se.run_id = new.run_id
       and se.evidence_key = ref.evidence_key
     where coalesce((se.payload #>> '{handling,contains_personal_data}')::boolean, true) = false
       and coalesce((se.payload #>> '{handling,contains_secrets}')::boolean, true) = false
       and coalesce((se.payload #>> '{handling,redistribution_restricted}')::boolean, true) = false;

    if v_ref_count <> v_safe_count then
        raise exception 'Native Agent Feed projection evidence is unresolved or unsafe'
            using errcode = '22023';
    end if;

    if jsonb_typeof(new.payload #> '{assessment,agent_confidence}') is distinct from 'number'
       or new.payload #>> '{assessment,evidence_completeness}' not in ('complete','partial')
    then
        raise exception 'Native Agent Feed projection assessment is invalid'
            using errcode = '22023';
    end if;

    v_confidence := (new.payload #>> '{assessment,agent_confidence}')::numeric;
    if v_confidence < 0 or v_confidence > 1 then
        raise exception 'Native Agent Feed projection confidence is invalid'
            using errcode = '22023';
    end if;
    v_evidence_completeness := new.payload #>> '{assessment,evidence_completeness}';

    select array_agg(item.value order by item.ordinality)
      into v_family_ids
      from jsonb_array_elements_text(v_projection->'family_ids')
           with ordinality as item(value, ordinality);
    select array_agg(item.value order by item.ordinality)
      into v_source_urls
      from jsonb_array_elements_text(v_projection->'source_urls')
           with ordinality as item(value, ordinality);

    insert into app_private.agent_feed_experimental_findings (
        projection_id, finding_id, run_id, stream_id, producer,
        family_ids, finding_kind, title, summary, claims, source_urls,
        evidence, confidence, evidence_completeness, scope, status,
        correction_enabled, first_reflected_at, updated_at, metadata
    ) values (
        'afp_' || md5(new.finding_key),
        new.finding_key,
        v_run.wire_run_id,
        v_run.stream_id,
        v_run.producer_id,
        v_family_ids,
        v_projection->>'finding_kind',
        btrim(v_projection->>'title'),
        new.payload->>'summary',
        v_projection->'claims',
        v_source_urls,
        v_projection->'evidence',
        v_confidence,
        v_evidence_completeness,
        v_projection->'scope',
        'active_experimental',
        true,
        new.created_at,
        now(),
        (v_projection->'metadata') || jsonb_build_object(
            'canonical', false,
            'reflection_mode', 'native_agent_feed',
            'agent_feed_internal_finding_id', new.id,
            'agent_feed_internal_run_id', new.run_id
        )
    )
    on conflict (finding_id) do update set
        run_id = excluded.run_id,
        stream_id = excluded.stream_id,
        producer = excluded.producer,
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

revoke all on function app_private.reflect_native_agent_feed_experimental_finding()
    from public;

drop trigger if exists findings_verified_experimental_projection
    on agent_feed.findings;
create constraint trigger findings_verified_experimental_projection
after insert on agent_feed.findings
deferrable initially deferred
for each row
execute function app_private.reflect_native_agent_feed_experimental_finding();

comment on function app_private.reflect_native_agent_feed_experimental_finding() is
    'Deferred projection of explicit safe native Agent Feed findings into the active user-correctable non-canonical experimental findings catalogue.';

commit;
