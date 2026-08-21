\set ON_ERROR_STOP on
begin;

-- This test uses synthetic Agent Feed receipts/observations only.  They are
-- rolled back at the end and do not seed a P0 source or a rule.
do $$
declare
    v_receipt uuid;
    v_machine_observation uuid;
    v_evidence_observation uuid;
begin
    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, finding_id, event_type,
        payload_hash, raw_payload, processing_status, redaction_status,
        delivery_id, signature_timestamp, signature_key_id, delivery_attempt,
        transport_payload_hash, signature_verified
    ) values (
        'evt_p0_machine_0001', '0.1', 'merchant.jp-convenience', 'run_p0_machine_0001',
        'finding_p0_machine_0001', 'finding.submitted',
        'sha256:' || repeat('1', 64), '{}'::jsonb, 'received', 'pending',
        'delivery_p0_machine_0001', '2026-08-20T00:00:00Z', 'test-key', 1,
        'sha256:' || repeat('1', 64), true
    ) returning id into v_receipt;

    select observation_id into v_machine_observation
      from app_private.map_agent_feed_finding(
          v_receipt,
          'so_p0_machine_0001',
          '["merchant.seveneleven.payment-methods"]'::jsonb,
          '[{"type":"merchant","id":"merchant.7eleven","name":"7-Eleven"}]'::jsonb,
          'merchant_acceptance',
          'Synthetic P0 accepted-payment-method observation.',
          '{"occurred_at":"2026-08-20T00:00:00Z","effective_from":null,"effective_to":null}'::jsonb,
          '{"source_authority_claim":"primary","evidence_completeness":"complete","agent_confidence":0.9}'::jsonb,
          '["ev_p0_lead_0001"]'::jsonb,
          '{}'::jsonb,
          '[]'::jsonb,
          'sha256:' || repeat('a', 64),
          1
      );
    update app_private.source_observations
       set status = 'needs_review'
     where id = v_machine_observation;

    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, finding_id, event_type,
        payload_hash, raw_payload, processing_status, redaction_status,
        delivery_id, signature_timestamp, signature_key_id, delivery_attempt,
        transport_payload_hash, signature_verified
    ) values (
        'evt_p0_evidence_0001', '0.1', 'merchant.jp-convenience', 'run_p0_evidence_0001',
        'finding_p0_evidence_0001', 'finding.submitted',
        'sha256:' || repeat('2', 64), '{}'::jsonb, 'received', 'pending',
        'delivery_p0_evidence_0001', '2026-08-20T00:00:00Z', 'test-key', 1,
        'sha256:' || repeat('2', 64), true
    ) returning id into v_receipt;

    select observation_id into v_evidence_observation
      from app_private.map_agent_feed_finding(
          v_receipt,
          'so_p0_evidence_0001',
          '["merchant.seveneleven.payment-methods"]'::jsonb,
          '[{"type":"merchant","id":"merchant.7eleven","name":"7-Eleven"}]'::jsonb,
          'merchant_acceptance',
          'Synthetic P0 observation awaiting evidence.',
          '{"occurred_at":"2026-08-20T00:00:00Z","effective_from":null,"effective_to":null}'::jsonb,
          '{"source_authority_claim":"primary","evidence_completeness":"lead_only","agent_confidence":0.5}'::jsonb,
          '[]'::jsonb,
          '{}'::jsonb,
          '[]'::jsonb,
          'sha256:' || repeat('b', 64),
          1
      );

    if v_machine_observation is null or v_evidence_observation is null then
        raise exception 'synthetic SourceObservation setup failed';
    end if;
end
$$;

-- The private schema has no public table/function capability, and the optional
-- API view remains invoker + barrier secured.
do $$
declare
    v_options text[];
begin
    if has_table_privilege('public', 'app_private.provisional_rule_candidates', 'select')
       or has_table_privilege('public', 'app_private.provisional_rule_transitions', 'select')
       or has_table_privilege('public', 'app_private.provisional_correction_signals', 'select')
       or has_table_privilege('public', 'app_api.active_experimental_provisional_rules', 'select')
    then
        raise exception 'PUBLIC can read the provisional persistence boundary';
    end if;
    if has_function_privilege(
           'public',
           'app_private.persist_provisional_rule_candidate(text,text,jsonb)',
           'execute'
       )
       or has_function_privilege(
           'public',
           'app_private.activate_provisional_rule_candidate(text,timestamptz,text)',
           'execute'
       )
       or has_function_privilege(
           'public',
           'app_private.record_provisional_correction(jsonb,text)',
           'execute'
       )
    then
        raise exception 'PUBLIC can execute a provisional lifecycle routine';
    end if;
    select reloptions into v_options
      from pg_class
     where oid = 'app_api.active_experimental_provisional_rules'::regclass;
    if not (array['security_invoker=true','security_barrier=true']::text[] <@ coalesce(v_options, '{}'::text[])) then
        raise exception 'active provisional view must be invoker and security barrier';
    end if;
