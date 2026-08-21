\set ON_ERROR_STOP on

-- AtomicPersistencePort's database-boundary regression suite.  Everything is
-- transaction-scoped so the isolated database remains clean for later tests.
begin;

do $$
declare
    v_started_input jsonb;
    v_finding_input jsonb;
    v_semantic_duplicate_input jsonb;
    v_terminal_input jsonb;
    v_cancelled_started_input jsonb;
    v_cancelled_terminal_input jsonb;
    v_hostile_input jsonb;
    v_type_null_input jsonb;
    v_type_scalar_input jsonb;
    v_terminal_mismatch_input jsonb;
    v_evidence_mismatch_input jsonb;
    v_evidence_duplicate_input jsonb;
    v_null_probe_input jsonb;
    v_null_probe_inputs jsonb[];
    v_bad_shape_input jsonb;
    v_downstream_failure_input jsonb;
    v_evidence jsonb;
    v_observation jsonb;
    v_out record;
    v_receipt_id uuid;
    v_observation_id uuid;
    v_count integer;
    v_baseline_evidence_records integer;
    v_baseline_rule_versions integer;
    v_baseline_publication_requests integer;
    v_baseline_publication_batches integer;
    v_baseline_publication_members integer;
    v_receipts_before integer;
    v_runs_before integer;
    v_observations_before integer;
    v_sqlstate text;
    v_sqlerrm text;
    v_has_select boolean;
    v_is_definer boolean;
    v_config text[];
