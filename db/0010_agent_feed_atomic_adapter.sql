-- Rewards Optimizer: one atomic PostgreSQL boundary for the signed Agent Feed
-- consumer.  The HTTP consumer is still responsible for signature, replay,
-- and schema validation.  This function accepts only the exact JSON document
-- produced by AtomicPersistenceInput and delegates domain writes to the
-- existing Rewards-owned security-definer routines.
begin;

-- ----------
-- Narrow validation helpers.  They are private because callers must not be
-- able to use these helpers as a second write or validation boundary.
-- ----------

create or replace function app_private.is_agent_feed_atomic_object_keys(
    p_value jsonb,
    p_required text[],
    p_optional text[] default '{}'::text[]
) returns boolean
language sql
immutable
as $$
    select coalesce(
        jsonb_typeof(p_value) = 'object'
        and p_value ?& coalesce(p_required, '{}'::text[])
        and not exists (
            select 1
              from jsonb_object_keys(p_value) as item(key)
             where not (item.key = any(coalesce(p_required, '{}'::text[]) || coalesce(p_optional, '{}'::text[])))
        )
        and (select count(*) from jsonb_object_keys(p_value)) between
            cardinality(coalesce(p_required, '{}'::text[])) and
            cardinality(coalesce(p_required, '{}'::text[])) + cardinality(coalesce(p_optional, '{}'::text[])),
        false
    )
$$;