end
$$;

-- Candidate-hash serialization must precede row locking in every mutating
-- routine; this prevents activation/correction races from taking opposite
-- lock orders.
do $$
declare
    v_definition text;
    v_advisory_position integer;
    v_row_lock_position integer;
begin
    foreach v_definition in array array[
        pg_get_functiondef('app_private.persist_provisional_rule_candidate(text,text,jsonb)'::regprocedure),
        pg_get_functiondef('app_private.activate_provisional_rule_candidate(text,timestamptz,text)'::regprocedure),
        pg_get_functiondef('app_private.record_provisional_correction(jsonb,text)'::regprocedure)
    ] loop
        v_advisory_position := position('pg_advisory_xact_lock' in v_definition);
        v_row_lock_position := position('for update' in lower(v_definition));
        if v_advisory_position = 0
           or v_row_lock_position = 0
           or v_advisory_position >= v_row_lock_position
        then
            raise exception 'candidate advisory lock does not precede row locking';
        end if;
    end loop;
end
$$;

-- Exercise the intended non-super adapter boundary before the lifecycle
-- fixture mutates its source. It receives only schema USAGE and routine
-- EXECUTE, never table/view privileges; the SECURITY DEFINER routine admits
-- an exact candidate, while the legacy shape is rejected and rolled back.
do $$
declare
    v_adapter_payload jsonb;
    v_adapter_id uuid;
begin
    execute 'create role p0_adapter_test noinherit';
    execute 'grant usage on schema app_private to p0_adapter_test';
    execute 'grant usage on schema app_api to p0_adapter_test';
    execute 'grant execute on function app_private.persist_provisional_rule_candidate(text,text,jsonb) to p0_adapter_test';
    execute 'grant execute on function app_private.activate_provisional_rule_candidate(text,timestamptz,text) to p0_adapter_test';
    execute 'grant execute on function app_private.record_provisional_correction(jsonb,text) to p0_adapter_test';
    execute 'set local role p0_adapter_test';
    if has_table_privilege(current_user, 'app_private.provisional_rule_candidates', 'select')
       or has_table_privilege(current_user, 'app_private.provisional_rule_transitions', 'select')
       or has_table_privilege(current_user, 'app_private.provisional_correction_signals', 'select')
       or has_table_privilege(current_user, 'app_api.active_experimental_provisional_rules', 'select')
    then
        raise exception 'adapter role unexpectedly has table/view privileges';
    end if;
    v_adapter_payload := jsonb_build_object(
        'version','provisional-rule-candidate.v1',
        'candidate_id','candidate_p0_adapter_0001',
        'observation_id','so_p0_machine_0001',
        'observation_fingerprint','sha256:' || repeat('a',64),
        'p0_family_id','merchant.7eleven',
        'source_role_id','accepted_payment_methods',
        'source_authority_role','primary',
        'source_ids','["merchant.seveneleven.payment-methods"]'::jsonb,
        'rule',jsonb_build_object(
            'rule_id','rr_p0_ephemeral_adapter_0001',
            'status','under_review',
            'provenance',jsonb_build_object('human_verified',false),
            'audit',jsonb_build_object(
                'review_mode',null,'reviewed_at',null,'reviewed_by',null,
                'review_events','[]'::jsonb
            ),
            'validity',jsonb_build_object('superseded_at',null)
        ),
        'extractor',jsonb_build_object('name','p0-test-adapter','version','1'),
        'machine_check',jsonb_build_object(
            'checker','p0-test-checker','checker_version','1',
            'checked_at','2026-08-20T00:11:00Z',
            'checks',jsonb_build_object(
                'representation_safe',true,'rule_structure',true,
                'rule_semantics',true,'observation_binding',true,
                'p0_coverage',true
            )
        )
    );
    v_adapter_id := app_private.persist_provisional_rule_candidate(
        'sha256:' || repeat('9',64), 'sha256:' || repeat('8',64), v_adapter_payload
    );
    if v_adapter_id is null then
        raise exception 'adapter role could not call the admission routine';
    end if;
    begin
        perform app_private.persist_provisional_rule_candidate(
            'sha256:' || repeat('a',64), 'sha256:' || repeat('b',64),
            v_adapter_payload || jsonb_build_object('required_source_role','primary')
        );
        raise exception 'adapter role accepted the legacy candidate shape';
    exception when sqlstate '22023' then null;
    end;
    execute 'reset role';
    execute 'revoke execute on function app_private.persist_provisional_rule_candidate(text,text,jsonb) from p0_adapter_test';
    execute 'revoke execute on function app_private.activate_provisional_rule_candidate(text,timestamptz,text) from p0_adapter_test';
    execute 'revoke execute on function app_private.record_provisional_correction(jsonb,text) from p0_adapter_test';
    execute 'revoke usage on schema app_private from p0_adapter_test';
    execute 'revoke usage on schema app_api from p0_adapter_test';
    execute 'drop role p0_adapter_test';
