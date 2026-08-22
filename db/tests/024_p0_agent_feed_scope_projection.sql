\set ON_ERROR_STOP on

begin;

do $test$
declare
    v_manifest_id uuid;
    v_stream_id text := 'regulatory.jp.advertising';
    v_family_id text := 'reg.jp.caa.advertising';
    v_plan_sha256 text := 'sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003';
    v_manifest_sha256 text := 'sha256:6aa634b868e43f9c3f58417602e7b4465e36824f26d00bd9187f043395b4fae8';
    v_work_unit_sha256 text := 'sha256:d0da6a5ed36efee9c16beebc439317f5fb9f219e634b165b9ab12563f8857d57';
    v_target_ids text[];
    v_source_role_id text;
    v_atomic_input jsonb;
    v_atomic_receipt_id uuid;
    v_valid_receipt_id uuid;
    v_missing_receipt_id uuid;
    v_forged_receipt_id uuid;
    v_drifted_receipt_id uuid;
    v_checkpoint jsonb;
    v_payload jsonb;
    v_out record;
    v_sqlstate text;
    v_attempts_before integer;
begin
    select id into strict v_manifest_id
      from app_private.p0_agent_feed_operation_manifests
     where manifest_sha256 = v_manifest_sha256;
    select array_agg(target_id order by target_id)
      into strict v_target_ids
      from app_private.p0_agent_feed_operation_targets
     where manifest_id = v_manifest_id
       and stream_id = v_stream_id
       and family_id = v_family_id;
    if cardinality(v_target_ids) <> 4 then
        raise exception 'scope projection fixture expected four manifest targets';
    end if;
    v_source_role_id := (
        select source_role_id
          from app_private.p0_agent_feed_operation_targets
         where manifest_id = v_manifest_id and target_id = v_target_ids[1]
    );

    -- Exercise the actual atomic adapter path.  Its terminal update redacts
    -- the receipt before the host reconciliation query runs; the trigger must
    -- project the signed scope inside that same transaction.
    v_atomic_input := jsonb_build_object(
        'receipt', jsonb_build_object(
            'event_id', 'evt_scope_projection_atomic', 'protocol_version', '0.1',
            'stream_id', v_stream_id, 'run_id', 'run_scope_projection_atomic',
            'finding_id', null, 'event_type', 'run.completed',
            'received_at', '2026-08-22T02:01:00Z', 'occurred_at', '2026-08-22T02:01:00Z',
            'attempt', 1, 'payload_hash', 'sha256:' || repeat('a', 64),
            'transport_payload_hash', 'sha256:' || repeat('b', 64),
            'delivery_id', 'delivery_scope_projection_atomic',
            'signature_timestamp', '2026-08-22T02:01:00Z',
            'signature_key_id', 'key_scope_test', 'delivery_attempt', 1,
            'raw_payload', jsonb_build_object(
                'event_id', 'evt_scope_projection_atomic',
                'payload', jsonb_build_object(
                    'status', 'completed',
                    'expected_scope', jsonb_build_object(
                        'metadata', jsonb_build_object('target_ids', jsonb_build_array(v_target_ids[2]))
                    ),
                    'actual_scope', jsonb_build_object(
                        'metadata', jsonb_build_object('target_ids', jsonb_build_array(v_target_ids[2]))
                    )
                )
            ),
            'processing_status', 'received', 'redaction_status', 'complete'
        ),
        'observation', null,
        'submitted_evidence', jsonb_build_array(),
        'run_lifecycle', jsonb_build_object(
            'kind', 'terminal', 'stream_id', v_stream_id,
            'run_id', 'run_scope_projection_atomic', 'event_id', 'evt_scope_projection_atomic',
            'status', 'completed', 'completed_at', '2026-08-22T02:01:00Z',
            'findings_submitted', 0, 'completed_zero_findings', true,
            'absent_run', false,
            'actual_scope', jsonb_build_object(
                'metadata', jsonb_build_object('target_ids', jsonb_build_array(v_target_ids[2]))
            ),
            'expected_scope', jsonb_build_object(
                'metadata', jsonb_build_object('target_ids', jsonb_build_array(v_target_ids[2]))
            ),
            'error_summary', null
        )
    );
    select * into strict v_out from app_private.persist_agent_feed_atomic(v_atomic_input);
    v_atomic_receipt_id := v_out.receipt_id;
    if v_out.status <> 'inserted'
       or (select raw_payload from app_private.agent_feed_receipts where id = v_atomic_receipt_id) <> '{}'::jsonb
       or (select count(*) from app_private.p0_agent_feed_receipt_scope_projections where receipt_id = v_atomic_receipt_id) <> 1
    then
        raise exception 'atomic terminal scope was not projected before redaction';
    end if;

    v_source_role_id := (
        select source_role_id
          from app_private.p0_agent_feed_operation_targets
         where manifest_id = v_manifest_id and target_id = v_target_ids[2]
    );
    v_checkpoint := jsonb_build_object(
        'version', 'p0-target-checkpoint.v1', 'manifest_sha256', v_manifest_sha256,
        'target_id', v_target_ids[2], 'stream_id', v_stream_id,
        'family_id', v_family_id, 'source_role_id', v_source_role_id,
        'attempt_number', 1, 'observed_at', '2026-08-22T02:01:00Z',
        'outcome', 'timeout', 'run_id', 'run_scope_projection_atomic',
        'event_id', 'evt_scope_projection_atomic', 'receipt_id', v_atomic_receipt_id::text,
        'idempotency_key', 'scope-projection-atomic-1',
        'input_sha256', 'sha256:' || repeat('c', 64), 'locator', null,
        'locator_fingerprint', null, 'economic_findings_accepted', 0
    );
    v_payload := jsonb_build_object(
        'version', 'p0-receipt-reconciliation.v1', 'plan_sha256', v_plan_sha256,
        'manifest_sha256', v_manifest_sha256, 'work_unit_sha256', v_work_unit_sha256,
        'stream_id', v_stream_id, 'family_id', v_family_id,
        'run_id', 'run_scope_projection_atomic', 'terminal_status', 'completed',
        'receipt_id', v_atomic_receipt_id::text, 'checkpoints', jsonb_build_array(v_checkpoint)
    );
    select * into strict v_out from app_private.reconcile_p0_agent_feed_work_unit(v_payload);
    if v_out.inserted_count <> 1 or v_out.duplicate_count <> 0 then
        raise exception 'atomic projected P0 subset did not reconcile';
    end if;

    -- A valid recovery subset is projected during the same update that
    -- redacts the terminal receipt.  The projection is sufficient for later
    -- reconciliation and contains no raw payload.
    v_source_role_id := (
        select source_role_id
          from app_private.p0_agent_feed_operation_targets
         where manifest_id = v_manifest_id and target_id = v_target_ids[1]
    );
    perform app_private.record_agent_feed_run(
        v_stream_id, 'run_scope_projection_valid', 'completed', 0, '{}'::jsonb, '{}'::jsonb,
        '2026-08-22T03:00:00Z'::timestamptz,
        '2026-08-22T03:01:00Z'::timestamptz
    );
    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, event_type, received_at,
        payload_hash, raw_payload, processing_status, redaction_status,
        signature_timestamp, signature_key_id, delivery_attempt,
        signature_verified, acknowledged_at
    ) values (
        'evt_scope_projection_valid', '0.1', v_stream_id, 'run_scope_projection_valid',
        'run.completed', '2026-08-22T03:01:00Z', 'sha256:' || repeat('1', 64),
        jsonb_build_object(
            'payload', jsonb_build_object(
                'expected_scope', jsonb_build_object(
                    'metadata', jsonb_build_object('target_ids', jsonb_build_array(v_target_ids[1]))
                ),
                'actual_scope', jsonb_build_object(
                    'metadata', jsonb_build_object('target_ids', jsonb_build_array(v_target_ids[1]))
                )
            )
        ),
        'received', 'pending', '2026-08-22T03:01:00Z', 'key_scope_test', 1, true,
        clock_timestamp()
    ) returning id into v_valid_receipt_id;
    update app_private.agent_feed_receipts
       set processing_status = 'mapped', raw_payload = '{}'::jsonb,
           redaction_status = 'complete'
     where id = v_valid_receipt_id;
    if (select count(*) from app_private.p0_agent_feed_receipt_scope_projections
         where receipt_id = v_valid_receipt_id) <> 1
       or (select raw_payload from app_private.agent_feed_receipts
            where id = v_valid_receipt_id) <> '{}'::jsonb
       or (select expected_target_ids from app_private.p0_agent_feed_receipt_scope_projections
            where receipt_id = v_valid_receipt_id) <> array[v_target_ids[1]]::text[]
    then
        raise exception 'valid signed scope was not projected before redaction';
    end if;

    v_checkpoint := jsonb_build_object(
        'version', 'p0-target-checkpoint.v1',
        'manifest_sha256', v_manifest_sha256,
        'target_id', v_target_ids[1], 'stream_id', v_stream_id,
        'family_id', v_family_id, 'source_role_id', v_source_role_id,
        'attempt_number', 1, 'observed_at', '2026-08-22T03:01:00Z',
        'outcome', 'timeout', 'run_id', 'run_scope_projection_valid',
        'event_id', 'evt_scope_projection_valid',
        'receipt_id', v_valid_receipt_id::text,
        'idempotency_key', 'scope-projection-valid-1',
        'input_sha256', 'sha256:' || repeat('2', 64),
        'locator', null, 'locator_fingerprint', null,
        'economic_findings_accepted', 0
    );
    v_payload := jsonb_build_object(
        'version', 'p0-receipt-reconciliation.v1', 'plan_sha256', v_plan_sha256,
        'manifest_sha256', v_manifest_sha256, 'work_unit_sha256', v_work_unit_sha256,
        'stream_id', v_stream_id, 'family_id', v_family_id,
        'run_id', 'run_scope_projection_valid', 'terminal_status', 'completed',
        'receipt_id', v_valid_receipt_id::text, 'checkpoints', jsonb_build_array(v_checkpoint)
    );
    select * into strict v_out from app_private.reconcile_p0_agent_feed_work_unit(v_payload);
    if v_out.inserted_count <> 1 or v_out.duplicate_count <> 0 then
        raise exception 'valid projected P0 subset did not reconcile';
    end if;
    select * into strict v_out from app_private.reconcile_p0_agent_feed_work_unit(v_payload);
    if v_out.inserted_count <> 0 or v_out.duplicate_count <> 1 then
        raise exception 'valid projected P0 subset replay was not idempotent';
    end if;
    -- A scope projection cannot be widened by presenting a whole-family
    -- checkpoint count when the signed scope selected only one target.
    v_payload := jsonb_build_object(
        'version', 'p0-receipt-reconciliation.v1', 'plan_sha256', v_plan_sha256,
        'manifest_sha256', v_manifest_sha256, 'work_unit_sha256', v_work_unit_sha256,
        'stream_id', v_stream_id, 'family_id', v_family_id,
        'run_id', 'run_scope_projection_valid', 'terminal_status', 'completed',
        'receipt_id', v_valid_receipt_id::text,
        'checkpoints', jsonb_build_array(v_checkpoint, v_checkpoint, v_checkpoint, v_checkpoint)
    );
    v_attempts_before := (select count(*) from app_private.p0_agent_feed_target_attempts);
    v_sqlstate := null;
    begin
        perform app_private.reconcile_p0_agent_feed_work_unit(v_payload);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '22023'
       or (select count(*) from app_private.p0_agent_feed_target_attempts) <> v_attempts_before
    then
        raise exception 'extra checkpoints widened a signed P0 subset';
    end if;

    -- Missing or malformed signed scope creates no projection, so a subset
    -- terminal fails closed after raw redaction.
    perform app_private.record_agent_feed_run(
        v_stream_id, 'run_scope_projection_missing', 'completed', 0, '{}'::jsonb, '{}'::jsonb,
        '2026-08-22T04:00:00Z'::timestamptz,
        '2026-08-22T04:01:00Z'::timestamptz
    );
    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, event_type, received_at,
        payload_hash, raw_payload, processing_status, redaction_status,
        signature_timestamp, signature_key_id, delivery_attempt, signature_verified
    ) values (
        'evt_scope_projection_missing', '0.1', v_stream_id, 'run_scope_projection_missing',
        'run.completed', '2026-08-22T04:01:00Z', 'sha256:' || repeat('3', 64),
        '{"payload":{"expected_scope":{"metadata":{}}}}'::jsonb,
        'received', 'pending', '2026-08-22T04:01:00Z', 'key_scope_test', 1, true
    ) returning id into v_missing_receipt_id;
    update app_private.agent_feed_receipts
       set processing_status = 'mapped', raw_payload = '{}'::jsonb,
           redaction_status = 'complete'
     where id = v_missing_receipt_id;
    if exists (select 1 from app_private.p0_agent_feed_receipt_scope_projections
                where receipt_id = v_missing_receipt_id) then
        raise exception 'missing scope unexpectedly created a projection';
    end if;
    v_checkpoint := jsonb_build_object(
            'version', 'p0-target-checkpoint.v1', 'manifest_sha256', v_manifest_sha256,
            'target_id', v_target_ids[2], 'stream_id', v_stream_id,
            'family_id', v_family_id, 'source_role_id', (select source_role_id from app_private.p0_agent_feed_operation_targets where manifest_id = v_manifest_id and target_id = v_target_ids[2]),
            'attempt_number', 1, 'observed_at', '2026-08-22T04:01:00Z',
            'outcome', 'timeout', 'run_id', 'run_scope_projection_missing',
            'event_id', 'evt_scope_projection_missing', 'receipt_id', v_missing_receipt_id::text,
            'idempotency_key', 'scope-projection-missing-1',
            'input_sha256', 'sha256:' || repeat('4', 64), 'locator', null,
            'locator_fingerprint', null, 'economic_findings_accepted', 0
    );
    v_payload := jsonb_build_object(
            'version', 'p0-receipt-reconciliation.v1', 'plan_sha256', v_plan_sha256,
            'manifest_sha256', v_manifest_sha256, 'work_unit_sha256', v_work_unit_sha256,
            'stream_id', v_stream_id, 'family_id', v_family_id,
            'run_id', 'run_scope_projection_missing', 'terminal_status', 'completed',
            'receipt_id', v_missing_receipt_id::text, 'checkpoints', jsonb_build_array(v_checkpoint)
    );
    v_attempts_before := (select count(*) from app_private.p0_agent_feed_target_attempts);
    v_sqlstate := null;
    begin
        perform app_private.reconcile_p0_agent_feed_work_unit(v_payload);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '22023'
       or (select count(*) from app_private.p0_agent_feed_target_attempts) <> v_attempts_before
    then
        raise exception 'missing projected scope was not rejected atomically (state %, before %, after %)',
            v_sqlstate, v_attempts_before,
            (select count(*) from app_private.p0_agent_feed_target_attempts);
    end if;

    -- A privileged forged row cannot retarget a receipt to another event.
    perform app_private.record_agent_feed_run(
        v_stream_id, 'run_scope_projection_forged', 'completed', 0, '{}'::jsonb, '{}'::jsonb,
        '2026-08-22T05:00:00Z'::timestamptz,
        '2026-08-22T05:01:00Z'::timestamptz
    );
    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, event_type, received_at,
        payload_hash, raw_payload, processing_status, redaction_status,
        signature_timestamp, signature_key_id, delivery_attempt, signature_verified
    ) values (
        'evt_scope_projection_forged', '0.1', v_stream_id, 'run_scope_projection_forged',
        'run.completed', '2026-08-22T05:01:00Z', 'sha256:' || repeat('5', 64),
        '{}'::jsonb, 'mapped', 'complete', '2026-08-22T05:01:00Z', 'key_scope_test', 1, true
    ) returning id into v_forged_receipt_id;
    insert into app_private.p0_agent_feed_receipt_scope_projections (
        receipt_id, event_id, stream_id, run_id, expected_target_ids, actual_target_ids
    ) values (
        v_forged_receipt_id, 'forged-event-id', v_stream_id, 'run_scope_projection_forged',
        array[v_target_ids[1]], array[v_target_ids[1]]
    );
    v_payload := jsonb_build_object(
            'version', 'p0-receipt-reconciliation.v1', 'plan_sha256', v_plan_sha256,
            'manifest_sha256', v_manifest_sha256, 'work_unit_sha256', v_work_unit_sha256,
            'stream_id', v_stream_id, 'family_id', v_family_id,
            'run_id', 'run_scope_projection_forged', 'terminal_status', 'completed',
            'receipt_id', v_forged_receipt_id::text, 'checkpoints', jsonb_build_array(
                jsonb_build_object(
                    'version', 'p0-target-checkpoint.v1', 'manifest_sha256', v_manifest_sha256,
                    'target_id', v_target_ids[1], 'stream_id', v_stream_id,
                    'family_id', v_family_id, 'source_role_id', v_source_role_id,
                    'attempt_number', 1, 'observed_at', '2026-08-22T05:01:00Z',
                    'outcome', 'timeout', 'run_id', 'run_scope_projection_forged',
                    'event_id', 'evt_scope_projection_forged', 'receipt_id', v_forged_receipt_id::text,
                    'idempotency_key', 'scope-projection-forged-1',
                    'input_sha256', 'sha256:' || repeat('6', 64), 'locator', null,
                    'locator_fingerprint', null, 'economic_findings_accepted', 0
                )
            )
    );
    v_sqlstate := null;
    begin
        perform app_private.reconcile_p0_agent_feed_work_unit(v_payload);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '22023' then
        raise exception 'forged projected receipt binding was accepted';
    end if;

    -- A projection whose expected and actual sets drift is also rejected,
    -- even when its receipt/event/run identities are otherwise correct.
    perform app_private.record_agent_feed_run(
        v_stream_id, 'run_scope_projection_drifted', 'completed', 0, '{}'::jsonb, '{}'::jsonb,
        '2026-08-22T06:00:00Z'::timestamptz,
        '2026-08-22T06:01:00Z'::timestamptz
    );
    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, event_type, received_at,
        payload_hash, raw_payload, processing_status, redaction_status,
        signature_timestamp, signature_key_id, delivery_attempt, signature_verified
    ) values (
        'evt_scope_projection_drifted', '0.1', v_stream_id, 'run_scope_projection_drifted',
        'run.completed', '2026-08-22T06:01:00Z', 'sha256:' || repeat('7', 64),
        '{}'::jsonb, 'mapped', 'complete', '2026-08-22T06:01:00Z', 'key_scope_test', 1, true
    ) returning id into v_drifted_receipt_id;
    insert into app_private.p0_agent_feed_receipt_scope_projections (
        receipt_id, event_id, stream_id, run_id, expected_target_ids, actual_target_ids
    ) values (
        v_drifted_receipt_id, 'evt_scope_projection_drifted', v_stream_id, 'run_scope_projection_drifted',
        array[v_target_ids[1]], array[v_target_ids[2]]
    );
    v_payload := jsonb_build_object(
            'version', 'p0-receipt-reconciliation.v1', 'plan_sha256', v_plan_sha256,
            'manifest_sha256', v_manifest_sha256, 'work_unit_sha256', v_work_unit_sha256,
            'stream_id', v_stream_id, 'family_id', v_family_id,
            'run_id', 'run_scope_projection_drifted', 'terminal_status', 'completed',
            'receipt_id', v_drifted_receipt_id::text, 'checkpoints', jsonb_build_array(
                jsonb_build_object(
                    'version', 'p0-target-checkpoint.v1', 'manifest_sha256', v_manifest_sha256,
                    'target_id', v_target_ids[1], 'stream_id', v_stream_id,
                    'family_id', v_family_id, 'source_role_id', v_source_role_id,
                    'attempt_number', 1, 'observed_at', '2026-08-22T06:01:00Z',
                    'outcome', 'timeout', 'run_id', 'run_scope_projection_drifted',
                    'event_id', 'evt_scope_projection_drifted', 'receipt_id', v_drifted_receipt_id::text,
                    'idempotency_key', 'scope-projection-drifted-1',
                    'input_sha256', 'sha256:' || repeat('8', 64), 'locator', null,
                    'locator_fingerprint', null, 'economic_findings_accepted', 0
                )
            )
    );
    v_sqlstate := null;
    begin
        perform app_private.reconcile_p0_agent_feed_work_unit(v_payload);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '22023' then
        raise exception 'drifted projected target scope was accepted';
    end if;

    -- Scope projections are private and append-only.
    if exists (
        select 1 from aclexplode(coalesce(
            (select relacl from pg_class where oid = 'app_private.p0_agent_feed_receipt_scope_projections'::regclass),
            acldefault('r', (select relowner from pg_class where oid = 'app_private.p0_agent_feed_receipt_scope_projections'::regclass))
        )) as acl where acl.grantee = 0
    ) then
        raise exception 'scope projection table is granted to PUBLIC';
    end if;
    v_sqlstate := null;
    begin
        update app_private.p0_agent_feed_receipt_scope_projections
           set run_id = 'tampered'
         where receipt_id = v_valid_receipt_id;
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '55000' then
        raise exception 'scope projection update was not rejected';
    end if;
    v_sqlstate := null;
    begin
        delete from app_private.p0_agent_feed_receipt_scope_projections
         where receipt_id = v_valid_receipt_id;
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '55000' then
        raise exception 'scope projection delete was not rejected';
    end if;
    v_sqlstate := null;
    begin
        truncate app_private.p0_agent_feed_receipt_scope_projections;
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '55000' then
        raise exception 'scope projection truncate was not rejected';
    end if;
end;
$test$;

rollback;
