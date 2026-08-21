\set ON_ERROR_STOP on

begin;

do $test$
declare
    v_manifest_id uuid;
    v_receipt_id uuid;
    v_retry_receipt_id uuid;
    v_stream_id text := 'regulatory.jp.advertising';
    v_family_id text := 'reg.jp.caa.advertising';
    v_run_id text := 'run_p0_operations_complete';
    v_event_id text := 'evt_p0_operations_complete';
    v_checkpoints jsonb;
    v_payload jsonb;
    v_retry_payload jsonb;
    v_first_target text;
    v_out record;
    v_sqlstate text;
    v_before_rules integer;
    v_before_versions integer;
    v_before_evidence integer;
begin
    select id into strict v_manifest_id
      from app_private.p0_agent_feed_operation_manifests
     where manifest_sha256 = 'sha256:6aa634b868e43f9c3f58417602e7b4465e36824f26d00bd9187f043395b4fae8';

    if (select count(*) from app_private.p0_agent_feed_operation_manifests) <> 1
       or (select count(*) from app_private.p0_agent_feed_operation_targets) <> 301
       or (select count(distinct stream_id) from app_private.p0_agent_feed_operation_targets) <> 19
       or (select count(distinct (family_id, source_role_id)) from app_private.p0_agent_feed_operation_targets) <> 301
    then
        raise exception 'P0 operation manifest cardinality drifted';
    end if;
    if not exists (
        select 1 from app_private.p0_agent_feed_operation_targets
         where target_id = 'p0t_bba7eeba7e649d4981acb17c3aba7506c8810f9935a20b2b5d2d89d750ffe40f'
           and family_id = 'card.aeon'
           and source_role_id = 'annual_fees_and_benefits'
    ) then
        raise exception 'P0 target identity does not match the TypeScript projection';
    end if;

    select count(*) into v_before_rules from app_private.reward_rules;
    select count(*) into v_before_versions from app_private.reward_rule_versions;
    select count(*) into v_before_evidence from app_private.evidence_records;

    perform app_private.record_agent_feed_run(
        v_stream_id, v_run_id, 'completed', 0, '{}'::jsonb, '{}'::jsonb,
        '2026-08-22T00:00:00Z'::timestamptz,
        '2026-08-22T00:01:00Z'::timestamptz
    );
    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, event_type, received_at,
        payload_hash, raw_payload, processing_status, redaction_status,
        signature_timestamp, signature_key_id, delivery_attempt,
        signature_verified, acknowledged_at
    ) values (
        v_event_id, '0.1', v_stream_id, v_run_id, 'run.completed',
        '2026-08-22T00:01:00Z', 'sha256:' || repeat('1', 64), '{}'::jsonb,
        'mapped', 'complete', '2026-08-22T00:01:00Z', 'key_p0_test', 1, true,
        clock_timestamp()
    ) returning id into v_receipt_id;

    select jsonb_agg(
        jsonb_build_object(
            'version', 'p0-target-checkpoint.v1',
            'manifest_sha256', 'sha256:6aa634b868e43f9c3f58417602e7b4465e36824f26d00bd9187f043395b4fae8',
            'target_id', target.target_id,
            'stream_id', target.stream_id,
            'family_id', target.family_id,
            'source_role_id', target.source_role_id,
            'attempt_number', 1,
            'observed_at', '2026-08-22T00:01:00Z',
            'outcome', 'resolved',
            'run_id', v_run_id,
            'event_id', v_event_id,
            'receipt_id', v_receipt_id::text,
            'idempotency_key', 'p0-ops-' || target.target_id || '-1',
            'input_sha256', 'sha256:' || repeat('2', 64),
            'locator', 'https://example.test/' || target.source_role_id,
            'locator_fingerprint', 'sha256:' || repeat('3', 64),
            'economic_findings_accepted', 0
        ) order by target.target_id
    ), min(target.target_id)
      into v_checkpoints, v_first_target
      from app_private.p0_agent_feed_operation_targets as target
     where target.manifest_id = v_manifest_id
       and target.stream_id = v_stream_id
       and target.family_id = v_family_id;

    v_payload := jsonb_build_object(
        'version', 'p0-receipt-reconciliation.v1',
        'plan_sha256', 'sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003',
        'manifest_sha256', 'sha256:6aa634b868e43f9c3f58417602e7b4465e36824f26d00bd9187f043395b4fae8',
        'work_unit_sha256', 'sha256:d0da6a5ed36efee9c16beebc439317f5fb9f219e634b165b9ab12563f8857d57',
        'stream_id', v_stream_id,
        'family_id', v_family_id,
        'run_id', v_run_id,
        'terminal_status', 'completed',
        'receipt_id', v_receipt_id::text,
        'checkpoints', v_checkpoints
    );
    select * into strict v_out from app_private.reconcile_p0_agent_feed_work_unit(v_payload);
    if v_out.inserted_count <> 4 or v_out.duplicate_count <> 0 then
        raise exception 'complete P0 work unit did not insert exactly four checkpoints';
    end if;
    select * into strict v_out from app_private.reconcile_p0_agent_feed_work_unit(v_payload);
    if v_out.inserted_count <> 0 or v_out.duplicate_count <> 4 then
        raise exception 'exact P0 work unit replay was not idempotent';
    end if;

    -- An idempotency key binds the complete immutable checkpoint projection;
    -- changing even a non-ranking field such as the resolved locator is a
    -- divergent replay, not a duplicate.
    v_sqlstate := null;
    begin
        perform app_private.reconcile_p0_agent_feed_work_unit(
            jsonb_set(
                v_payload,
                '{checkpoints,0,locator}',
                '"https://example.test/tampered"'::jsonb,
                false
            )
        );
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '55000'
       or (select count(*) from app_private.p0_agent_feed_target_attempts) <> 4
    then
        raise exception 'divergent P0 checkpoint replay was not rejected atomically';
    end if;

    -- A later failure is the latest status, but it cannot erase a prior locator.
    perform app_private.record_agent_feed_run(
        v_stream_id, 'run_p0_operations_retry', 'partial', 0, '{}'::jsonb, '{}'::jsonb,
        '2026-08-22T01:00:00Z'::timestamptz,
        '2026-08-22T01:01:00Z'::timestamptz
    );
    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, event_type, received_at,
        payload_hash, raw_payload, processing_status, redaction_status,
        signature_timestamp, signature_key_id, delivery_attempt,
        signature_verified, acknowledged_at
    ) values (
        'evt_p0_operations_retry', '0.1', v_stream_id, 'run_p0_operations_retry',
        'run.partial', '2026-08-22T01:01:00Z', 'sha256:' || repeat('5', 64),
        '{}'::jsonb, 'mapped', 'complete', '2026-08-22T01:01:00Z',
        'key_p0_test', 1, true, clock_timestamp()
    ) returning id into v_retry_receipt_id;
    v_retry_payload := jsonb_build_object(
        'version', 'p0-receipt-reconciliation.v1',
        'plan_sha256', 'sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003',
        'manifest_sha256', 'sha256:6aa634b868e43f9c3f58417602e7b4465e36824f26d00bd9187f043395b4fae8',
        'work_unit_sha256', 'sha256:d0da6a5ed36efee9c16beebc439317f5fb9f219e634b165b9ab12563f8857d57',
        'stream_id', v_stream_id,
        'family_id', v_family_id,
        'run_id', 'run_p0_operations_retry',
        'terminal_status', 'partial',
        'receipt_id', v_retry_receipt_id::text,
        'checkpoints', jsonb_build_array(jsonb_build_object(
            'version', 'p0-target-checkpoint.v1',
            'manifest_sha256', 'sha256:6aa634b868e43f9c3f58417602e7b4465e36824f26d00bd9187f043395b4fae8',
            'target_id', v_first_target,
            'stream_id', v_stream_id,
            'family_id', v_family_id,
            'source_role_id', (select source_role_id from app_private.p0_agent_feed_operation_targets where manifest_id = v_manifest_id and target_id = v_first_target),
            'attempt_number', 2,
            'observed_at', '2026-08-22T01:01:00Z',
            'outcome', 'timeout',
            'run_id', 'run_p0_operations_retry',
            'event_id', 'evt_p0_operations_retry',
            'receipt_id', v_retry_receipt_id::text,
            'idempotency_key', 'p0-ops-' || v_first_target || '-2',
            'input_sha256', 'sha256:' || repeat('2', 64),
            'locator', null,
            'locator_fingerprint', null,
            'economic_findings_accepted', 0
        ))
    );
    select * into strict v_out from app_private.reconcile_p0_agent_feed_work_unit(v_retry_payload);
    if v_out.inserted_count <> 1
       or not exists (
           select 1 from app_api.p0_agent_feed_target_progress
            where target_id = v_first_target and latest_outcome = 'timeout'
              and locator_covered and resolved_at = '2026-08-22T00:01:00Z'::timestamptz
       )
    then
        raise exception 'failed P0 retry erased the prior locator success';
    end if;

    -- Completed batches are all-or-nothing and every checkpoint event binds
    -- to the signed terminal receipt.
    v_sqlstate := null;
    begin
        perform app_private.reconcile_p0_agent_feed_work_unit(
            jsonb_set(v_payload, '{checkpoints}', v_checkpoints - 0, false)
        );
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '22023'
       or (select count(*) from app_private.p0_agent_feed_target_attempts) <> 5
    then
        raise exception 'incomplete completed P0 work unit was not rejected atomically';
    end if;

    v_sqlstate := null;
    begin
        perform app_private.reconcile_p0_agent_feed_work_unit(
            jsonb_set(v_retry_payload, '{checkpoints,0,event_id}', '"forged_event"'::jsonb, false)
        );
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '22023'
       or (select count(*) from app_private.p0_agent_feed_target_attempts) <> 5
    then
        raise exception 'foreign checkpoint event was not rejected atomically';
    end if;

    v_sqlstate := null;
    begin
        update app_private.p0_agent_feed_target_attempts set outcome = 'interrupted'
         where target_id = v_first_target;
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '55000' then
        raise exception 'P0 operation attempts are not append-only';
    end if;

    if (select count(*) from app_private.reward_rules) <> v_before_rules
       or (select count(*) from app_private.reward_rule_versions) <> v_before_versions
       or (select count(*) from app_private.evidence_records) <> v_before_evidence
    then
        raise exception 'P0 locator operations mutated canonical economic truth';
    end if;
end;
$test$;

do $security$
declare
    v_acl integer;
begin
    select count(*) into v_acl
      from aclexplode(coalesce(
          (select proacl from pg_proc where oid = 'app_private.reconcile_p0_agent_feed_work_unit(jsonb)'::regprocedure),
          acldefault('f', (select proowner from pg_proc where oid = 'app_private.reconcile_p0_agent_feed_work_unit(jsonb)'::regprocedure))
      )) as acl
     where acl.grantee = 0 and acl.privilege_type = 'EXECUTE';
    if v_acl <> 0
       or not (select prosecdef from pg_proc where oid = 'app_private.reconcile_p0_agent_feed_work_unit(jsonb)'::regprocedure)
       or (select proconfig from pg_proc where oid = 'app_private.reconcile_p0_agent_feed_work_unit(jsonb)'::regprocedure)
          is distinct from array['search_path=pg_catalog']::text[]
    then
        raise exception 'P0 operation reconciliation security boundary drifted';
    end if;
end;
$security$;

rollback;