end
$$;

do $$
declare
    v_candidate_id uuid;
    v_evidence_candidate_id uuid;
    v_candidate_hash text := 'sha256:' || repeat('c', 64);
    v_definition_hash text := 'sha256:' || repeat('d', 64);
    v_candidate jsonb;
    v_before_rules integer;
    v_after_rules integer;
    v_before_rule_versions integer;
    v_before_publications integer;
    v_before_replays integer;
    v_before_evidence integer;
    v_after_rule_versions integer;
    v_after_publications integer;
    v_after_replays integer;
    v_after_evidence integer;
begin
    select count(*) into v_before_rules from app_private.reward_rules;
    select count(*) into v_before_rule_versions from app_private.reward_rule_versions;
    select count(*) into v_before_publications from app_private.rule_publication_requests;
    select count(*) into v_before_replays from app_private.canonical_replay_runs;
    select count(*) into v_before_evidence from app_private.evidence_records;

    v_candidate := jsonb_build_object(
        'version', 'provisional-rule-candidate.v1',
        'candidate_id', 'candidate_p0_machine_0001',
        'observation_id', 'so_p0_machine_0001',
        'observation_fingerprint', 'sha256:' || repeat('a', 64),
        'p0_family_id', 'merchant.7eleven',
        'source_role_id', 'accepted_payment_methods',
        'source_authority_role', 'primary',
        'source_ids', '["merchant.seveneleven.payment-methods"]'::jsonb,
        'rule', jsonb_build_object(
            'rule_id','rr_p0_ephemeral_0001',
            'status','under_review',
            'provenance',jsonb_build_object('human_verified',false),
            'audit',jsonb_build_object(
                'review_mode',null,'reviewed_at',null,'reviewed_by',null,
                'review_events','[]'::jsonb
            ),
            'validity',jsonb_build_object('superseded_at',null)
        ),
        'extractor', jsonb_build_object('name','p0-test-adapter','version','1'),
        'machine_check', jsonb_build_object(
            'checker','p0-test-checker',
            'checker_version','1',
            'checked_at','2026-08-20T00:10:00Z',
            'checks',jsonb_build_object(
                'representation_safe',true,
                'rule_structure',true,
                'rule_semantics',true,
                'observation_binding',true,
                'p0_coverage',true
            )
        )
    );

    v_candidate_id := app_private.persist_provisional_rule_candidate(
        v_candidate_hash, v_definition_hash, v_candidate
    );
    if v_candidate_id is null then
        raise exception 'candidate persistence returned no ID';
    end if;
    if (select status from app_private.provisional_rule_candidates where id = v_candidate_id)
       <> 'machine_checked'
    then
        raise exception 'complete needs_review observation must derive machine_checked status';
    end if;
    if (select count(*) from app_private.provisional_rule_transitions where candidate_id = v_candidate_id) <> 1
    then
        raise exception 'candidate admission must append exactly one initial transition';
    end if;
    if (select source_role_id from app_private.provisional_rule_candidates where id = v_candidate_id)
       <> 'accepted_payment_methods'
       or (select source_authority_role from app_private.provisional_rule_candidates where id = v_candidate_id)
          <> 'primary'
    then
        raise exception 'semantic source role and source authority role were not separated';
    end if;

    -- Retry is idempotent only for the exact same trusted snapshot.
    if app_private.persist_provisional_rule_candidate(
           v_candidate_hash, v_definition_hash, v_candidate
       ) <> v_candidate_id
    then
        raise exception 'identical candidate retry did not return the existing snapshot';
    end if;
    begin
        perform app_private.persist_provisional_rule_candidate(
            v_candidate_hash, 'sha256:' || repeat('e', 64), v_candidate
        );
        raise exception 'candidate hash reuse with different definition unexpectedly succeeded';
    exception when sqlstate '55000' then null;
    end;

    -- Candidate admission is exact and fail-closed: legacy fields, missing
    -- version/status, review claims, and supersession claims never reach the
    -- table or its lifecycle trigger.
    begin
        perform app_private.persist_provisional_rule_candidate(
            'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64),
            jsonb_build_object('required_source_role','primary')
        );
        raise exception 'legacy-only candidate unexpectedly succeeded';
    exception when sqlstate '22023' then null;
    end;
    begin
        perform app_private.persist_provisional_rule_candidate(
            'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64),
            v_candidate - 'version'
        );
        raise exception 'candidate missing version unexpectedly succeeded';
    exception when sqlstate '22023' then null;
    end;
    begin
        perform app_private.persist_provisional_rule_candidate(
            'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64),
            jsonb_set(v_candidate, '{rule}', '{}'::jsonb)
        );
        raise exception 'candidate with empty rule unexpectedly succeeded';
    exception when sqlstate '22023' then null;
    end;
    begin
        perform app_private.persist_provisional_rule_candidate(
            'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64),
            jsonb_set(v_candidate, '{rule,provenance,human_verified}', 'true'::jsonb)
        );
        raise exception 'human-verified candidate unexpectedly succeeded';
    exception when sqlstate '22023' then null;
    end;
    begin
        perform app_private.persist_provisional_rule_candidate(
            'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64),
            jsonb_set(v_candidate, '{rule,audit,reviewed_by}', '"reviewer"'::jsonb)
        );
        raise exception 'reviewed candidate unexpectedly succeeded';
    exception when sqlstate '22023' then null;
    end;
    begin
        perform app_private.persist_provisional_rule_candidate(
            'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64),
            jsonb_set(
                v_candidate,
                '{rule,audit,review_events}',
                '[{"mode":"human","reviewer_id":"reviewer","completed_at":"2026-08-20T00:05:00Z","decision":"approved","notes":"no"}]'::jsonb
            )
        );
        raise exception 'approved review event unexpectedly succeeded';
    exception when sqlstate '22023' then null;
    end;
    begin
        perform app_private.persist_provisional_rule_candidate(
            'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64),
            jsonb_set(v_candidate, '{rule,validity,superseded_at}', '"2026-08-21T00:00:00Z"'::jsonb)
        );
        raise exception 'superseded candidate unexpectedly succeeded';
    exception when sqlstate '22023' then null;
    end;
    begin
        perform app_private.persist_provisional_rule_candidate(
            'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64),
            jsonb_set(v_candidate, '{source_authority_role}', '"corroborating"'::jsonb)
        );
        raise exception 'authority-mismatched candidate unexpectedly succeeded';
    exception when sqlstate '22023' then null;
    end;

    -- A lead-only needs_evidence observation cannot be silently promoted.
    v_candidate := jsonb_set(
        v_candidate,
        '{candidate_id}',
        '"candidate_p0_evidence_0001"'::jsonb
    );
    v_candidate := jsonb_set(v_candidate, '{observation_id}', '"so_p0_evidence_0001"'::jsonb);
    v_candidate := jsonb_set(v_candidate, '{observation_fingerprint}', to_jsonb('sha256:' || repeat('b',64)));
    v_evidence_candidate_id := app_private.persist_provisional_rule_candidate(
        'sha256:' || repeat('f', 64),
        'sha256:' || repeat('0', 64),
        v_candidate
    );
    if (select status from app_private.provisional_rule_candidates where id = v_evidence_candidate_id)
       <> 'needs_evidence'
    then
        raise exception 'lead-only observation must derive needs_evidence status';
    end if;

    -- Activation is atomic, chronology-checked, and appends immutable history.
    perform app_private.activate_provisional_rule_candidate(
        v_candidate_hash, '2026-08-20T01:00:00Z', 'p0 test activation'
    );
    if (select status from app_private.provisional_rule_candidates where id = v_candidate_id)
       <> 'active_experimental'
       or (select count(*) from app_private.provisional_rule_transitions where candidate_id = v_candidate_id) <> 2
    then
        raise exception 'experimental activation did not update status and history atomically';
    end if;
    if (select count(*) from app_api.active_experimental_provisional_rules
         where candidate_hash = v_candidate_hash) <> 1 then
        raise exception 'active experimental view did not expose the admitted candidate';
    end if;

    -- Candidate payload, transition history, and direct lifecycle writes are immutable/DB-owned.
    begin
        update app_private.provisional_rule_candidates
           set candidate_payload = jsonb_build_object('tampered',true)
         where id = v_candidate_id;
        raise exception 'candidate payload mutation unexpectedly succeeded';
    exception when sqlstate '55000' then null;
    end;
    begin
        delete from app_private.provisional_rule_transitions where candidate_id = v_candidate_id;
        raise exception 'transition deletion unexpectedly succeeded';
    exception when sqlstate '55000' then null;
    end;
    begin
        update app_private.provisional_rule_candidates
           set status = 'quarantined'
         where id = v_candidate_id;
        raise exception 'direct candidate status mutation unexpectedly succeeded';
    exception when sqlstate '55000' then null;
    end;

    -- The active view immediately fails closed on a quarantined source, then
    -- reopens only after the source trust state is restored.
    update app_private.source_observations
       set trust_state = 'quarantined', quarantined_reason = 'p0 test source quarantine'
     where observation_key = 'so_p0_machine_0001';
    if (select count(*) from app_api.active_experimental_provisional_rules
         where candidate_hash = v_candidate_hash) <> 0 then
        raise exception 'quarantined SourceObservation remained in active view';
    end if;
    update app_private.source_observations
       set trust_state = 'lead_only', quarantined_reason = null
     where observation_key = 'so_p0_machine_0001';
    if (select count(*) from app_api.active_experimental_provisional_rules
         where candidate_hash = v_candidate_hash) <> 1 then
        raise exception 'restored SourceObservation did not reappear in active view';
    end if;
    update app_private.source_observations
       set status = 'rejected'
     where observation_key = 'so_p0_machine_0001';
    if (select count(*) from app_api.active_experimental_provisional_rules
         where candidate_hash = v_candidate_hash) <> 0 then
        raise exception 'rejected SourceObservation remained in active view';
    end if;

    -- Identity fields are frozen, but status/quarantine fields remain available
    -- to close the active view.
    begin
        update app_private.source_observations
           set source_ids = '["tampered-source"]'::jsonb
         where observation_key = 'so_p0_machine_0001';
        raise exception 'SourceObservation source binding mutation unexpectedly succeeded';
    exception when sqlstate '55000' then null;
    end;

    select count(*) into v_after_rules from app_private.reward_rules;
    select count(*) into v_after_rule_versions from app_private.reward_rule_versions;
    select count(*) into v_after_publications from app_private.rule_publication_requests;
    select count(*) into v_after_replays from app_private.canonical_replay_runs;
    select count(*) into v_after_evidence from app_private.evidence_records;
    if v_after_rules <> v_before_rules
       or v_after_rule_versions <> v_before_rule_versions
       or v_after_publications <> v_before_publications
       or v_after_replays <> v_before_replays
       or v_after_evidence <> v_before_evidence
    then
        raise exception 'provisional persistence created or changed canonical/publication rows';
    end if;