begin
    -- The canonical runner applies reviewed seeds before this test. Capture
    -- their counts and prove Agent Feed intake does not mutate those rows.
    select count(*) into v_baseline_evidence_records from app_private.evidence_records;
    select count(*) into v_baseline_rule_versions from app_private.reward_rule_versions;
    select count(*) into v_baseline_publication_requests from app_private.rule_publication_requests;
    select count(*) into v_baseline_publication_batches from app_private.provisional_publication_batches;
    select count(*) into v_baseline_publication_members from app_private.provisional_publication_batch_members;

    insert into app_private.monitor_stream_expectations (
        stream_id, expected_cadence_seconds, grace_seconds, enabled, owner,
        liveness_status
    ) values (
        'atomic_test_stream', 3600, 60, true, 'atomic-db-test', 'never_seen'
    );

    -- A valid run.started event establishes the lifecycle row before the
    -- finding and terminal events for the same run.
    v_started_input := jsonb_build_object(
        'receipt', jsonb_build_object(
            'event_id', 'event_atomic_started_001', 'protocol_version', '0.1',
            'stream_id', 'atomic_test_stream', 'run_id', 'run_atomic_001',
            'finding_id', null, 'event_type', 'run.started',
            'received_at', '2026-01-01T00:00:00Z',
            'occurred_at', '2026-01-01T00:00:00Z', 'attempt', 1,
            'payload_hash', 'sha256:' || repeat('1', 64),
            'transport_payload_hash', 'sha256:' || repeat('2', 64),
            'delivery_id', 'delivery_atomic_started_001',
            'signature_timestamp', '2026-01-01T00:00:00Z',
            'signature_key_id', 'atomic-test-key', 'delivery_attempt', 1,
            'raw_payload', jsonb_build_object('event_id', 'event_atomic_started_001'),
            'processing_status', 'received', 'redaction_status', 'complete'
        ),
        'observation', null,
        'submitted_evidence', jsonb_build_array(),
        'run_lifecycle', jsonb_build_object(
            'kind', 'started', 'stream_id', 'atomic_test_stream',
            'run_id', 'run_atomic_001', 'event_id', 'event_atomic_started_001',
            'status', 'running', 'completed_at', null,
            'findings_submitted', null, 'completed_zero_findings', false,
            'absent_run', false, 'expected_scope', jsonb_build_object('source_count', 1)
        )
    );
    select * into v_out from app_private.persist_agent_feed_atomic(v_started_input);
    if v_out.status <> 'inserted' or v_out.receipt_id is null then
        raise exception 'valid started event was not inserted';
    end if;

    v_evidence := jsonb_build_object(
        'evidence_id', 'ev_atomic_lead_001', 'kind', 'web',
        'source', jsonb_build_object(
            'uri', 'https://example.invalid/atomic',
            'title', 'Atomic lead', 'publisher', 'Atomic test', 'source_id', null
        ),
        'captured_at', '2026-01-01T00:00:01Z', 'published_at', null,
        'locator', jsonb_build_object('type', 'line', 'value', '1', 'page', null),
        'excerpt', 'Producer supplied lead only.', 'content_hash', null,
        'artifact', jsonb_build_object('uri', null, 'media_type', null, 'size_bytes', null),
        'handling', jsonb_build_object(
            'contains_personal_data', false, 'contains_secrets', false,
            'redistribution_restricted', false
        ),
        'metadata', jsonb_build_object('fixture', true)
    );
    v_observation := jsonb_build_object(
        'observation_id', 'so_atomic_observation_001',
        'agent_feed', jsonb_build_object(
            'protocol_version', '0.1', 'event_id', 'event_atomic_finding_001',
            'stream_id', 'atomic_test_stream', 'run_id', 'run_atomic_001',
            'finding_id', 'finding_atomic_001'
        ),
        'source_ids', jsonb_build_array(),
        'subjects', jsonb_build_array(jsonb_build_object(
            'type', 'program', 'id', null, 'name', 'Atomic fixture program'
        )),
        'change_type', 'announcement', 'summary', 'Atomic lead summary',
        'effective_time', jsonb_build_object(
            'occurred_at', null, 'effective_from', null, 'effective_to', null
        ),
        'discovery_assessment', jsonb_build_object(
            'source_authority_claim', 'unknown',
            'evidence_completeness', 'lead_only', 'agent_confidence', 0.2
        ),
        'submitted_evidence_refs', jsonb_build_array('ev_atomic_lead_001'),
        'canonical_evidence_ids', jsonb_build_array(),
        'semantic_fingerprint_version', 1,
        'semantic_fingerprint', 'sha256:' || repeat('3', 64),
        'status', 'needs_evidence', 'security_flags', jsonb_build_array(),
        'raw_attributes', jsonb_build_object('program_id', 'atomic-fixture'),
        'created_at', '2026-01-01T00:00:01Z',
        'updated_at', '2026-01-01T00:00:01Z'
    );
    v_finding_input := jsonb_build_object(
        'receipt', jsonb_build_object(
            'event_id', 'event_atomic_finding_001', 'protocol_version', '0.1',
            'stream_id', 'atomic_test_stream', 'run_id', 'run_atomic_001',
            'finding_id', 'finding_atomic_001', 'event_type', 'finding.submitted',
            'received_at', '2026-01-01T00:00:01Z',
            'occurred_at', '2026-01-01T00:00:01Z', 'attempt', 1,
            'payload_hash', 'sha256:' || repeat('3', 64),
            'transport_payload_hash', 'sha256:' || repeat('4', 64),
            'delivery_id', 'delivery_atomic_finding_001',
            'signature_timestamp', '2026-01-01T00:00:01Z',
            'signature_key_id', 'atomic-test-key', 'delivery_attempt', 1,
            'raw_payload', jsonb_build_object('event_id', 'event_atomic_finding_001'),
            'processing_status', 'received', 'redaction_status', 'complete'
        ),
        'observation', v_observation,
        'submitted_evidence', jsonb_build_array(jsonb_build_object(
            'observation_id', 'so_atomic_observation_001',
            'agent_feed_evidence_id', 'ev_atomic_lead_001',
            'submitted_payload', v_evidence, 'promotion_status', 'lead_only'
        )),
        'run_lifecycle', null
    );
    select * into v_out from app_private.persist_agent_feed_atomic(v_finding_input);
    if v_out.status <> 'mapped' or v_out.observation is null then
        raise exception 'valid finding was not mapped';
    end if;
    select id into v_receipt_id
      from app_private.agent_feed_receipts where event_id = 'event_atomic_finding_001';
    select id into v_observation_id
      from app_private.source_observations where observation_key = 'so_atomic_observation_001';
    if v_receipt_id is null or v_observation_id is null then
        raise exception 'valid finding did not persist receipt and observation';
    end if;
    if (select processing_status from app_private.agent_feed_receipts where id = v_receipt_id) <> 'mapped'
       or (select raw_payload from app_private.agent_feed_receipts where id = v_receipt_id) <> '{}'::jsonb
       or (select promotion_status from app_private.source_observation_submitted_evidence
           where observation_id = v_observation_id and agent_feed_evidence_id = 'ev_atomic_lead_001') <> 'lead_only'
       or (select submitted_payload->>'evidence_id' from app_private.source_observation_submitted_evidence
           where observation_id = v_observation_id and agent_feed_evidence_id = 'ev_atomic_lead_001') <> 'ev_atomic_lead_001'
       or not exists (select 1 from app_private.source_observation_evidence_work
                      where observation_id = v_observation_id and agent_feed_evidence_id = 'ev_atomic_lead_001'
                        and work_status = 'requested') then
        raise exception 'full producer evidence lead or acquisition work was not persisted';
    end if;

    -- Same event/attempt is a deterministic transport duplicate and does not
    -- update the lead again.
    select * into v_out from app_private.persist_agent_feed_atomic(v_finding_input);
    if v_out.status <> 'duplicate' or v_out.duplicate_kind <> 'transport' then
        raise exception 'transport retry was not classified deterministically';
    end if;

    -- A distinct transport event with the same semantic key is a semantic
    -- duplicate and must not create a second observation or evidence lead.
    v_semantic_duplicate_input := jsonb_set(
        v_finding_input, '{receipt,event_id}', to_jsonb('event_atomic_finding_002'::text), false
    );
    v_semantic_duplicate_input := jsonb_set(
        v_semantic_duplicate_input, '{receipt,payload_hash}', to_jsonb(('sha256:' || repeat('5', 64))::text), false
    );
    v_semantic_duplicate_input := jsonb_set(
        v_semantic_duplicate_input, '{receipt,transport_payload_hash}', to_jsonb(('sha256:' || repeat('6', 64))::text), false
    );
    v_semantic_duplicate_input := jsonb_set(
        v_semantic_duplicate_input, '{receipt,delivery_id}', to_jsonb('delivery_atomic_finding_002'::text), false
    );
    v_semantic_duplicate_input := jsonb_set(
        v_semantic_duplicate_input, '{receipt,received_at}', to_jsonb('2026-01-01T00:00:03Z'::text), false
    );
    v_semantic_duplicate_input := jsonb_set(
        v_semantic_duplicate_input, '{receipt,occurred_at}', to_jsonb('2026-01-01T00:00:03Z'::text), false
    );
    v_semantic_duplicate_input := jsonb_set(
        v_semantic_duplicate_input, '{receipt,signature_timestamp}', to_jsonb('2026-01-01T00:00:03Z'::text), false
    );
    v_semantic_duplicate_input := jsonb_set(
        v_semantic_duplicate_input, '{observation,agent_feed,event_id}', to_jsonb('event_atomic_finding_002'::text), false
    );
    select * into v_out from app_private.persist_agent_feed_atomic(v_semantic_duplicate_input);
    if v_out.status <> 'duplicate' or v_out.duplicate_kind <> 'semantic'
       or v_out.duplicate_of_receipt_id <> v_receipt_id
       or (select count(*) from app_private.source_observations where observation_key = 'so_atomic_observation_001') <> 1 then
        raise exception 'semantic duplicate was not isolated from canonical observation';
    end if;

    -- Terminal lifecycle closes the started row and invokes the existing
    -- monitor/freshness side effects in the same transaction.
    v_terminal_input := jsonb_build_object(
        'receipt', jsonb_build_object(
            'event_id', 'event_atomic_terminal_001', 'protocol_version', '0.1',
            'stream_id', 'atomic_test_stream', 'run_id', 'run_atomic_001',
            'finding_id', null, 'event_type', 'run.completed',
            'received_at', '2026-01-01T00:00:04Z',
            'occurred_at', '2026-01-01T00:00:04Z', 'attempt', 1,
            'payload_hash', 'sha256:' || repeat('7', 64),
            'transport_payload_hash', 'sha256:' || repeat('8', 64),
            'delivery_id', 'delivery_atomic_terminal_001',
            'signature_timestamp', '2026-01-01T00:00:04Z',
            'signature_key_id', 'atomic-test-key', 'delivery_attempt', 1,
            'raw_payload', jsonb_build_object('event_id', 'event_atomic_terminal_001'),
            'processing_status', 'received', 'redaction_status', 'complete'
        ),
        'observation', null,
        'submitted_evidence', jsonb_build_array(),
        'run_lifecycle', jsonb_build_object(
            'kind', 'terminal', 'stream_id', 'atomic_test_stream',
            'run_id', 'run_atomic_001', 'event_id', 'event_atomic_terminal_001',
            'status', 'completed', 'completed_at', '2026-01-01T00:00:04Z',
            'findings_submitted', 1, 'completed_zero_findings', false,
            'absent_run', false, 'actual_scope', jsonb_build_object('source_count', 1),
            'expected_scope', jsonb_build_object('source_count', 1), 'error_summary', null
        )
    );
    select * into v_out from app_private.persist_agent_feed_atomic(v_terminal_input);
    if v_out.status <> 'inserted'
       or (select run_state from app_private.agent_feed_run_lifecycle
           where stream_id = 'atomic_test_stream' and run_id = 'run_atomic_001' and replay_attempt = 0) <> 'completed'
       or (select terminal_status from app_private.agent_feed_run_lifecycle
           where stream_id = 'atomic_test_stream' and run_id = 'run_atomic_001' and replay_attempt = 0) <> 'completed'
       or (select liveness_status from app_private.monitor_stream_expectations where stream_id = 'atomic_test_stream') <> 'healthy' then
        raise exception 'started/finding/terminal lifecycle composition failed';
    end if;

    -- The authoritative consumer maps a cancelled terminal payload through
    -- run.failed; the lifecycle status remains cancelled at this boundary.
    v_cancelled_started_input := jsonb_set(
        v_started_input, '{receipt,event_id}', to_jsonb('event_atomic_cancel_started'::text), false
    );
    v_cancelled_started_input := jsonb_set(
        v_cancelled_started_input, '{receipt,run_id}', to_jsonb('run_atomic_cancelled_001'::text), false
    );
    v_cancelled_started_input := jsonb_set(
        v_cancelled_started_input, '{receipt,payload_hash}', to_jsonb(('sha256:' || repeat('e', 64))::text), false
    );
    v_cancelled_started_input := jsonb_set(
        v_cancelled_started_input, '{receipt,transport_payload_hash}', to_jsonb(('sha256:' || repeat('f', 64))::text), false
    );
    v_cancelled_started_input := jsonb_set(
        v_cancelled_started_input, '{receipt,delivery_id}', to_jsonb('delivery_atomic_cancel_started'::text), false
    );
    v_cancelled_started_input := jsonb_set(
        v_cancelled_started_input, '{receipt,received_at}', to_jsonb('2026-01-01T00:00:04.500Z'::text), false
    );
    v_cancelled_started_input := jsonb_set(
        v_cancelled_started_input, '{receipt,occurred_at}', to_jsonb('2026-01-01T00:00:04.500Z'::text), false
    );
    v_cancelled_started_input := jsonb_set(
        v_cancelled_started_input, '{receipt,signature_timestamp}', to_jsonb('2026-01-01T00:00:04.500Z'::text), false
    );
    v_cancelled_started_input := jsonb_set(
        v_cancelled_started_input, '{receipt,raw_payload,event_id}', to_jsonb('event_atomic_cancel_started'::text), false
    );
    v_cancelled_started_input := jsonb_set(
        v_cancelled_started_input, '{run_lifecycle,event_id}', to_jsonb('event_atomic_cancel_started'::text), false
    );
    v_cancelled_started_input := jsonb_set(
        v_cancelled_started_input, '{run_lifecycle,run_id}', to_jsonb('run_atomic_cancelled_001'::text), false
    );
    select * into v_out from app_private.persist_agent_feed_atomic(v_cancelled_started_input);
    if v_out.status <> 'inserted'
       or (select run_state from app_private.agent_feed_run_lifecycle
           where stream_id = 'atomic_test_stream' and run_id = 'run_atomic_cancelled_001' and replay_attempt = 0) <> 'started' then
        raise exception 'cancelled lifecycle start was not inserted';
    end if;

    v_cancelled_terminal_input := jsonb_set(
        v_terminal_input, '{receipt,event_id}', to_jsonb('event_atomic_cancelled'::text), false
    );
    v_cancelled_terminal_input := jsonb_set(
        v_cancelled_terminal_input, '{receipt,event_type}', to_jsonb('run.failed'::text), false
    );
    v_cancelled_terminal_input := jsonb_set(
        v_cancelled_terminal_input, '{receipt,run_id}', to_jsonb('run_atomic_cancelled_001'::text), false
    );
    v_cancelled_terminal_input := jsonb_set(
        v_cancelled_terminal_input, '{receipt,payload_hash}', to_jsonb(('sha256:' || repeat('0', 64))::text), false
    );
    v_cancelled_terminal_input := jsonb_set(
        v_cancelled_terminal_input, '{receipt,transport_payload_hash}', to_jsonb(('sha256:' || repeat('1', 64))::text), false
    );
    v_cancelled_terminal_input := jsonb_set(
        v_cancelled_terminal_input, '{receipt,delivery_id}', to_jsonb('delivery_atomic_cancelled'::text), false
    );
    v_cancelled_terminal_input := jsonb_set(
        v_cancelled_terminal_input, '{receipt,received_at}', to_jsonb('2026-01-01T00:00:05.500Z'::text), false
    );
    v_cancelled_terminal_input := jsonb_set(
        v_cancelled_terminal_input, '{receipt,occurred_at}', to_jsonb('2026-01-01T00:00:05.500Z'::text), false
    );
    v_cancelled_terminal_input := jsonb_set(
        v_cancelled_terminal_input, '{receipt,signature_timestamp}', to_jsonb('2026-01-01T00:00:05.500Z'::text), false
    );
    v_cancelled_terminal_input := jsonb_set(
        v_cancelled_terminal_input, '{receipt,raw_payload,event_id}', to_jsonb('event_atomic_cancelled'::text), false
    );
    v_cancelled_terminal_input := jsonb_set(
        v_cancelled_terminal_input, '{run_lifecycle,event_id}', to_jsonb('event_atomic_cancelled'::text), false
    );
    v_cancelled_terminal_input := jsonb_set(
        v_cancelled_terminal_input, '{run_lifecycle,run_id}', to_jsonb('run_atomic_cancelled_001'::text), false
    );
    v_cancelled_terminal_input := jsonb_set(
        v_cancelled_terminal_input, '{run_lifecycle,status}', to_jsonb('cancelled'::text), false
    );
    v_cancelled_terminal_input := jsonb_set(
        v_cancelled_terminal_input, '{run_lifecycle,completed_at}', to_jsonb('2026-01-01T00:00:05.500Z'::text), false
    );
    v_cancelled_terminal_input := jsonb_set(
        v_cancelled_terminal_input, '{run_lifecycle,findings_submitted}', to_jsonb(0), false
    );
    v_cancelled_terminal_input := jsonb_set(
        v_cancelled_terminal_input, '{run_lifecycle,completed_zero_findings}', to_jsonb(false), false
    );
    select * into v_out from app_private.persist_agent_feed_atomic(v_cancelled_terminal_input);
    if v_out.status <> 'inserted'
       or (select run_state from app_private.agent_feed_run_lifecycle
           where stream_id = 'atomic_test_stream' and run_id = 'run_atomic_cancelled_001' and replay_attempt = 0) <> 'cancelled'
       or (select terminal_status from app_private.agent_feed_run_lifecycle
           where stream_id = 'atomic_test_stream' and run_id = 'run_atomic_cancelled_001' and replay_attempt = 0) <> 'cancelled' then
        raise exception 'cancelled terminal lifecycle was not accepted as run.failed';
    end if;

    -- A hostile/quarantined delivery is acknowledged only after its redacted
    -- receipt and DLQ state are durable; it creates no observation or lead.
    v_hostile_input := jsonb_build_object(
        'receipt', jsonb_build_object(
            'event_id', 'event_atomic_hostile_001', 'protocol_version', '0.1',
            'stream_id', 'atomic_test_stream', 'run_id', 'run_atomic_002',
            'finding_id', 'finding_atomic_hostile', 'event_type', 'finding.submitted',
            'received_at', '2026-01-01T00:00:05Z',
            'occurred_at', '2026-01-01T00:00:05Z', 'attempt', 1,
            'payload_hash', 'sha256:' || repeat('9', 64),
            'transport_payload_hash', 'sha256:' || repeat('a', 64),
            'delivery_id', 'delivery_atomic_hostile_001',
            'signature_timestamp', '2026-01-01T00:00:05Z',
            'signature_key_id', 'atomic-test-key', 'delivery_attempt', 1,
            'raw_payload', jsonb_build_object('event_id', 'event_atomic_hostile_001'),
            'processing_status', 'quarantined', 'redaction_status', 'complete',
            'error_code', 'hostile_security_flags'
        ),
        'observation', null,
        'submitted_evidence', jsonb_build_array(), 'run_lifecycle', null,
        'quarantine_reason', 'hostile_security_flags'
    );
    select * into v_out from app_private.persist_agent_feed_atomic(v_hostile_input);
    if v_out.status <> 'quarantined'
       or (select processing_status from app_private.agent_feed_receipts where event_id = 'event_atomic_hostile_001') <> 'quarantined'
       or (select raw_payload from app_private.agent_feed_receipts where event_id = 'event_atomic_hostile_001') <> '{}'::jsonb
       or not exists (select 1 from app_private.agent_feed_dead_letters where event_id = 'event_atomic_hostile_001')
       or exists (select 1 from app_private.source_observations where receipt_id = v_out.receipt_id) then
        raise exception 'hostile quarantine was not terminal and redaction-safe';
    end if;

    -- Receipt event_type is a required JSON string from the authoritative
    -- handler contract.  Null and scalar values must fail before accept writes.
    select count(*) into v_receipts_before from app_private.agent_feed_receipts;
    select count(*) into v_runs_before from app_private.agent_feed_run_lifecycle;
    select count(*) into v_observations_before from app_private.source_observations;
    v_type_null_input := jsonb_set(
        v_finding_input, '{receipt,event_type}', 'null'::jsonb, false
    );
    v_sqlstate := null;
    v_sqlerrm := null;
    begin
        perform app_private.persist_agent_feed_atomic(v_type_null_input);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
    end;
    if v_sqlstate is null then
        raise exception 'JSON-null event_type unexpectedly succeeded';
    end if;
    if v_sqlstate <> '22023' or position('JSON string' in coalesce(v_sqlerrm, '')) = 0 then
        raise exception 'JSON-null event_type returned SQLSTATE %, message %', v_sqlstate, v_sqlerrm;
    end if;
    if (select count(*) from app_private.agent_feed_receipts) <> v_receipts_before
       or (select count(*) from app_private.agent_feed_run_lifecycle) <> v_runs_before
       or (select count(*) from app_private.source_observations) <> v_observations_before then
        raise exception 'JSON-null event_type created durable rows';
    end if;

    v_type_scalar_input := jsonb_set(
        v_finding_input, '{receipt,event_type}', to_jsonb(42), false
    );
    v_sqlstate := null;
    v_sqlerrm := null;
    begin
        perform app_private.persist_agent_feed_atomic(v_type_scalar_input);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
    end;
    if v_sqlstate is null then
        raise exception 'scalar event_type unexpectedly succeeded';
    end if;
    if v_sqlstate <> '22023' or position('JSON string' in coalesce(v_sqlerrm, '')) = 0 then
        raise exception 'scalar event_type returned SQLSTATE %, message %', v_sqlstate, v_sqlerrm;
    end if;
    if (select count(*) from app_private.agent_feed_receipts) <> v_receipts_before
       or (select count(*) from app_private.agent_feed_run_lifecycle) <> v_runs_before
       or (select count(*) from app_private.source_observations) <> v_observations_before then
        raise exception 'scalar event_type created durable rows';
    end if;

    -- Compact three-valued-logic probes for the critical enum/flag fields:
    -- every JSON null must be rejected before any domain write.
    v_null_probe_inputs := array[
        jsonb_set(v_finding_input, '{receipt,protocol_version}', 'null'::jsonb, false),
        jsonb_set(v_finding_input, '{receipt,processing_status}', 'null'::jsonb, false),
        jsonb_set(v_finding_input, '{receipt,redaction_status}', 'null'::jsonb, false),
        jsonb_set(v_finding_input, '{observation,semantic_fingerprint_version}', 'null'::jsonb, false),
        jsonb_set(v_finding_input, '{observation,status}', 'null'::jsonb, false),
        jsonb_set(v_terminal_input, '{run_lifecycle,status}', 'null'::jsonb, false),
        jsonb_set(v_terminal_input, '{run_lifecycle,absent_run}', 'null'::jsonb, false)
    ]::jsonb[];
    foreach v_null_probe_input in array v_null_probe_inputs loop
        v_sqlstate := null;
        begin
            perform app_private.persist_agent_feed_atomic(v_null_probe_input);
        exception when others then
            get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
        end;
        if v_sqlstate is distinct from '22023' then
            raise exception 'critical JSON-null probe returned SQLSTATE %, message %', v_sqlstate, v_sqlerrm;
        end if;
    end loop;
    if (select count(*) from app_private.agent_feed_receipts) <> v_receipts_before
       or (select count(*) from app_private.agent_feed_run_lifecycle) <> v_runs_before
       or (select count(*) from app_private.source_observations) <> v_observations_before then
        raise exception 'critical JSON-null probe created durable rows';
    end if;

    -- Terminal status is a closed mapping, not a free-form lifecycle value.
    v_terminal_mismatch_input := jsonb_set(
        v_terminal_input, '{run_lifecycle,status}', to_jsonb('failed'::text), false
    );
    v_sqlstate := null;
    v_sqlerrm := null;
    begin
        perform app_private.persist_agent_feed_atomic(v_terminal_mismatch_input);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
    end;
    if v_sqlstate is null then
        raise exception 'terminal status mismatch unexpectedly succeeded';
    end if;
    if v_sqlstate <> '22023' or position('does not match' in coalesce(v_sqlerrm, '')) = 0 then
        raise exception 'terminal status mismatch returned SQLSTATE %, message %', v_sqlstate, v_sqlerrm;
    end if;
    if (select count(*) from app_private.agent_feed_receipts) <> v_receipts_before
       or (select count(*) from app_private.agent_feed_run_lifecycle) <> v_runs_before
       or (select count(*) from app_private.source_observations) <> v_observations_before then
        raise exception 'terminal status mismatch created durable rows';
    end if;

    v_terminal_mismatch_input := jsonb_set(
        v_terminal_input, '{run_lifecycle,status}', to_jsonb('partial'::text), false
    );
    v_sqlstate := null;
    v_sqlerrm := null;
    begin
        perform app_private.persist_agent_feed_atomic(v_terminal_mismatch_input);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
    end;
    if v_sqlstate is null then
        raise exception 'terminal partial mismatch unexpectedly succeeded';
    end if;
    if v_sqlstate <> '22023' or position('does not match' in coalesce(v_sqlerrm, '')) = 0 then
        raise exception 'terminal partial mismatch returned SQLSTATE %, message %', v_sqlstate, v_sqlerrm;
    end if;
    if (select count(*) from app_private.agent_feed_receipts) <> v_receipts_before
       or (select count(*) from app_private.agent_feed_run_lifecycle) <> v_runs_before
       or (select count(*) from app_private.source_observations) <> v_observations_before then
        raise exception 'terminal partial mismatch created durable rows';
    end if;

    -- Finding evidence references and submitted lead identities are the same
    -- set.  Reject both missing identities and duplicate lead identities.
    v_evidence_mismatch_input := jsonb_set(
        v_finding_input,
        '{observation,submitted_evidence_refs}',
        jsonb_build_array('ev_atomic_missing_001'),
        false
    );
    v_sqlstate := null;
    v_sqlerrm := null;
    begin
        perform app_private.persist_agent_feed_atomic(v_evidence_mismatch_input);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
    end;
    if v_sqlstate is null then
        raise exception 'evidence reference mismatch unexpectedly succeeded';
    end if;
    if v_sqlstate <> '22023' or position('exactly match' in coalesce(v_sqlerrm, '')) = 0 then
        raise exception 'evidence reference mismatch returned SQLSTATE %, message %', v_sqlstate, v_sqlerrm;
    end if;
    if (select count(*) from app_private.agent_feed_receipts) <> v_receipts_before
       or (select count(*) from app_private.agent_feed_run_lifecycle) <> v_runs_before
       or (select count(*) from app_private.source_observations) <> v_observations_before then
        raise exception 'evidence reference mismatch created durable rows';
    end if;

    v_evidence_duplicate_input := jsonb_set(
        v_finding_input,
        '{submitted_evidence}',
        (v_finding_input->'submitted_evidence') || (v_finding_input->'submitted_evidence'),
        false
    );
    v_sqlstate := null;
    v_sqlerrm := null;
    begin
        perform app_private.persist_agent_feed_atomic(v_evidence_duplicate_input);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
    end;
    if v_sqlstate is null then
        raise exception 'duplicate evidence lead unexpectedly succeeded';
    end if;
    if v_sqlstate <> '22023' or position('must be unique' in coalesce(v_sqlerrm, '')) = 0 then
        raise exception 'duplicate evidence lead returned SQLSTATE %, message %', v_sqlstate, v_sqlerrm;
    end if;
    if (select count(*) from app_private.agent_feed_receipts) <> v_receipts_before
       or (select count(*) from app_private.agent_feed_run_lifecycle) <> v_runs_before
       or (select count(*) from app_private.source_observations) <> v_observations_before then
        raise exception 'duplicate evidence lead created durable rows';
    end if;

    -- Extra keys are rejected before accept_agent_feed_event, so no receipt is
    -- left behind by malformed input.
    v_bad_shape_input := jsonb_set(v_finding_input, '{unexpected}', 'true'::jsonb, true);
    select count(*) into v_receipts_before from app_private.agent_feed_receipts;
    select count(*) into v_runs_before from app_private.agent_feed_run_lifecycle;
    select count(*) into v_observations_before from app_private.source_observations;
    v_sqlstate := null;
    v_sqlerrm := null;
    begin
        perform app_private.persist_agent_feed_atomic(v_bad_shape_input);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
    end;
    if v_sqlstate is null then
        raise exception 'extra-key input unexpectedly succeeded';
    end if;
    if v_sqlstate <> '22023' or position('invalid object shape' in coalesce(v_sqlerrm, '')) = 0 then
        raise exception 'extra-key input returned SQLSTATE %, message %', v_sqlstate, v_sqlerrm;
    end if;
    if (select count(*) from app_private.agent_feed_receipts) <> v_receipts_before
       or (select count(*) from app_private.agent_feed_run_lifecycle) <> v_runs_before
       or (select count(*) from app_private.source_observations) <> v_observations_before then
        raise exception 'extra-key input created durable rows';
    end if;
    if exists (select 1 from app_private.agent_feed_receipts where event_id = 'event_atomic_bad_shape') then
        raise exception 'malformed input left a receipt';
    end if;

    -- A downstream table constraint failure must roll back the receipt too.
    v_downstream_failure_input := jsonb_set(
        v_finding_input, '{receipt,event_id}', to_jsonb('event_atomic_downstream_fail'::text), false
    );
    v_downstream_failure_input := jsonb_set(
        v_downstream_failure_input, '{receipt,payload_hash}', to_jsonb(('sha256:' || repeat('b', 64))::text), false
    );
    v_downstream_failure_input := jsonb_set(
        v_downstream_failure_input, '{receipt,transport_payload_hash}', to_jsonb(('sha256:' || repeat('c', 64))::text), false
    );
    v_downstream_failure_input := jsonb_set(
        v_downstream_failure_input, '{receipt,delivery_id}', to_jsonb('delivery_atomic_downstream_fail'::text), false
    );
    v_downstream_failure_input := jsonb_set(
        v_downstream_failure_input, '{receipt,received_at}', to_jsonb('2026-01-01T00:00:06Z'::text), false
    );
    v_downstream_failure_input := jsonb_set(
        v_downstream_failure_input, '{receipt,occurred_at}', to_jsonb('2026-01-01T00:00:06Z'::text), false
    );
    v_downstream_failure_input := jsonb_set(
        v_downstream_failure_input, '{receipt,signature_timestamp}', to_jsonb('2026-01-01T00:00:06Z'::text), false
    );
    v_downstream_failure_input := jsonb_set(
        v_downstream_failure_input, '{observation,agent_feed,event_id}', to_jsonb('event_atomic_downstream_fail'::text), false
    );
    v_downstream_failure_input := jsonb_set(
        v_downstream_failure_input, '{observation,semantic_fingerprint}', to_jsonb(('sha256:' || repeat('d', 64))::text), false
    );
    v_downstream_failure_input := jsonb_set(
        v_downstream_failure_input, '{observation,effective_time}', jsonb_build_object(
            'occurred_at', null, 'effective_from', '2026-01-01T00:00:08Z',
            'effective_to', '2026-01-01T00:00:07Z'
        ), false
    );
    v_sqlstate := null;
    v_sqlerrm := null;
    begin
        perform app_private.persist_agent_feed_atomic(v_downstream_failure_input);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
    end;
    if v_sqlstate is null then
        raise exception 'downstream-failure input unexpectedly succeeded';
    end if;
    if v_sqlstate <> '23514' or position('source_observations' in coalesce(v_sqlerrm, '')) = 0 then
        raise exception 'downstream failure returned SQLSTATE %, message %', v_sqlstate, v_sqlerrm;
    end if;
    if exists (select 1 from app_private.agent_feed_receipts where event_id = 'event_atomic_downstream_fail')
       or exists (select 1 from app_private.source_observations where semantic_fingerprint = 'sha256:' || repeat('d', 64)) then
        raise exception 'downstream failure was not atomic';
    end if;

    -- No producer lead is canonical and no publication row is reachable from
    -- this boundary.
    if (select canonical_evidence_ids from app_private.source_observations where id = v_observation_id) <> '[]'::jsonb
       or exists (select 1 from app_private.evidence_records where evidence_key = 'ev_atomic_lead_001')
       or (select count(*) from app_private.evidence_records) <> v_baseline_evidence_records
       or (select count(*) from app_private.reward_rule_versions) <> v_baseline_rule_versions
       or (select count(*) from app_private.rule_publication_requests) <> v_baseline_publication_requests
       or (select count(*) from app_private.provisional_publication_batches) <> v_baseline_publication_batches
       or (select count(*) from app_private.provisional_publication_batch_members) <> v_baseline_publication_members then
        raise exception 'atomic Agent Feed intake crossed the canonical/publication boundary';
    end if;

    if has_function_privilege('public', 'app_private.persist_agent_feed_atomic(jsonb)'::regprocedure, 'EXECUTE')
       or has_table_privilege('public', 'app_private.agent_feed_receipts', 'SELECT') then
        raise exception 'atomic boundary unexpectedly grants PUBLIC privileges';
    end if;
    select p.prosecdef, p.proconfig into v_is_definer, v_config
      from pg_proc as p
     where p.oid = 'app_private.persist_agent_feed_atomic(jsonb)'::regprocedure;
    if not v_is_definer
       or not exists (select 1 from unnest(coalesce(v_config, '{}'::text[])) as item(value)
                      where item.value = 'search_path=app_private, pg_catalog') then
        raise exception 'atomic wrapper is not a fixed-search-path SECURITY DEFINER';
    end if;
end
$$;

rollback;
