-- Database-native fallback transport for Agent Feed bounded single-batch runs.
--
-- Purpose: keep the Agent Feed authority boundary available when an external
-- MCP client cannot complete tool binding/OAuth. This does NOT write optimizer
-- coverage directly. It persists the native agent_feed run/batch/evidence/
-- finding/outbox records first. An explicit, non-canonical projection carried
-- in the accepted finding may then be reflected into the user-correctable UI.
--
-- The RPC is intentionally private: no anon/authenticated grants are added.

begin;

create or replace function agent_feed.canonical_json_v01(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, agent_feed
as $$
declare
    v_result text;
begin
    case jsonb_typeof(p_value)
        when 'null' then return 'null';
        when 'boolean' then return p_value::text;
        when 'number' then return trim_scale((p_value #>> '{}')::numeric)::text;
        when 'string' then return to_jsonb(p_value #>> '{}')::text;
        when 'array' then
            select '[' || coalesce(string_agg(agent_feed.canonical_json_v01(item.value), ',' order by item.ordinality), '') || ']'
              into v_result
              from jsonb_array_elements(p_value) with ordinality as item(value, ordinality);
            return v_result;
        when 'object' then
            select '{' || coalesce(string_agg(to_jsonb(item.key)::text || ':' || agent_feed.canonical_json_v01(item.value), ',' order by item.key collate "C"), '') || '}'
              into v_result
              from jsonb_each(p_value) as item(key, value);
            return v_result;
        else
            raise exception 'Unsupported JSON value' using errcode = '22023';
    end case;
end;
$$;

create or replace function agent_feed.payload_hash_v01(p_value jsonb)
returns text
language sql
immutable
strict
set search_path = pg_catalog, agent_feed
as $$
    select encode(digest(convert_to(agent_feed.canonical_json_v01(p_value), 'UTF8'), 'sha256'), 'hex')
$$;

revoke all on function agent_feed.canonical_json_v01(jsonb) from public;
revoke all on function agent_feed.payload_hash_v01(jsonb) from public;

-- Native Agent Feed rows are already inside the Agent Feed trust boundary. A
-- deferred trigger waits until finding_evidence links have been inserted, then
-- reflects only explicit projection payloads. Future normal MCP submissions
-- benefit from the same immediate reflection path.
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
      from jsonb_array_elements_text(new.payload->'evidence_refs') with ordinality as ref(evidence_key, ordinality)
      join agent_feed.finding_evidence as fe
        on fe.finding_id = new.id and fe.tenant_id = new.tenant_id
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
      from jsonb_array_elements_text(v_projection->'family_ids') with ordinality as item(value, ordinality);
    select array_agg(item.value order by item.ordinality)
      into v_source_urls
      from jsonb_array_elements_text(v_projection->'source_urls') with ordinality as item(value, ordinality);

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
            when app_private.agent_feed_experimental_findings.status in ('disputed','quarantined','superseded')
                then app_private.agent_feed_experimental_findings.status
            else 'active_experimental'
        end;

    return new;
end;
$$;

revoke all on function app_private.reflect_native_agent_feed_experimental_finding() from public;

drop trigger if exists findings_verified_experimental_projection on agent_feed.findings;
create constraint trigger findings_verified_experimental_projection
after insert on agent_feed.findings
deferrable initially deferred
for each row
execute function app_private.reflect_native_agent_feed_experimental_finding();

create or replace function app_private.agent_feed_submit_bounded_single_batch_fallback(
    p_begin jsonb,
    p_batch jsonb,
    p_complete jsonb,
    p_tenant_id text default 'default'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_run_id uuid;
    v_wire_run_id text;
    v_run agent_feed.runs%rowtype;
    v_trace_id text;
    v_envelope jsonb;
    v_begin_hash text;
    v_batch_hash text;
    v_complete_hash text;
    v_batch_id uuid;
    v_existing_batch agent_feed.batches%rowtype;
    v_evidence jsonb;
    v_finding jsonb;
    v_evidence_id uuid;
    v_finding_id uuid;
    v_ref_count integer;
    v_found_count integer;
    v_referenced_evidence jsonb;
    v_event_payload jsonb;
    v_terminal_payload jsonb;
    v_error_summary text;
    v_counts record;
    v_event_id text;
    v_now timestamptz := now();
begin
    if current_user not in ('postgres','service_role','supabase_admin') then
        raise exception 'Agent Feed native fallback requires a trusted database role' using errcode = '42501';
    end if;
    if p_tenant_id is null or char_length(p_tenant_id) < 1 or char_length(p_tenant_id) > 200 then
        raise exception 'Invalid Agent Feed tenant' using errcode = '22023';
    end if;

    if jsonb_typeof(p_begin) is distinct from 'object'
       or p_begin->>'protocol_version' is distinct from '0.1'
       or char_length(p_begin->>'idempotency_key') < 8
       or p_begin->>'stream_id' !~ '^economy[.][a-z0-9._-]+$'
       or p_begin #>> '{producer,producer_id}' is distinct from 'chatgpt-scheduled-task'
       or p_begin #>> '{producer,type}' is distinct from 'chatgpt'
       or jsonb_typeof(p_begin->'expected_scope') is distinct from 'object'
       or jsonb_typeof(p_begin->'metadata') is distinct from 'object'
       or (p_begin->>'started_at')::timestamptz is null
    then
        raise exception 'Invalid Agent Feed begin payload' using errcode = '22023';
    end if;
    if jsonb_typeof(p_batch) is distinct from 'object'
       or p_batch->>'protocol_version' is distinct from '0.1'
       or char_length(p_batch->>'batch_id') < 1
       or char_length(p_batch->>'idempotency_key') < 8
       or (p_batch->>'sequence_number')::integer <> 1
       or jsonb_typeof(p_batch->'findings') is distinct from 'array'
       or jsonb_typeof(p_batch->'evidence') is distinct from 'array'
       or jsonb_typeof(p_batch->'metadata') is distinct from 'object'
       or jsonb_array_length(p_batch->'findings') > 100
       or jsonb_array_length(p_batch->'evidence') > 100
       or jsonb_array_length(p_batch->'findings') + jsonb_array_length(p_batch->'evidence') = 0
    then
        raise exception 'Invalid Agent Feed batch payload' using errcode = '22023';
    end if;
    if jsonb_typeof(p_complete) is distinct from 'object'
       or p_complete->>'protocol_version' is distinct from '0.1'
       or char_length(p_complete->>'idempotency_key') < 8
       or p_complete->>'status' not in ('completed','partial','failed','cancelled')
       or jsonb_typeof(p_complete->'actual_scope') is distinct from 'object'
       or jsonb_typeof(p_complete->'stats') is distinct from 'object'
       or jsonb_typeof(p_complete->'errors') is distinct from 'array'
       or jsonb_typeof(p_complete->'metadata') is distinct from 'object'
    then
        raise exception 'Invalid Agent Feed completion payload' using errcode = '22023';
    end if;
    if (p_complete->>'completed_at')::timestamptz < (p_begin->>'started_at')::timestamptz then
        raise exception 'Agent Feed completion precedes start' using errcode = '22023';
    end if;

    -- Reject unsafe evidence and hostile findings in this conservative fallback.
    if exists (
        select 1 from jsonb_array_elements(p_batch->'evidence') as item(value)
         where jsonb_typeof(item.value) is distinct from 'object'
            or char_length(item.value->>'evidence_id') < 1
            or item.value->>'kind' not in ('web','document','api','manual','other')
            or coalesce((item.value #>> '{handling,contains_personal_data}')::boolean, true)
            or coalesce((item.value #>> '{handling,contains_secrets}')::boolean, true)
            or coalesce((item.value #>> '{handling,redistribution_restricted}')::boolean, true)
    ) then
        raise exception 'Unsafe or invalid Agent Feed evidence' using errcode = '22023';
    end if;
    if exists (
        select 1 from jsonb_array_elements(p_batch->'findings') as item(value)
         where jsonb_typeof(item.value) is distinct from 'object'
            or char_length(item.value->>'finding_id') < 1
            or item.value->>'finding_type' not in ('rewards.program_change','rewards.campaign','rewards.merchant_acceptance','rewards.transfer_change','rewards.source_relocation')
            or jsonb_typeof(item.value->'evidence_refs') is distinct from 'array'
            or jsonb_typeof(item.value->'security_flags') is distinct from 'array'
            or jsonb_array_length(item.value->'security_flags') <> 0
            or jsonb_typeof(item.value->'attributes') is distinct from 'object'
            or jsonb_typeof(item.value->'assessment') is distinct from 'object'
    ) then
        raise exception 'Invalid Agent Feed finding' using errcode = '22023';
    end if;

    v_begin_hash := agent_feed.payload_hash_v01(p_begin || jsonb_build_object('tenant_id', p_tenant_id));
    v_run_id := gen_random_uuid();
    v_wire_run_id := v_run_id::text;
    v_envelope := jsonb_build_object(
        'protocol_version','0.1',
        'run_id',v_wire_run_id,
        'stream_id',p_begin->>'stream_id',
        'producer',p_begin->'producer',
        'task',p_begin->'task',
        'started_at',p_begin->>'started_at',
        'completed_at',null,
        'status','running',
        'expected_scope',p_begin->'expected_scope',
        'actual_scope',null,
        'stats',jsonb_build_object('sources_attempted',0,'sources_succeeded',0,'findings_submitted',0,'evidence_submitted',0,'batches_submitted',0),
        'parent_run_id',p_begin->'parent_run_id',
        'error_summary',null,
        'metadata',p_begin->'metadata'
    );

    insert into agent_feed.runs (
        id,wire_run_id,tenant_id,stream_id,producer_id,begin_idempotency_key,begin_payload_hash,status,envelope,started_at
    ) values (
        v_run_id,v_wire_run_id,p_tenant_id,p_begin->>'stream_id',p_begin #>> '{producer,producer_id}',p_begin->>'idempotency_key',v_begin_hash,'running',v_envelope,(p_begin->>'started_at')::timestamptz
    )
    on conflict (tenant_id,producer_id,stream_id,begin_idempotency_key) do nothing;

    select r.* into v_run
      from agent_feed.runs as r
     where r.tenant_id = p_tenant_id
       and r.producer_id = p_begin #>> '{producer,producer_id}'
       and r.stream_id = p_begin->>'stream_id'
       and r.begin_idempotency_key = p_begin->>'idempotency_key'
     for update;
    if not found or v_run.begin_payload_hash <> v_begin_hash then
        raise exception 'Agent Feed begin idempotency payload conflict' using errcode = '23505';
    end if;
    v_run_id := v_run.id;
    v_wire_run_id := v_run.wire_run_id;
    v_trace_id := v_run.trace_id;

    v_event_id := 'evt_' || v_wire_run_id || '_started';
    insert into agent_feed.outbox_events (
        id,tenant_id,event_id,event_key,event_type,protocol_version,stream_id,run_id,wire_run_id,finding_id,wire_finding_id,finding_type,routing_tags,payload,occurred_at,payload_hash,delivery_eligibility,quarantine_reason,trace_id
    ) values (
        gen_random_uuid(),p_tenant_id,v_event_id,v_event_id,'run.started','0.1',v_run.stream_id,v_run_id,v_wire_run_id,null,null,null,'[]'::jsonb,v_run.envelope,v_run.started_at,agent_feed.payload_hash_v01(v_run.envelope),'eligible',null,v_trace_id
    ) on conflict (tenant_id,event_key) do nothing;

    -- bounded-run injects the producer-visible run_id server-side.
    p_batch := p_batch || jsonb_build_object('run_id',v_wire_run_id);
    v_batch_hash := agent_feed.payload_hash_v01(p_batch || jsonb_build_object('tenant_id',p_tenant_id));

    select b.* into v_existing_batch
      from agent_feed.batches as b
     where b.run_id = v_run_id and b.idempotency_key = p_batch->>'idempotency_key';

    if found then
        if v_existing_batch.payload_hash <> v_batch_hash then
            raise exception 'Agent Feed batch idempotency payload conflict' using errcode = '23505';
        end if;
        v_batch_id := v_existing_batch.id;
    else
        if v_run.status <> 'running' then
            raise exception 'Agent Feed terminal run is immutable' using errcode = '55000';
        end if;
        if exists (select 1 from agent_feed.batches where run_id=v_run_id and batch_id=p_batch->>'batch_id') then
            raise exception 'Agent Feed batch_id conflict' using errcode = '23505';
        end if;
        v_batch_id := gen_random_uuid();
        insert into agent_feed.batches (
            id,tenant_id,run_id,batch_id,idempotency_key,sequence_number,payload_hash,submitted_at,metadata
        ) values (
            v_batch_id,p_tenant_id,v_run_id,p_batch->>'batch_id',p_batch->>'idempotency_key',1,v_batch_hash,(p_batch->>'submitted_at')::timestamptz,p_batch->'metadata'
        );

        for v_evidence in select value from jsonb_array_elements(p_batch->'evidence') loop
            if exists (select 1 from agent_feed.submitted_evidence where run_id=v_run_id and evidence_key=v_evidence->>'evidence_id') then
                raise exception 'Agent Feed duplicate evidence %', v_evidence->>'evidence_id' using errcode = '23505';
            end if;
            insert into agent_feed.submitted_evidence (id,tenant_id,run_id,batch_id,evidence_key,payload)
            values (gen_random_uuid(),p_tenant_id,v_run_id,v_batch_id,v_evidence->>'evidence_id',v_evidence);
        end loop;

        for v_finding in select value from jsonb_array_elements(p_batch->'findings') loop
            if exists (select 1 from agent_feed.findings where run_id=v_run_id and finding_key=v_finding->>'finding_id') then
                raise exception 'Agent Feed duplicate finding %', v_finding->>'finding_id' using errcode = '23505';
            end if;
            select count(*),count(distinct ref.value)
              into v_ref_count,v_found_count
              from jsonb_array_elements_text(v_finding->'evidence_refs') as ref(value);
            if v_ref_count <> v_found_count then
                raise exception 'Agent Feed repeated evidence reference' using errcode = '22023';
            end if;
            select count(*) into v_found_count
              from jsonb_array_elements_text(v_finding->'evidence_refs') as ref(value)
              join agent_feed.submitted_evidence as se
                on se.run_id=v_run_id and se.evidence_key=ref.value;
            if v_found_count <> v_ref_count then
                raise exception 'Agent Feed unresolved evidence reference' using errcode = '23503';
            end if;

            v_finding_id := gen_random_uuid();
            insert into agent_feed.findings (id,tenant_id,run_id,batch_id,finding_key,finding_type,payload)
            values (v_finding_id,p_tenant_id,v_run_id,v_batch_id,v_finding->>'finding_id',v_finding->>'finding_type',v_finding);

            insert into agent_feed.finding_evidence (tenant_id,finding_id,evidence_id)
            select p_tenant_id,v_finding_id,se.id
              from jsonb_array_elements_text(v_finding->'evidence_refs') as ref(value)
              join agent_feed.submitted_evidence as se
                on se.run_id=v_run_id and se.evidence_key=ref.value;

            select coalesce(jsonb_agg(se.payload order by ref.ordinality),'[]'::jsonb)
              into v_referenced_evidence
              from jsonb_array_elements_text(v_finding->'evidence_refs') with ordinality as ref(value,ordinality)
              join agent_feed.submitted_evidence as se
                on se.run_id=v_run_id and se.evidence_key=ref.value;
            v_event_payload := jsonb_build_object('finding',v_finding,'submitted_evidence',v_referenced_evidence);
            v_event_id := 'evt_' || v_wire_run_id || '_' || (v_finding->>'finding_id');
            insert into agent_feed.outbox_events (
                id,tenant_id,event_id,event_key,event_type,protocol_version,stream_id,run_id,wire_run_id,finding_id,wire_finding_id,finding_type,routing_tags,payload,occurred_at,payload_hash,delivery_eligibility,quarantine_reason,trace_id
            ) values (
                gen_random_uuid(),p_tenant_id,v_event_id,v_event_id,'finding.submitted','0.1',v_run.stream_id,v_run_id,v_wire_run_id,v_finding_id,v_finding->>'finding_id',v_finding->>'finding_type',coalesce(v_finding->'routing_tags','[]'::jsonb),v_event_payload,(p_batch->>'submitted_at')::timestamptz,agent_feed.payload_hash_v01(v_event_payload),'eligible',null,v_trace_id
            ) on conflict (tenant_id,event_key) do nothing;
        end loop;
    end if;

    p_complete := p_complete || jsonb_build_object('run_id',v_wire_run_id);
    v_complete_hash := agent_feed.payload_hash_v01(p_complete || jsonb_build_object('tenant_id',p_tenant_id));

    select r.* into v_run from agent_feed.runs as r where r.id=v_run_id for update;
    if v_run.status <> 'running' then
        if v_run.complete_idempotency_key is distinct from p_complete->>'idempotency_key'
           or v_run.complete_payload_hash is distinct from v_complete_hash then
            raise exception 'Agent Feed terminal run is immutable or completion idempotency conflicts' using errcode = '55000';
        end if;
        return jsonb_build_object('run_id',v_wire_run_id,'status',v_run.status,'replayed',true);
    end if;

    select
        (select count(*) from agent_feed.batches where run_id=v_run_id) as batches,
        (select count(*) from agent_feed.findings where run_id=v_run_id) as findings,
        (select count(*) from agent_feed.submitted_evidence where run_id=v_run_id) as evidence
      into v_counts;
    if (p_complete #>> '{stats,batches_submitted}')::integer <> v_counts.batches
       or (p_complete #>> '{stats,findings_submitted}')::integer <> v_counts.findings
       or (p_complete #>> '{stats,evidence_submitted}')::integer <> v_counts.evidence
       or (p_complete #>> '{stats,sources_succeeded}')::integer > (p_complete #>> '{stats,sources_attempted}')::integer
    then
        raise exception 'Agent Feed completion counts do not reconcile' using errcode = '22023';
    end if;

    select string_agg(coalesce(item.value->>'message',item.value::text),'; ' order by item.ordinality)
      into v_error_summary
      from jsonb_array_elements(p_complete->'errors') with ordinality as item(value,ordinality);

    v_envelope := v_run.envelope || jsonb_build_object(
        'completed_at',p_complete->>'completed_at',
        'status',p_complete->>'status',
        'actual_scope',p_complete->'actual_scope',
        'stats',jsonb_build_object(
            'sources_attempted',(p_complete #>> '{stats,sources_attempted}')::integer,
            'sources_succeeded',(p_complete #>> '{stats,sources_succeeded}')::integer,
            'findings_submitted',v_counts.findings,
            'evidence_submitted',v_counts.evidence,
            'batches_submitted',v_counts.batches
        ),
        'error_summary',v_error_summary,
        'metadata',p_complete->'metadata'
    );
    update agent_feed.runs
       set status=p_complete->>'status',envelope=v_envelope,completed_at=(p_complete->>'completed_at')::timestamptz,
           actual_scope=p_complete->'actual_scope',error_summary=v_error_summary,
           complete_idempotency_key=p_complete->>'idempotency_key',complete_payload_hash=v_complete_hash
     where id=v_run_id;

    v_terminal_payload := jsonb_build_object(
        'status',p_complete->>'status',
        'completed_at',p_complete->>'completed_at',
        'actual_scope',p_complete->'actual_scope',
        'expected_scope',v_run.envelope->'expected_scope',
        'stats',v_envelope->'stats',
        'error_summary',v_error_summary
    );
    v_event_id := 'evt_' || v_wire_run_id || '_terminal';
    insert into agent_feed.outbox_events (
        id,tenant_id,event_id,event_key,event_type,protocol_version,stream_id,run_id,wire_run_id,finding_id,wire_finding_id,finding_type,routing_tags,payload,occurred_at,payload_hash,delivery_eligibility,quarantine_reason,trace_id
    ) values (
        gen_random_uuid(),p_tenant_id,v_event_id,v_event_id,
        case p_complete->>'status' when 'completed' then 'run.completed' when 'partial' then 'run.partial' else 'run.failed' end,
        '0.1',v_run.stream_id,v_run_id,v_wire_run_id,null,null,null,'[]'::jsonb,v_terminal_payload,(p_complete->>'completed_at')::timestamptz,agent_feed.payload_hash_v01(v_terminal_payload),'eligible',null,v_trace_id
    ) on conflict (tenant_id,event_key) do nothing;

    return jsonb_build_object(
        'run_id',v_wire_run_id,
        'status',p_complete->>'status',
        'tenant_id',p_tenant_id,
        'stream_id',v_run.stream_id,
        'batches_submitted',v_counts.batches,
        'findings_submitted',v_counts.findings,
        'evidence_submitted',v_counts.evidence,
        'replayed',false
    );
end;
$$;

revoke all on function app_private.agent_feed_submit_bounded_single_batch_fallback(jsonb,jsonb,jsonb,text) from public;
revoke all on function app_private.agent_feed_submit_bounded_single_batch_fallback(jsonb,jsonb,jsonb,text) from anon;
revoke all on function app_private.agent_feed_submit_bounded_single_batch_fallback(jsonb,jsonb,jsonb,text) from authenticated;

comment on function app_private.agent_feed_submit_bounded_single_batch_fallback(jsonb,jsonb,jsonb,text) is
    'Private single-batch Agent Feed transport for trusted operators when external MCP binding is unavailable. Persists native Agent Feed protocol tables and outbox; never publishes canonical reward rules.';

commit;