end
$$;

-- A credible normal correction against needs_evidence is recorded only; it
-- does not widen the package lifecycle into an unapproved dispute state.
do $$
declare
    v_hash text := 'sha256:' || repeat('f', 64);
    v_signal jsonb := jsonb_build_object(
        'version','provisional-correction.v1',
        'signal_id','p0-signal-needs-evidence-normal-0001',
        'candidate_hash',v_hash,
        'category','rate_wrong',
        'credible',true,
        'reported_at','2026-08-20T00:20:00Z',
        'severity','normal'
    );
begin
    if app_private.record_provisional_correction(v_signal, 'sha256:' || repeat('6',64)) <> 'recorded'
       or (select status from app_private.provisional_rule_candidates where candidate_hash = v_hash)
          <> 'needs_evidence'
       or (select count(*) from app_private.provisional_rule_transitions where candidate_hash = v_hash) <> 1
    then
        raise exception 'credible normal needs_evidence correction changed lifecycle';
    end if;
end
$$;

-- Non-credible corrections are retained without status change.
do $$
declare
    v_hash text := 'sha256:' || repeat('c', 64);
    v_signal jsonb := jsonb_build_object(
        'version','provisional-correction.v1',
        'signal_id','p0-signal-noncredible-0001',
        'candidate_hash',v_hash,
        'category','rate_wrong',
        'credible',false,
        'reported_at','2026-08-20T02:00:00Z',
        'severity','normal'
    );