create or replace function app_private.is_agent_feed_atomic_string(
    p_value jsonb,
    p_min integer default 1,
    p_max integer default null
) returns boolean
language sql
immutable
as $$
    select coalesce(
        jsonb_typeof(p_value) = 'string'
        and length(p_value #>> '{}') >= p_min
        and (p_max is null or length(p_value #>> '{}') <= p_max),
        false
    )
$$;

create or replace function app_private.is_agent_feed_atomic_timestamp(
    p_value jsonb,
    p_nullable boolean default false
) returns boolean
language plpgsql
immutable
as $$
begin
    if p_value = 'null'::jsonb then
        return p_nullable;
    end if;
    if jsonb_typeof(p_value) <> 'string' then
        return false;
    end if;
    perform app_private.jsonb_timestamp(p_value);
    return true;
exception when others then
    return false;
end;
$$;

create or replace function app_private.is_agent_feed_atomic_integer(
    p_value jsonb,
    p_min numeric default 0,
    p_max numeric default 2147483647
) returns boolean
language plpgsql
immutable
as $$
declare
    v_value numeric;
begin
    if jsonb_typeof(p_value) <> 'number'
       or (p_value #>> '{}') !~ '^[0-9]+$' then
        return false;
    end if;
    v_value := (p_value #>> '{}')::numeric;
    return v_value between p_min and p_max;
exception when others then
    return false;
end;
$$;

revoke execute on function app_private.is_agent_feed_atomic_object_keys(jsonb,text[],text[]) from public;
revoke execute on function app_private.is_agent_feed_atomic_string(jsonb,integer,integer) from public;
revoke execute on function app_private.is_agent_feed_atomic_timestamp(jsonb,boolean) from public;
revoke execute on function app_private.is_agent_feed_atomic_integer(jsonb,numeric,numeric) from public;

-- ----------
-- Exact handler-document checks.
-- ----------

create or replace function app_private.assert_agent_feed_atomic_receipt(
    p_receipt jsonb
) returns void
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
    v_event_type text;
    v_finding_id jsonb;
begin
    if not app_private.is_agent_feed_atomic_object_keys(
        p_receipt,
        array[
            'event_id','protocol_version','stream_id','run_id','finding_id',
            'event_type','received_at','occurred_at','attempt','payload_hash',
            'transport_payload_hash','delivery_id','signature_timestamp',
            'signature_key_id','delivery_attempt','raw_payload',
            'processing_status','redaction_status'
        ],
        array['error_code']
    ) then
        raise exception 'atomic receipt has an invalid object shape' using errcode = '22023';
    end if;
    if not app_private.is_agent_feed_atomic_string(p_receipt->'event_id', 8, 512)
       or jsonb_typeof(p_receipt->'protocol_version') is distinct from 'string'
       or p_receipt->>'protocol_version' is distinct from '0.1'
       or not app_private.is_agent_feed_atomic_string(p_receipt->'stream_id', 1, 512)
       or not app_private.is_agent_feed_atomic_string(p_receipt->'run_id', 8, 512) then
        raise exception 'atomic receipt identity is invalid' using errcode = '22023';
    end if;

    v_finding_id := p_receipt->'finding_id';
    if v_finding_id <> 'null'::jsonb
       and not app_private.is_agent_feed_atomic_string(v_finding_id, 3, 512) then
        raise exception 'atomic receipt finding_id is invalid' using errcode = '22023';
    end if;

    if jsonb_typeof(p_receipt->'event_type') is distinct from 'string' then
        raise exception 'receipt event_type must be a JSON string' using errcode = '22023';
    end if;
    v_event_type := p_receipt->>'event_type';
    if v_event_type is null
       or v_event_type not in ('run.started','finding.submitted','run.completed','run.partial','run.failed') then
        raise exception 'atomic receipt event_type is invalid' using errcode = '22023';
    end if;
    if (v_event_type = 'finding.submitted') is distinct from (v_finding_id <> 'null'::jsonb) then
        raise exception 'atomic receipt finding_id does not match event_type' using errcode = '22023';
    end if;

    if not app_private.is_agent_feed_atomic_timestamp(p_receipt->'received_at', false)
       or not app_private.is_agent_feed_atomic_timestamp(p_receipt->'occurred_at', false)
       or not app_private.is_agent_feed_atomic_timestamp(p_receipt->'signature_timestamp', false)
       or not app_private.is_agent_feed_atomic_integer(p_receipt->'attempt', 1, 2147483647)
       or not app_private.is_agent_feed_atomic_integer(p_receipt->'delivery_attempt', 1, 2147483647)
       or not app_private.is_agent_feed_atomic_string(p_receipt->'delivery_id', 1, 512)
       or not app_private.is_agent_feed_atomic_string(p_receipt->'signature_key_id', 1, 512)
       or not app_private.is_agent_feed_atomic_string(p_receipt->'payload_hash', 71, 71)
       or not app_private.is_agent_feed_atomic_string(p_receipt->'transport_payload_hash', 71, 71)
       or p_receipt->>'payload_hash' !~ '^sha256:[0-9a-f]{64}$'
       or p_receipt->>'transport_payload_hash' !~ '^sha256:[0-9a-f]{64}$' then
        raise exception 'atomic receipt metadata is invalid' using errcode = '22023';
    end if;
    if jsonb_typeof(p_receipt->'raw_payload') is distinct from 'object'
       or jsonb_typeof(p_receipt->'processing_status') is distinct from 'string'
       or p_receipt->>'processing_status' is null
       or p_receipt->>'processing_status' not in ('received','quarantined')
       or jsonb_typeof(p_receipt->'redaction_status') is distinct from 'string'
       or p_receipt->>'redaction_status' is distinct from 'complete' then
        raise exception 'atomic receipt storage state is invalid' using errcode = '22023';
    end if;
    if p_receipt ? 'error_code'
       and not app_private.is_agent_feed_atomic_string(p_receipt->'error_code', 1, 256) then
        raise exception 'atomic receipt error_code is invalid' using errcode = '22023';
    end if;
    if p_receipt->>'processing_status' = 'quarantined'
       and (not (p_receipt ? 'error_code') or p_receipt->>'error_code' is null) then
        raise exception 'quarantined receipt requires an error_code' using errcode = '22023';
    end if;
    if p_receipt->>'processing_status' = 'received' and p_receipt ? 'error_code' then
        raise exception 'received receipt cannot carry an error_code' using errcode = '22023';
    end if;
end;
$$;

create or replace function app_private.assert_agent_feed_atomic_observation(
    p_observation jsonb
) returns void
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
begin
    if p_observation is null or p_observation = 'null'::jsonb then
        return;
    end if;
    if not app_private.is_agent_feed_atomic_object_keys(
        p_observation,
        array[
            'observation_id','agent_feed','source_ids','subjects','change_type',
            'summary','effective_time','discovery_assessment',
            'submitted_evidence_refs','canonical_evidence_ids',
            'semantic_fingerprint_version','semantic_fingerprint','status',
            'security_flags','raw_attributes','created_at','updated_at'
        ]
    ) then
        raise exception 'atomic observation has an invalid object shape' using errcode = '22023';
    end if;
    if not app_private.is_agent_feed_atomic_string(p_observation->'observation_id', 4, 256)
       or p_observation->>'observation_id' !~ '^so_[a-z0-9_-]+$'
       or not app_private.is_agent_feed_atomic_object_keys(
           p_observation->'agent_feed',
           array['protocol_version','event_id','stream_id','run_id','finding_id']
       )
       or jsonb_typeof(p_observation->'agent_feed'->'protocol_version') is distinct from 'string'
       or p_observation->'agent_feed'->>'protocol_version' is distinct from '0.1'
       or not app_private.is_agent_feed_atomic_string(p_observation->'agent_feed'->'event_id', 8, 512)
       or not app_private.is_agent_feed_atomic_string(p_observation->'agent_feed'->'stream_id', 1, 512)
       or not app_private.is_agent_feed_atomic_string(p_observation->'agent_feed'->'run_id', 8, 512)
       or not app_private.is_agent_feed_atomic_string(p_observation->'agent_feed'->'finding_id', 3, 512) then
        raise exception 'atomic observation agent_feed identity is invalid' using errcode = '22023';
    end if;
    if not app_private.is_jsonb_unique_string_array(p_observation->'source_ids')
       or not app_private.is_source_observation_subject_array(p_observation->'subjects')
       or jsonb_typeof(p_observation->'change_type') is distinct from 'string'
       or p_observation->>'change_type' is null
       or p_observation->>'change_type' not in (
           'reward_rate','eligibility','campaign','cap','merchant_acceptance',
           'funding_route','transfer','expiry','announcement','unknown'
       )
       or not app_private.is_agent_feed_atomic_string(p_observation->'summary', 3, 5000)
       or not app_private.is_agent_feed_atomic_object_keys(
           p_observation->'effective_time',
           array['occurred_at','effective_from','effective_to']
       )
       or not app_private.is_agent_feed_atomic_timestamp(p_observation->'effective_time'->'occurred_at', true)
       or not app_private.is_agent_feed_atomic_timestamp(p_observation->'effective_time'->'effective_from', true)
       or not app_private.is_agent_feed_atomic_timestamp(p_observation->'effective_time'->'effective_to', true)
       or not app_private.is_source_observation_assessment(p_observation->'discovery_assessment')
       or not app_private.is_jsonb_unique_string_array(p_observation->'submitted_evidence_refs')
       or not app_private.is_jsonb_evidence_key_array(p_observation->'canonical_evidence_ids')
       or jsonb_typeof(p_observation->'semantic_fingerprint_version') is distinct from 'number'
       or p_observation->'semantic_fingerprint_version' is distinct from '1'::jsonb
       or jsonb_typeof(p_observation->'semantic_fingerprint') is distinct from 'string'
       or p_observation->>'semantic_fingerprint' !~ '^sha256:[0-9a-f]{64}$'
       or jsonb_typeof(p_observation->'status') is distinct from 'string'
       or p_observation->>'status' is null
       or p_observation->>'status' not in ('new','duplicate','needs_evidence','needs_review','rejected','closed')
       or not app_private.is_jsonb_unique_string_array(p_observation->'security_flags')
       or jsonb_typeof(p_observation->'raw_attributes') <> 'object'
       or not app_private.is_agent_feed_atomic_timestamp(p_observation->'created_at', false)
       or not app_private.is_agent_feed_atomic_timestamp(p_observation->'updated_at', false) then
        raise exception 'atomic observation fields are invalid' using errcode = '22023';
    end if;
    if jsonb_array_length(p_observation->'canonical_evidence_ids') <> 0 then
        raise exception 'atomic observation cannot carry canonical evidence' using errcode = '22023';
    end if;
end;
$$;

create or replace function app_private.assert_agent_feed_atomic_submitted_payload(
    p_payload jsonb
) returns void
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
begin
    if not app_private.is_agent_feed_atomic_object_keys(
        p_payload,
        array[
            'evidence_id','kind','source','captured_at','published_at','locator',
            'excerpt','content_hash','artifact','handling','metadata'
        ]
    ) then
        raise exception 'atomic submitted evidence payload has an invalid object shape' using errcode = '22023';
    end if;
    if not app_private.is_agent_feed_atomic_string(p_payload->'evidence_id', 3, 512)
       or jsonb_typeof(p_payload->'kind') is distinct from 'string'
       or p_payload->>'kind' is null
       or p_payload->>'kind' not in ('web','document','email','api','social_post','database','human_observation','file','other')
       or not app_private.is_agent_feed_atomic_object_keys(
           p_payload->'source', array['uri','title','publisher','source_id']
       )
       or not app_private.is_agent_feed_atomic_timestamp(p_payload->'captured_at', false)
       or not app_private.is_agent_feed_atomic_timestamp(p_payload->'published_at', true)
       or jsonb_typeof(p_payload->'locator') not in ('object','null')
       or jsonb_typeof(p_payload->'excerpt') not in ('string','null')
       or jsonb_typeof(p_payload->'content_hash') not in ('string','null')
       or jsonb_typeof(p_payload->'artifact') <> 'object'
       or jsonb_typeof(p_payload->'handling') <> 'object'
       or jsonb_typeof(p_payload->'metadata') <> 'object' then
        raise exception 'atomic submitted evidence payload fields are invalid' using errcode = '22023';
    end if;
    if p_payload->'source'->'uri' <> 'null'::jsonb
       and not app_private.is_agent_feed_atomic_string(p_payload->'source'->'uri', 1, 4096) then
        raise exception 'atomic submitted evidence source uri is invalid' using errcode = '22023';
    end if;
    if p_payload->'source'->'title' <> 'null'::jsonb
       and jsonb_typeof(p_payload->'source'->'title') <> 'string' then
        raise exception 'atomic submitted evidence source title is invalid' using errcode = '22023';
    end if;
    if p_payload->'source'->'publisher' <> 'null'::jsonb
       and jsonb_typeof(p_payload->'source'->'publisher') <> 'string' then
        raise exception 'atomic submitted evidence source publisher is invalid' using errcode = '22023';
    end if;
    if p_payload->'source'->'source_id' <> 'null'::jsonb
       and not app_private.is_agent_feed_atomic_string(p_payload->'source'->'source_id', 1, 512) then
        raise exception 'atomic submitted evidence source_id is invalid' using errcode = '22023';
    end if;
    if p_payload->'locator' <> 'null'::jsonb
       and (
           not app_private.is_agent_feed_atomic_object_keys(p_payload->'locator', array['type','value','page'])
           or not app_private.is_agent_feed_atomic_string(p_payload->'locator'->'type', 1, 256)
           or not app_private.is_agent_feed_atomic_string(p_payload->'locator'->'value', 1, 4096)
           or (p_payload->'locator'->'page' <> 'null'::jsonb
               and not app_private.is_agent_feed_atomic_integer(p_payload->'locator'->'page', 1, 2147483647))
       ) then
        raise exception 'atomic submitted evidence locator is invalid' using errcode = '22023';
    end if;
    if p_payload->'excerpt' <> 'null'::jsonb
       and length(p_payload->>'excerpt') > 5000 then
        raise exception 'atomic submitted evidence excerpt is invalid' using errcode = '22023';
    end if;
    if p_payload->'content_hash' <> 'null'::jsonb
       and (not app_private.is_agent_feed_atomic_string(p_payload->'content_hash', 71, 71)
            or p_payload->>'content_hash' !~ '^sha256:[0-9a-f]{64}$') then
        raise exception 'atomic submitted evidence content hash is invalid' using errcode = '22023';
    end if;
    if not app_private.is_agent_feed_atomic_object_keys(
           p_payload->'artifact', array['uri','media_type','size_bytes']
       )
       or p_payload->'artifact'->'uri' <> 'null'::jsonb
          and not app_private.is_agent_feed_atomic_string(p_payload->'artifact'->'uri', 1, 4096)
       or p_payload->'artifact'->'media_type' <> 'null'::jsonb
          and not app_private.is_agent_feed_atomic_string(p_payload->'artifact'->'media_type', 1, 256)
       or p_payload->'artifact'->'size_bytes' <> 'null'::jsonb
          and not app_private.is_agent_feed_atomic_integer(p_payload->'artifact'->'size_bytes', 0, 2147483647) then
        raise exception 'atomic submitted evidence artifact is invalid' using errcode = '22023';
    end if;
    if not app_private.is_agent_feed_atomic_object_keys(
           p_payload->'handling',
           array['contains_personal_data','contains_secrets','redistribution_restricted']
       )
       or jsonb_typeof(p_payload->'handling'->'contains_personal_data') <> 'boolean'
       or jsonb_typeof(p_payload->'handling'->'contains_secrets') <> 'boolean'
       or jsonb_typeof(p_payload->'handling'->'redistribution_restricted') <> 'boolean' then
        raise exception 'atomic submitted evidence handling is invalid' using errcode = '22023';
    end if;
end;
$$;

create or replace function app_private.assert_agent_feed_atomic_evidence_leads(
    p_leads jsonb
) returns void
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
    v_item jsonb;
begin
    if jsonb_typeof(p_leads) <> 'array' then
        raise exception 'atomic submitted_evidence must be an array' using errcode = '22023';
    end if;
    if exists (
        select 1
          from jsonb_array_elements(p_leads) as item(value)
         where jsonb_typeof(item.value) <> 'object'
            or not app_private.is_agent_feed_atomic_object_keys(
                item.value,
                array['observation_id','agent_feed_evidence_id','submitted_payload','promotion_status']
            )
    ) then
        raise exception 'atomic submitted evidence lead has an invalid object shape' using errcode = '22023';
    end if;
    if exists (
        select 1
          from jsonb_array_elements(p_leads) as item(value)
         where not app_private.is_agent_feed_atomic_string(item.value->'observation_id', 4, 256)
            or item.value->>'observation_id' !~ '^so_[a-z0-9_-]+$'
            or not app_private.is_agent_feed_atomic_string(item.value->'agent_feed_evidence_id', 3, 512)
            or jsonb_typeof(item.value->'promotion_status') is distinct from 'string'
            or item.value->>'promotion_status' is null
            or item.value->>'promotion_status' not in ('lead_only','rejected')
    ) then
        raise exception 'atomic submitted evidence lead fields are invalid' using errcode = '22023';
    end if;
    if (select count(*) from jsonb_array_elements(p_leads)) <>
       (select count(distinct item.value->>'agent_feed_evidence_id') from jsonb_array_elements(p_leads) as item(value)) then
        raise exception 'atomic submitted evidence ids must be unique' using errcode = '22023';
    end if;
    for v_item in select value from jsonb_array_elements(p_leads) as item(value) loop
        perform app_private.assert_agent_feed_atomic_submitted_payload(v_item->'submitted_payload');
        if v_item->>'agent_feed_evidence_id' <> v_item->'submitted_payload'->>'evidence_id' then
            raise exception 'atomic submitted evidence id does not match its payload' using errcode = '22023';
        end if;
    end loop;
end;
$$;

create or replace function app_private.assert_agent_feed_atomic_lifecycle(
    p_lifecycle jsonb
) returns void
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
    v_kind text;
    v_status text;
begin
    if p_lifecycle is null or p_lifecycle = 'null'::jsonb then
        return;
    end if;
    v_kind := p_lifecycle->>'kind';
    if v_kind = 'started' then
        if not app_private.is_agent_feed_atomic_object_keys(
            p_lifecycle,
            array['kind','stream_id','run_id','event_id','status','completed_at',
                  'findings_submitted','completed_zero_findings','absent_run','expected_scope']
        ) then
            raise exception 'started lifecycle has an invalid object shape' using errcode = '22023';
        end if;
    elsif v_kind = 'terminal' then
        if not app_private.is_agent_feed_atomic_object_keys(
            p_lifecycle,
            array['kind','stream_id','run_id','event_id','status','completed_at',
                  'findings_submitted','completed_zero_findings','absent_run',
                  'actual_scope','expected_scope','error_summary']
        ) then
            raise exception 'terminal lifecycle has an invalid object shape' using errcode = '22023';
        end if;
    else
        raise exception 'lifecycle kind is invalid' using errcode = '22023';
    end if;
    if not app_private.is_agent_feed_atomic_string(p_lifecycle->'stream_id', 1, 512)
       or not app_private.is_agent_feed_atomic_string(p_lifecycle->'run_id', 8, 512)
       or not app_private.is_agent_feed_atomic_string(p_lifecycle->'event_id', 8, 512)
       or jsonb_typeof(p_lifecycle->'completed_zero_findings') is distinct from 'boolean'
       or jsonb_typeof(p_lifecycle->'absent_run') is distinct from 'boolean'
       or p_lifecycle->>'absent_run' is distinct from 'false' then
        raise exception 'lifecycle identity or flags are invalid' using errcode = '22023';
    end if;
    v_status := p_lifecycle->>'status';
    if v_kind = 'started' then
        if jsonb_typeof(p_lifecycle->'status') is distinct from 'string'
           or v_status is distinct from 'running'
           or p_lifecycle->'completed_at' <> 'null'::jsonb
           or p_lifecycle->'findings_submitted' <> 'null'::jsonb
           or jsonb_typeof(p_lifecycle->'expected_scope') not in ('object','null') then
            raise exception 'started lifecycle fields are invalid' using errcode = '22023';
        end if;
    else
        if jsonb_typeof(p_lifecycle->'status') is distinct from 'string'
           or v_status is null
           or v_status not in ('completed','partial','failed','cancelled')
           or not app_private.is_agent_feed_atomic_timestamp(p_lifecycle->'completed_at', false)
           or not app_private.is_agent_feed_atomic_integer(p_lifecycle->'findings_submitted', 0, 2147483647)
           or jsonb_typeof(p_lifecycle->'actual_scope') <> 'object'
           or jsonb_typeof(p_lifecycle->'expected_scope') <> 'object'
           or (p_lifecycle->'error_summary' <> 'null'::jsonb
               and jsonb_typeof(p_lifecycle->'error_summary') <> 'string') then
            raise exception 'terminal lifecycle fields are invalid' using errcode = '22023';
        end if;
        if p_lifecycle->>'completed_zero_findings' is distinct from
           (case when v_status = 'completed' and (p_lifecycle->>'findings_submitted')::numeric = 0 then 'true' else 'false' end) then
            raise exception 'terminal lifecycle zero-finding flag is inconsistent' using errcode = '22023';
        end if;
    end if;
end;
$$;

create or replace function app_private.assert_agent_feed_atomic_input(
    p_input jsonb
) returns void
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
    v_receipt jsonb;
    v_observation jsonb;
    v_lifecycle jsonb;
    v_quarantine boolean;
    v_event_type text;
begin
    if not app_private.is_agent_feed_atomic_object_keys(
        p_input,
        array['receipt','observation','submitted_evidence','run_lifecycle'],
        array['quarantine_reason']
    ) then
        raise exception 'atomic input has an invalid object shape' using errcode = '22023';
    end if;
    v_receipt := p_input->'receipt';
    v_observation := p_input->'observation';
    v_lifecycle := p_input->'run_lifecycle';
    v_quarantine := p_input ? 'quarantine_reason';
    perform app_private.assert_agent_feed_atomic_receipt(v_receipt);
    perform app_private.assert_agent_feed_atomic_observation(v_observation);
    perform app_private.assert_agent_feed_atomic_evidence_leads(p_input->'submitted_evidence');
    perform app_private.assert_agent_feed_atomic_lifecycle(v_lifecycle);

    if v_quarantine then
        if not app_private.is_agent_feed_atomic_string(p_input->'quarantine_reason', 1, 256)
           or v_receipt->>'processing_status' <> 'quarantined'
           or v_lifecycle is not null and v_lifecycle <> 'null'::jsonb then
            raise exception 'quarantine input is inconsistent' using errcode = '22023';
        end if;
    elsif v_receipt->>'processing_status' <> 'received' then
        raise exception 'non-quarantine input must be received' using errcode = '22023';
    end if;

    v_event_type := v_receipt->>'event_type';
    if v_observation is not null and v_observation <> 'null'::jsonb then
        if v_lifecycle is not null and v_lifecycle <> 'null'::jsonb
           or v_event_type <> 'finding.submitted' then
            raise exception 'observation input is inconsistent with event type' using errcode = '22023';
        end if;
        if v_observation->'agent_feed'->>'protocol_version' <> v_receipt->>'protocol_version'
           or v_observation->'agent_feed'->>'event_id' <> v_receipt->>'event_id'
           or v_observation->'agent_feed'->>'stream_id' <> v_receipt->>'stream_id'
           or v_observation->'agent_feed'->>'run_id' <> v_receipt->>'run_id'
           or v_observation->'agent_feed'->>'finding_id' <> v_receipt->>'finding_id' then
            raise exception 'observation Agent Feed identity does not match receipt' using errcode = '22023';
        end if;
        if exists (
            select 1
              from jsonb_array_elements(p_input->'submitted_evidence') as item(value)
             where item.value->>'observation_id' <> v_observation->>'observation_id'
        ) then
            raise exception 'submitted evidence observation_id does not match observation' using errcode = '22023';
        end if;
        if (select count(*) from jsonb_array_elements(v_observation->'submitted_evidence_refs')) <>
           (select count(*) from jsonb_array_elements(p_input->'submitted_evidence'))
           or exists (
               select 1
                 from jsonb_array_elements_text(v_observation->'submitted_evidence_refs') as ref(value)
                where not exists (
                    select 1
                      from jsonb_array_elements(p_input->'submitted_evidence') as item(value)
                     where item.value->>'agent_feed_evidence_id' = ref.value
                )
           )
           or exists (
               select 1
                 from jsonb_array_elements(p_input->'submitted_evidence') as item(value)
                where not exists (
                    select 1
                      from jsonb_array_elements_text(v_observation->'submitted_evidence_refs') as ref(value)
                     where ref.value = item.value->>'agent_feed_evidence_id'
                )
           ) then
            raise exception 'submitted evidence ids must exactly match observation submitted_evidence_refs'
                using errcode = '22023';
        end if;
    elsif jsonb_array_length(p_input->'submitted_evidence') <> 0 then
        raise exception 'submitted evidence requires an observation' using errcode = '22023';
    end if;

    if not v_quarantine then
        if v_event_type = 'finding.submitted' then
            if v_observation is null or v_observation = 'null'::jsonb
               or v_lifecycle is not null and v_lifecycle <> 'null'::jsonb then
                raise exception 'finding input must carry an observation only' using errcode = '22023';
            end if;
        elsif v_observation is not null and v_observation <> 'null'::jsonb
           or v_lifecycle is null or v_lifecycle = 'null'::jsonb then
            raise exception 'run input must carry a lifecycle only' using errcode = '22023';
        end if;
    end if;

    if v_lifecycle is not null and v_lifecycle <> 'null'::jsonb then
        if v_lifecycle->>'stream_id' <> v_receipt->>'stream_id'
           or v_lifecycle->>'run_id' <> v_receipt->>'run_id'
           or v_lifecycle->>'event_id' <> v_receipt->>'event_id'
           or (v_receipt->>'event_type' = 'run.started' and v_lifecycle->>'kind' <> 'started')
           or (v_receipt->>'event_type' <> 'run.started' and v_lifecycle->>'kind' <> 'terminal') then
            raise exception 'lifecycle identity does not match receipt' using errcode = '22023';
        end if;
        if v_lifecycle->>'kind' = 'terminal'
           and (
               (v_receipt->>'event_type' = 'run.completed' and v_lifecycle->>'status' <> 'completed')
               or (v_receipt->>'event_type' = 'run.partial' and v_lifecycle->>'status' <> 'partial')
               or (v_receipt->>'event_type' = 'run.failed'
                   and v_lifecycle->>'status' not in ('failed','cancelled'))
           ) then
            raise exception 'terminal lifecycle status does not match receipt event_type'
                using errcode = '22023';
        end if;
    end if;
end;
$$;

revoke execute on function app_private.assert_agent_feed_atomic_receipt(jsonb) from public;
revoke execute on function app_private.assert_agent_feed_atomic_observation(jsonb) from public;
revoke execute on function app_private.assert_agent_feed_atomic_submitted_payload(jsonb) from public;
revoke execute on function app_private.assert_agent_feed_atomic_evidence_leads(jsonb) from public;
revoke execute on function app_private.assert_agent_feed_atomic_lifecycle(jsonb) from public;
revoke execute on function app_private.assert_agent_feed_atomic_input(jsonb) from public;

-- Existing persistence exposes terminal-run recording but not the started state.
-- Keep that insert behind the same private security-definer boundary.
create or replace function app_private.record_agent_feed_started(
    p_stream_id text,
    p_run_id text,
    p_event_id text,
    p_expected_scope jsonb,
    p_started_at timestamptz
) returns table (lifecycle_id uuid, inserted boolean)
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
    v_id uuid;
    v_inserted boolean;
    v_expected jsonb := coalesce(p_expected_scope, '{}'::jsonb);
    v_existing jsonb;
begin
    if p_stream_id is null or length(btrim(p_stream_id)) = 0
       or p_run_id is null or length(btrim(p_run_id)) = 0
       or p_event_id is null or length(btrim(p_event_id)) < 8
       or jsonb_typeof(v_expected) <> 'object'
       or p_started_at is null then
        raise exception 'started lifecycle identity is invalid' using errcode = '22023';
    end if;
    insert into app_private.agent_feed_run_lifecycle (
        stream_id, run_id, replay_attempt, replay_of_run_id, run_state,
        terminal_status, expected_scope, actual_scope, finding_count,
        started_at, terminal_at
    ) values (
        p_stream_id, p_run_id, 0, null, 'started', null, v_expected,
        '{}'::jsonb, 0, p_started_at, null
    ) on conflict (stream_id, run_id, replay_attempt) do nothing
    returning id into v_id;
    v_inserted := v_id is not null;
    if not v_inserted then
        select id, expected_scope into v_id, v_existing
          from app_private.agent_feed_run_lifecycle
         where stream_id = p_stream_id and run_id = p_run_id and replay_attempt = 0
         for update;
        if v_id is null then
            raise exception 'started lifecycle row disappeared' using errcode = '40001';
        end if;
        if v_existing <> v_expected and (select run_state from app_private.agent_feed_run_lifecycle where id = v_id) = 'started' then
            raise exception 'started lifecycle scope mismatch' using errcode = '22000';
        end if;
    end if;
    return query select v_id, v_inserted;
end;
$$;

revoke execute on function app_private.record_agent_feed_started(text,text,text,jsonb,timestamptz) from public;

-- ----------
-- Atomic receipt + mapping/lifecycle wrapper.
-- ----------

create or replace function app_private.persist_agent_feed_atomic(
    p_input jsonb
) returns table (
    receipt_id uuid,
    status text,
    observation jsonb,
    duplicate_kind text,
    duplicate_of_receipt_id uuid,
    reason_code text
)
language plpgsql
security definer
set search_path = app_private, pg_catalog
as $$
declare
    v_accept record;
    v_map record;
    v_started record;
    v_receipt app_private.agent_feed_receipts%rowtype;
    v_observation jsonb;
    v_lifecycle jsonb;
    v_reason text;
    v_observation_id uuid;
    v_duplicate_receipt_id uuid;
    v_started_at timestamptz;
    v_existing_terminal boolean;
    v_existing_run_state text;
begin
    perform app_private.assert_agent_feed_atomic_input(p_input);

    select * into v_accept
      from app_private.accept_agent_feed_event(
          p_input->'receipt'->>'event_id',
          p_input->'receipt'->>'protocol_version',
          p_input->'receipt'->>'stream_id',
          p_input->'receipt'->>'run_id',
          nullif(p_input->'receipt'->>'finding_id', ''),
          p_input->'receipt'->>'event_type',
          p_input->'receipt'->>'delivery_id',
          app_private.jsonb_timestamp(p_input->'receipt'->'signature_timestamp'),
          p_input->'receipt'->>'signature_key_id',
          (p_input->'receipt'->>'delivery_attempt')::integer,
          p_input->'receipt'->>'payload_hash',
          p_input->'receipt'->>'transport_payload_hash',
          p_input->'receipt'->'raw_payload',
          true,
          app_private.jsonb_timestamp(p_input->'receipt'->'received_at')
      );

    select r.* into v_receipt
      from app_private.agent_feed_receipts as r
     where r.id = v_accept.receipt_id
     for update;
    if not found then
        raise exception 'atomic receipt disappeared' using errcode = '40001';
    end if;

    -- A completed receipt is the transport-level idempotency boundary.  Do not
    -- replay mapping/evidence/lifecycle side effects on a retry.
    if not v_accept.inserted and v_receipt.processing_status in ('mapped','duplicate','quarantined','failed') then
        select l.observation_id into v_observation_id
          from app_private.source_observation_transport_links as l
         where l.receipt_id = v_receipt.id;
        if v_observation_id is not null then
            select canonical_document into v_observation
              from app_private.source_observations where id = v_observation_id;
        end if;
        return query select v_receipt.id,
            case when v_receipt.processing_status = 'quarantined' then 'quarantined' else 'duplicate' end,
            v_observation, 'transport'::text, null::uuid, v_receipt.error_code;
        return;
    end if;

    if p_input ? 'quarantine_reason' then
        v_reason := p_input->>'quarantine_reason';
        update app_private.agent_feed_receipts
           set processing_status = 'quarantined', error_code = v_reason,
               raw_payload = '{}'::jsonb, redaction_status = 'complete',
               acknowledged_at = coalesce(acknowledged_at, now())
         where id = v_receipt.id;
        insert into app_private.source_observation_transport_links (
            receipt_id, link_status, linked_at, reason_code
        ) values (v_receipt.id, 'quarantined', now(), v_reason)
        on conflict on constraint source_observation_transport_links_pkey do nothing;
        insert into app_private.agent_feed_dead_letters (
            receipt_id, event_id, reason_code, diagnostic, redaction_status, redacted_at
        ) values (
            v_receipt.id, v_receipt.event_id, v_reason, '{}'::jsonb, 'complete', now()
        ) on conflict (event_id) where replay_status in ('not_requested','requested','in_progress')
          do update set last_failed_at = now();
        return query select v_receipt.id, 'quarantined'::text, null::jsonb,
            null::text, null::uuid, v_reason;
        return;
    end if;

    v_observation := p_input->'observation';
    if v_observation is not null and v_observation <> 'null'::jsonb then
        select * into v_map
          from app_private.map_agent_feed_finding(
              v_receipt.id,
              v_observation->>'observation_id',
              v_observation->'source_ids',
              v_observation->'subjects',
              v_observation->>'change_type',
              v_observation->>'summary',
              v_observation->'effective_time',
              v_observation->'discovery_assessment',
              v_observation->'submitted_evidence_refs',
              v_observation->'raw_attributes',
              v_observation->'security_flags',
              v_observation->>'semantic_fingerprint',
              (v_observation->>'semantic_fingerprint_version')::integer
          );
        if v_map.mapping_status = 'quarantined' then
            select error_code into v_reason
              from app_private.agent_feed_receipts where id = v_receipt.id;
            return query select v_receipt.id, 'quarantined'::text, null::jsonb,
                null::text, null::uuid, coalesce(v_reason, 'security_flagged');
            return;
        end if;
        v_observation_id := v_map.observation_id;

        -- map_agent_feed_finding establishes the immutable observation and
        -- evidence-work rows. Replace only its id-only lead payloads with the
        -- exact, already schema-validated producer material. No canonical
        -- EvidenceRecord is created here.
        if v_map.mapping_status = 'mapped' then
            insert into app_private.source_observation_evidence_work (
                observation_id, agent_feed_evidence_id, work_status
            )
            select v_observation_id,
                   item.value->>'agent_feed_evidence_id',
                   'requested'
              from jsonb_array_elements(p_input->'submitted_evidence') as item(value)
            on conflict (observation_id, agent_feed_evidence_id) do nothing;
            insert into app_private.source_observation_submitted_evidence (
                observation_id, agent_feed_evidence_id, submitted_payload, promotion_status
            )
            select v_observation_id,
                   item.value->>'agent_feed_evidence_id',
                   item.value->'submitted_payload',
                   item.value->>'promotion_status'
              from jsonb_array_elements(p_input->'submitted_evidence') as item(value)
            on conflict (observation_id, agent_feed_evidence_id) do update
               set submitted_payload = excluded.submitted_payload
             where app_private.source_observation_submitted_evidence.promotion_status in ('unreviewed','lead_only')
               and app_private.source_observation_submitted_evidence.promoted_evidence_id is null;
        end if;

        select canonical_document into v_observation
          from app_private.source_observations where id = v_observation_id;
        if v_map.mapping_status = 'duplicate' then
            select first_receipt_id into v_duplicate_receipt_id
              from app_private.source_observation_semantic_keys
             where semantic_fingerprint_version = (v_observation->>'semantic_fingerprint_version')::integer
               and semantic_fingerprint = v_observation->>'semantic_fingerprint';
            return query select v_receipt.id, 'duplicate'::text, v_observation,
                'semantic'::text, v_duplicate_receipt_id, 'semantic_fingerprint_match';
            return;
        end if;
        return query select v_receipt.id, 'mapped'::text, v_observation,
            null::text, null::uuid, null::text;
        return;
    end if;

    v_lifecycle := p_input->'run_lifecycle';
    if v_lifecycle->>'kind' = 'started' then
        select * into v_started
          from app_private.record_agent_feed_started(
              v_lifecycle->>'stream_id',
              v_lifecycle->>'run_id',
              v_lifecycle->>'event_id',
              v_lifecycle->'expected_scope',
              app_private.jsonb_timestamp(p_input->'receipt'->'occurred_at')
          );
        update app_private.agent_feed_receipts
           set processing_status = case when v_started.inserted then 'mapped' else 'duplicate' end,
               raw_payload = '{}'::jsonb, redaction_status = 'complete',
               acknowledged_at = coalesce(acknowledged_at, now())
         where id = v_receipt.id;
        return query select v_receipt.id,
            case when v_started.inserted then 'inserted' else 'duplicate' end,
            null::jsonb,
            case when v_started.inserted then null::text else 'semantic'::text end,
            null::uuid,
            null::text;
        return;
    end if;

    select run_state, started_at into v_existing_run_state, v_started_at
      from app_private.agent_feed_run_lifecycle
     where stream_id = v_lifecycle->>'stream_id'
       and run_id = v_lifecycle->>'run_id'
       and replay_attempt = 0
     for update;
    v_existing_terminal := v_existing_run_state in ('completed','partial','failed','cancelled','replayed');
    if v_existing_run_state = 'started' then
        -- record_agent_feed_run owns monitor/freshness/incident side effects,
        -- while this transition closes the started row that the legacy
        -- terminal-only primitive intentionally leaves untouched.
        update app_private.agent_feed_run_lifecycle
           set run_state = v_lifecycle->>'status',
               terminal_status = v_lifecycle->>'status',
               expected_scope = v_lifecycle->'expected_scope',
               actual_scope = v_lifecycle->'actual_scope',
               finding_count = (v_lifecycle->>'findings_submitted')::integer,
               terminal_at = app_private.jsonb_timestamp(v_lifecycle->'completed_at')
         where stream_id = v_lifecycle->>'stream_id'
           and run_id = v_lifecycle->>'run_id'
           and replay_attempt = 0;
    end if;
    perform app_private.record_agent_feed_run(
        v_lifecycle->>'stream_id',
        v_lifecycle->>'run_id',
        v_lifecycle->>'status',
        (v_lifecycle->>'findings_submitted')::integer,
        v_lifecycle->'expected_scope',
        v_lifecycle->'actual_scope',
        coalesce(v_started_at, app_private.jsonb_timestamp(p_input->'receipt'->'occurred_at')),
        app_private.jsonb_timestamp(v_lifecycle->'completed_at'),
        0,
        null
    );
    update app_private.agent_feed_receipts
       set processing_status = case when v_existing_terminal then 'duplicate' else 'mapped' end,
           raw_payload = '{}'::jsonb, redaction_status = 'complete',
           acknowledged_at = coalesce(acknowledged_at, now())
     where id = v_receipt.id;
    return query select v_receipt.id,
        case when v_existing_terminal then 'duplicate' else 'inserted' end,
        null::jsonb,
        case when v_existing_terminal then 'semantic'::text else null::text end,
        null::uuid,
        null::text;
end;
$$;

revoke execute on function app_private.persist_agent_feed_atomic(jsonb) from public;
comment on function app_private.persist_agent_feed_atomic(jsonb) is
    'Atomic signed Agent Feed receipt/mapping/lifecycle boundary. Accepts only handler-shaped JSON; never promotes canonical evidence or creates reward rules.';

commit;