begin
    -- The source is rejected for view purposes, but corrections remain an
    -- append-only record against the immutable candidate.
    if app_private.record_provisional_correction(v_signal, 'sha256:' || repeat('1',64)) <> 'recorded' then
        raise exception 'non-credible correction had the wrong disposition';
    end if;
    if (select status from app_private.provisional_rule_candidates where candidate_hash = v_hash)
       <> 'active_experimental'
    then
        raise exception 'non-credible correction changed candidate status';
    end if;
    if (select count(*) from app_private.provisional_correction_signals where candidate_hash = v_hash) <> 1 then
        raise exception 'non-credible correction was not retained';
    end if;

    begin
        perform app_private.record_provisional_correction(v_signal, 'sha256:' || repeat('1',64));
        raise exception 'identical correction unexpectedly succeeded twice';
    exception when sqlstate '23505' then null;
    end;
    begin
        perform app_private.record_provisional_correction(
            jsonb_set(v_signal, '{category}', '"merchant_wrong"'::jsonb),
            'sha256:' || repeat('2',64)
        );
        raise exception 'correction signal ID tampering unexpectedly succeeded';
    exception when sqlstate '55000' then null;
    end;
    begin
        perform app_private.record_provisional_correction(
            jsonb_set(
                jsonb_set(v_signal, '{signal_id}', '"p0-signal-backdated-0001"'::jsonb),
                '{reported_at}', '"2026-08-20T00:30:00Z"'::jsonb
            ),
            'sha256:' || repeat('3',64)
        );
        raise exception 'backdated correction unexpectedly succeeded';
    exception when sqlstate '22023' then null;
    end;
end
$$;

-- A credible normal correction disputes an active candidate, while a severe
-- source/security correction immediately quarantines it and removes it from
-- any active selection surface. Payload/history remain present.
do $$
declare
    v_hash text := 'sha256:' || repeat('c', 64);
    v_signal jsonb;
begin
    v_signal := jsonb_build_object(
        'version','provisional-correction.v1',
        'signal_id','p0-signal-credible-0001',
        'candidate_hash',v_hash,
        'category','not_accepted',
        'credible',true,
        'reported_at','2026-08-20T03:00:00Z',
        'severity','normal'
    );
    if app_private.record_provisional_correction(v_signal, 'sha256:' || repeat('4',64)) <> 'disputed' then
        raise exception 'credible normal correction did not dispute candidate';
    end if;
    if (select status from app_private.provisional_rule_candidates where candidate_hash = v_hash)
       <> 'disputed'
    then
        raise exception 'credible normal correction did not update disputed status';
    end if;

    v_signal := jsonb_build_object(
        'version','provisional-correction.v1',
        'signal_id','p0-signal-severe-0001',
        'candidate_hash',v_hash,
        'category','source_mismatch',
        'credible',true,
        'reported_at','2026-08-20T04:00:00Z',
        'severity','severe'
    );
    if app_private.record_provisional_correction(v_signal, 'sha256:' || repeat('5',64)) <> 'quarantined' then
        raise exception 'severe correction did not quarantine candidate';
    end if;
    if (select status from app_private.provisional_rule_candidates where candidate_hash = v_hash)
       <> 'quarantined'
       or (select count(*) from app_private.provisional_rule_transitions where candidate_id = (select id from app_private.provisional_rule_candidates where candidate_hash = v_hash)) <> 4
    then
        raise exception 'severe correction did not append quarantine transition';
    end if;
    if (select candidate_payload->>'candidate_id' from app_private.provisional_rule_candidates where candidate_hash = v_hash)
       <> 'candidate_p0_machine_0001'
    then
        raise exception 'candidate payload was not preserved through correction';
    end if;
end
$$;

-- A corroborating authority role may be persisted only when the observation
-- claim is official_secondary/third_party, but DB-owned activation and the
-- active view require primary authority. Conflict is rejected at admission.
do $$
declare
    v_payload jsonb;
    v_signal jsonb;
    v_hash text := 'sha256:' || repeat('6',64);
begin
    v_payload := jsonb_build_object(
        'version','provisional-rule-candidate.v1',
        'candidate_id','candidate_p0_conflict_0001',
        'observation_id','so_p0_evidence_0001',
        'observation_fingerprint','sha256:' || repeat('b',64),
        'p0_family_id','merchant.7eleven',
        'source_role_id','accepted_payment_methods',
        'source_authority_role','corroborating',
        'source_ids','["merchant.seveneleven.payment-methods"]'::jsonb,
        'rule',jsonb_build_object(
            'rule_id','rr_p0_ephemeral_corroborating_0001',
            'status','under_review',
            'provenance',jsonb_build_object('human_verified',false),
            'audit',jsonb_build_object(
                'review_mode',null,'reviewed_at',null,'reviewed_by',null,
                'review_events','[]'::jsonb
            ),
            'validity',jsonb_build_object('superseded_at',null)
        ),
        'extractor',jsonb_build_object('name','p0-test-adapter','version','1'),
        'machine_check',jsonb_build_object(
            'checker','p0-test-checker','checker_version','1','checked_at','2026-08-20T00:10:00Z',
            'checks',jsonb_build_object(
                'representation_safe',true,'rule_structure',true,'rule_semantics',true,
                'observation_binding',true,'p0_coverage',true
            )
        )
    );
    -- This observation is needs_evidence, so alter only its trusted triage
    -- fields to create the DB-level activation refusal fixture.
    update app_private.source_observations
       set status = 'needs_review',
           discovery_assessment = jsonb_set(
               jsonb_set(discovery_assessment, '{evidence_completeness}', '"complete"'::jsonb),
               '{source_authority_claim}', '"official_secondary"'::jsonb
           ),
           submitted_evidence_refs = '["ev_p0_lead_0002"]'::jsonb
    where observation_key = 'so_p0_evidence_0001';
    perform app_private.persist_provisional_rule_candidate(v_hash, 'sha256:' || repeat('7',64), v_payload);
    v_signal := jsonb_build_object(
        'version','provisional-correction.v1',
        'signal_id','p0-signal-severe-noncredible-0001',
        'candidate_hash',v_hash,
        'category','source_mismatch',
        'credible',false,
        'reported_at','2026-08-20T00:20:00Z',
        'severity','severe'
    );
    if app_private.record_provisional_correction(v_signal, 'sha256:' || repeat('8',64)) <> 'recorded'
       or (select status from app_private.provisional_rule_candidates where candidate_hash = v_hash)
          <> 'machine_checked'
    then
        raise exception 'non-credible severe correction must be retained without quarantine';
    end if;
    begin
        perform app_private.activate_provisional_rule_candidate(v_hash, '2026-08-20T01:00:00Z');
        raise exception 'conflict authority candidate unexpectedly activated';
    exception when sqlstate '55000' then null;
    end;
    if (select count(*) from app_api.active_experimental_provisional_rules
         where candidate_hash = v_hash) <> 0 then
        raise exception 'corroborating candidate appeared in active view';
    end if;

    begin
        perform app_private.persist_provisional_rule_candidate(
            'sha256:' || repeat('0',64), 'sha256:' || repeat('1',64),
            jsonb_set(v_payload, '{source_authority_role}', '"conflict"'::jsonb)
        );
        raise exception 'conflict authority candidate unexpectedly persisted';
    exception when sqlstate '22023' then null;
    end;
end
$$;

-- No provisional object links to canonical reward/publication/replay tables.
do $$
begin
    if exists (
        select 1
          from pg_constraint
         where conrelid in (
             'app_private.provisional_rule_candidates'::regclass,
             'app_private.provisional_rule_transitions'::regclass,
             'app_private.provisional_correction_signals'::regclass
         )
           and confrelid in (
             'app_private.reward_rules'::regclass,
             'app_private.reward_rule_versions'::regclass,
             'app_private.rule_publication_requests'::regclass,
             'app_private.canonical_replay_runs'::regclass,
             'app_private.evidence_records'::regclass
         )
    ) then
        raise exception 'provisional persistence has a canonical/publication FK';
    end if;
end
$$;

rollback;
