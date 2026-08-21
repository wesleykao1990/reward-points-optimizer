\set ON_ERROR_STOP on
begin;

-- M2.5 is exercised through the database-facing intake/mapping/promotion
-- boundary.  Every fixture is rolled back at the end of this test.
do $$
declare
    v_first record;
    v_retry record;
    v_receipt_id uuid;
    v_observation_id uuid;
    v_duplicate_observation_id uuid;
    v_source_id uuid;
    v_snapshot_id uuid;
    v_evidence_id uuid;
    v_work_id uuid;
    v_dlq_id uuid;
    v_replay_id uuid;
    v_run_id uuid;
    v_count integer;
begin
    -- ----------
    -- Transport identity is separate from semantic identity.
    -- ----------
    select * into v_first
      from app_private.accept_agent_feed_event(
        'event_m25_primary', '0.1', 'm25.stream', 'run_m25_primary', 'finding_m25_primary',
        'finding.submitted', 'delivery-m25-primary-1', '2026-01-01T00:00:00Z', 'm25-key-1', 1,
        'sha256:' || repeat('9',64),
        'sha256:' || repeat('a',64),
        '{"finding":{"finding_type":"rewards.program_change"}}'::jsonb,
        true, '2026-01-01T00:00:01Z'
      );
    if not v_first.inserted or not v_first.acknowledged then
        raise exception 'first verified event was not durably accepted';
    end if;

    select * into v_retry
      from app_private.accept_agent_feed_event(
        'event_m25_primary', '0.1', 'm25.stream', 'run_m25_primary', 'finding_m25_primary',
        'finding.submitted', 'delivery-m25-primary-2', '2026-01-01T00:00:02Z', 'm25-key-1', 2,
        'sha256:' || repeat('9',64),
        'sha256:' || repeat('1',64),
        '{"finding":{"finding_type":"rewards.program_change"}}'::jsonb,
        true, '2026-01-01T00:00:03Z'
      );
    if v_retry.inserted or not v_retry.duplicate or v_retry.receipt_id <> v_first.receipt_id then
        raise exception 'transport retry did not insert-or-get one receipt';
    end if;
    if (select count(*) from app_private.agent_feed_receipts where event_id = 'event_m25_primary') <> 1
       or (select count(*) from app_private.agent_feed_delivery_attempts where receipt_id = v_first.receipt_id) <> 2
       or (select payload_hash from app_private.agent_feed_receipts where id = v_first.receipt_id) <> 'sha256:' || repeat('9',64)
       or (select transport_payload_hash from app_private.agent_feed_delivery_attempts
            where receipt_id = v_first.receipt_id and attempt_number = 2) <> 'sha256:' || repeat('1',64) then
        raise exception 'transport receipt/attempt cardinality is incorrect';
    end if;
    if app_private.record_agent_feed_delivery_attempt(
          v_first.receipt_id, 'delivery-m25-primary-2', 2,
          '2026-01-01T00:00:02Z', 'm25-key-1', 'sha256:' || repeat('1',64),
          'replayed', null, null, '{}'::jsonb
       ) is distinct from (
          select id from app_private.agent_feed_delivery_attempts
           where receipt_id = v_first.receipt_id and attempt_number = 2
       ) then
        raise exception 'idempotent delivery-attempt diagnostic lookup failed';
    end if;
    begin
        perform app_private.record_agent_feed_delivery_attempt(
          v_first.receipt_id, 'delivery-m25-primary-2-drift', 2,
          '2026-01-01T00:00:02Z', 'm25-key-1', 'sha256:' || repeat('1',64),
          'replayed', null, null, '{}'::jsonb
        );
        raise exception 'delivery-attempt identity drift was accepted';
    exception when sqlstate '22000' then
        null;
    end;
    begin
        perform app_private.accept_agent_feed_event(
          'event_m25_primary', '0.1', 'm25.stream', 'run_m25_primary', 'finding_m25_primary',
          'finding.submitted', 'delivery-m25-primary-3', '2026-01-01T00:00:04Z', 'm25-key-1', 3,
          'sha256:' || repeat('0',64), 'sha256:' || repeat('2',64), '{}'::jsonb,
          true, '2026-01-01T00:00:05Z'
        );
        raise exception 'stable payload drift was accepted for an existing event id';
    exception when sqlstate '22000' then
        null;
    end;

    select * into v_first
      from app_private.map_agent_feed_finding(
        v_first.receipt_id, 'so_m25_primary',
        '["source.m25"]'::jsonb,
        '[{"type":"program","id":"m25","name":"M25 synthetic"}]'::jsonb,
        'reward_rate', 'Synthetic rate lead',
        '{"occurred_at":null,"effective_from":"2026-01-02T00:00:00Z","effective_to":null}'::jsonb,
        '{"source_authority_claim":"primary","evidence_completeness":"partial","agent_confidence":0.99}'::jsonb,
        '["af-proof-1"]'::jsonb,
        '{"campaign":"m25"}'::jsonb,
        '[]'::jsonb,
        'sha256:' || repeat('b',64), 1
      );
    if v_first.mapping_status <> 'mapped' or v_first.observation_id is null or v_first.semantic_duplicate then
        raise exception 'first semantic finding was not mapped';
    end if;
    v_observation_id := v_first.observation_id;

    select * into v_retry
      from app_private.accept_agent_feed_event(
        'event_m25_semantic_duplicate', '0.1', 'm25.stream', 'run_m25_primary', 'finding_m25_duplicate',
        'finding.submitted', 'delivery-m25-semantic-1', '2026-01-01T00:00:04Z', 'm25-key-1', 1,
        'sha256:' || repeat('8',64),
        'sha256:' || repeat('c',64),
        '{"finding":{"finding_type":"rewards.program_change","duplicate":true}}'::jsonb,
        true, '2026-01-01T00:00:05Z'
      );
    select * into v_retry
      from app_private.map_agent_feed_finding(
        v_retry.receipt_id, 'so_m25_duplicate',
        '["source.m25"]'::jsonb,
        '[{"type":"program","id":"m25","name":"M25 synthetic"}]'::jsonb,
        'reward_rate', 'Synthetic rate lead',
        '{"occurred_at":null,"effective_from":"2026-01-02T00:00:00Z","effective_to":null}'::jsonb,
        '{"source_authority_claim":"third_party","evidence_completeness":"lead_only","agent_confidence":0.2}'::jsonb,
        '["af-proof-2"]'::jsonb,
        '{"campaign":"m25"}'::jsonb,
        '[]'::jsonb,
        'sha256:' || repeat('b',64), 1
      );
    if v_retry.mapping_status <> 'duplicate' or not v_retry.semantic_duplicate
       or v_retry.observation_id <> v_observation_id then
        raise exception 'semantic duplicate was not explicitly linked to canonical observation';
    end if;
    if (select count(*) from app_private.source_observations
        where semantic_fingerprint_version = 1 and semantic_fingerprint = 'sha256:' || repeat('b',64)) <> 1
       or (select count(*) from app_private.source_observation_transport_links
        where semantic_fingerprint_version = 1 and semantic_fingerprint = 'sha256:' || repeat('b',64)) <> 2 then
        raise exception 'semantic fingerprint registry/link cardinality is incorrect';
    end if;
    if (select canonical_document->>'observation_id' from app_private.source_observations where id = v_observation_id) <> 'so_m25_primary'
       or (select canonical_document->'canonical_evidence_ids' from app_private.source_observations where id = v_observation_id) <> '[]'::jsonb
       or (select source_ids from app_private.source_observations where id = v_observation_id) <> '["source.m25"]'::jsonb
       or (select effective_time->>'effective_from' from app_private.source_observations where id = v_observation_id) is null
       or (select canonical_document ? 'occurred_at' from app_private.source_observations where id = v_observation_id)
       or (select count(*) from app_private.source_observations as o,
               lateral jsonb_object_keys(o.canonical_document) as k
              where o.id = v_observation_id) <> 17 then
        raise exception 'SourceObservation canonical document/query-column alignment failed';
    end if;
    if (select promotion_status from app_private.source_observation_submitted_evidence
        where observation_id = v_observation_id and agent_feed_evidence_id = 'af-proof-1') <> 'lead_only' then
        raise exception 'submitted evidence was not staged as lead-only';
    end if;

    -- The canonical SourceObservation schema permits an empty source_ids
    -- array when a generic finding has not yet resolved a canonical source.
    select * into v_retry
      from app_private.accept_agent_feed_event(
        'event_m25_sourceless', '0.1', 'm25.stream', 'run_m25_primary', 'finding_m25_sourceless',
        'finding.submitted', 'delivery-m25-sourceless-1', '2026-01-01T00:00:06Z', 'm25-key-1', 1,
        'sha256:' || repeat('5',64), 'sha256:' || repeat('4',64), '{}'::jsonb,
        true, '2026-01-01T00:00:07Z'
      );
    select * into v_retry
      from app_private.map_agent_feed_finding(
        v_retry.receipt_id, 'so_m25_sourceless', '[]'::jsonb,
        '[{"type":"program","id":"unresolved","name":"Unresolved source"}]'::jsonb,
        'announcement', 'Source-less valid discovery lead',
        '{"occurred_at":null,"effective_from":null,"effective_to":null}'::jsonb,
        '{"source_authority_claim":"unknown","evidence_completeness":"lead_only","agent_confidence":0.1}'::jsonb,
        '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 'sha256:' || repeat('3',64), 1
      );
    if v_retry.mapping_status <> 'mapped'
       or (select source_ids from app_private.source_observations where id = v_retry.observation_id) <> '[]'::jsonb then
        raise exception 'schema-valid source-less observation was rejected';
    end if;

    -- Unknown and hostile findings are terminally quarantined without an
    -- observation, extraction candidate, or reward rule.
    select * into v_retry
      from app_private.accept_agent_feed_event(
        'event_m25_unknown', '0.1', 'm25.stream', 'run_m25_unknown', 'finding_m25_unknown',
        'finding.submitted', 'delivery-m25-unknown-1', '2026-01-01T00:01:00Z', 'm25-key-1', 1,
        'sha256:' || repeat('7',64), 'sha256:' || repeat('d',64), '{}', true, '2026-01-01T00:01:01Z'
      );
    select * into v_retry
      from app_private.map_agent_feed_finding(
        v_retry.receipt_id, 'so_m25_unknown', '["source.m25"]'::jsonb,
        '[{"type":"program","id":"unknown","name":"Unknown"}]'::jsonb,
        'unknown', 'Unknown finding type',
        '{"occurred_at":null,"effective_from":null,"effective_to":null}'::jsonb,
        '{"source_authority_claim":"unknown","evidence_completeness":"lead_only","agent_confidence":null}'::jsonb,
        '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, null, 1
      );
    if v_retry.mapping_status <> 'quarantined' or not v_retry.quarantined then
        raise exception 'unknown finding was not quarantined';
    end if;
    if exists (select 1 from app_private.source_observations where receipt_id = v_retry.receipt_id)
       or not exists (select 1 from app_private.agent_feed_dead_letters where receipt_id = v_retry.receipt_id) then
        raise exception 'unknown finding created observation or omitted DLQ';
    end if;

    select * into v_retry
      from app_private.accept_agent_feed_event(
        'event_m25_hostile', '0.1', 'm25.stream', 'run_m25_hostile', 'finding_m25_hostile',
        'finding.submitted', 'delivery-m25-hostile-1', '2026-01-01T00:02:00Z', 'm25-key-1', 1,
        'sha256:' || repeat('6',64), 'sha256:' || repeat('e',64), '{}', true, '2026-01-01T00:02:01Z'
      );
    select * into v_retry
      from app_private.map_agent_feed_finding(
        v_retry.receipt_id, 'so_m25_hostile', '["source.m25"]'::jsonb,
        '[{"type":"program","id":"hostile","name":"Hostile"}]'::jsonb,
        'reward_rate', 'Hostile instruction',
        '{"occurred_at":null,"effective_from":null,"effective_to":null}'::jsonb,
        '{"source_authority_claim":"unknown","evidence_completeness":"lead_only","agent_confidence":null}'::jsonb,
        '[]'::jsonb, '{}'::jsonb, '["embedded_instruction"]'::jsonb, null, 1
      );
    if v_retry.mapping_status <> 'quarantined' or exists (select 1 from app_private.source_observations where receipt_id = v_retry.receipt_id) then
        raise exception 'hostile finding was not terminally quarantined without observation';
    end if;

    -- One-way observation transition.
    begin
        update app_private.source_observations set status = 'rejected' where id = v_observation_id;
        begin
            update app_private.source_observations set status = 'needs_evidence' where id = v_observation_id;
            raise exception 'observation terminal transition unexpectedly succeeded';
        exception when sqlstate '55000' then
            null;
        end;
        raise exception using errcode = 'ZX001', message = 'roll back terminal-transition fixture';
    exception when sqlstate 'ZX001' then
        null;
    end;

    -- ----------
    -- Rewards-owned evidence capture/hash/locator/review gate.
    -- ----------
    insert into app_private.trusted_sources (
        source_key, name, publisher, category, tier, publication_use, source_url,
        authority_scope, locale, geography, evidence_format, volatility,
        recommended_check_cadence, retrieval_method, requires_login, automation_status,
        terms_review_status, technical_feasibility, url_registered_on,
        content_verified_on, verification_status, registry_payload
    ) values (
        'src_m25_capture', 'M25 capture source', 'M25 test', 'rewards', 'T1_CANONICAL',
        'canonical', 'https://example.invalid/m25', '["m25"]', 'en-US', 'JP', 'html', 'low',
        'daily', 'test_fixture', false, 'enabled', 'approved', 'manual_capture_candidate',
        '2026-01-01', '2026-01-01', 'content_verified', '{"m25":true}'
    ) returning id into v_source_id;
    insert into app_private.source_snapshots (
        snapshot_key, source_id, fetched_at, requested_url, effective_url, http_status,
        content_type, raw_content_hash, normalized_content_hash, storage_uri,
        acquisition_method, parser_version, capture_complete, metadata, created_by
    ) values (
        'snap_m25_capture', v_source_id, '2026-01-02T00:00:00Z',
        'https://example.invalid/m25', 'https://example.invalid/m25', 200, 'text/html',
        'sha256:' || repeat('f',64), 'sha256:' || repeat('0',64), 'memory://m25',
        'test_fixture', 'm25', true, '{"m25":true}', 'db-test'
    ) returning id into v_snapshot_id;
    insert into app_private.evidence_records (
        evidence_key, source_snapshot_id, locator, excerpt_text, normalized_claim,
        supports, status, extraction_method, review_mode, required_review_modes,
        completed_review_modes, reviewed_by, reviewed_at
    ) values (
        'ev_m25_capture', v_snapshot_id, '{"line_start":1,"line_end":1}', 'M25 canonical excerpt',
        '{"rate_bps":100}', '[{"path":"rate_bps"}]', 'verified', 'manual_capture',
        'human_second_review', '{human_second_review}', '{human_second_review}',
        'm25-reviewer', '2026-01-03T00:00:00Z'
    ) returning id into v_evidence_id;
    select id into v_work_id from app_private.source_observation_evidence_work
     where observation_id = v_observation_id and agent_feed_evidence_id = 'af-proof-1';
    if v_work_id is null then
        raise exception 'evidence work row was not created';
    end if;
    begin
        perform app_private.promote_source_observation_evidence(v_observation_id, 'af-proof-1', v_evidence_id);
        raise exception 'promotion bypassed capture/review prerequisites';
    exception when sqlstate '55000' then
        null;
    end;
    update app_private.source_observation_evidence_work
       set work_status = 'capturing', permission_granted = true,
           permission_granted_by = 'm25-policy', permission_granted_at = '2026-01-03T00:00:00Z',
           source_snapshot_id = v_snapshot_id, capture_hash = 'sha256:' || repeat('f',64),
           locator = '{"line_start":1,"line_end":1}', captured_at = '2026-01-03T00:00:00Z'
     where id = v_work_id;
    update app_private.source_observation_evidence_work set work_status = 'captured' where id = v_work_id;
    update app_private.source_observation_evidence_work set work_status = 'under_review' where id = v_work_id;
    update app_private.source_observation_evidence_work
       set work_status = 'approved', reviewed_by = 'm25-reviewer', reviewed_at = '2026-01-03T00:01:00Z'
     where id = v_work_id;
    if (select work_status from app_private.source_observation_evidence_work where id = v_work_id) <> 'approved' then
        raise exception 'evidence work row did not reach approved state';
    end if;
    perform app_private.promote_source_observation_evidence(v_observation_id, 'af-proof-1', v_evidence_id);
    if (select canonical_evidence_ids from app_private.source_observations where id = v_observation_id) <> '["ev_m25_capture"]'::jsonb
       or (select promotion_status from app_private.source_observation_submitted_evidence
           where observation_id = v_observation_id and agent_feed_evidence_id = 'af-proof-1') <> 'promoted' then
        raise exception 'evidence promotion did not link canonical evidence';
    end if;
    begin
        update app_private.source_observation_submitted_evidence
           set promotion_status = 'lead_only'
         where observation_id = v_observation_id and agent_feed_evidence_id = 'af-proof-1';
        raise exception 'promoted evidence transition unexpectedly succeeded';
    exception when sqlstate '55000' then
        null;
    end;

    -- ----------
    -- Run lifecycle and cadence/grace boundary.
    -- ----------
    insert into app_private.monitor_stream_expectations (
        stream_id, expected_cadence_seconds, grace_seconds, enabled, owner,
        last_terminal_run_at, next_due_at, liveness_status
    ) values (
        'm25.lifecycle', 3600, 60, true, 'db-test',
        '2026-01-01T00:00:00Z', '2026-01-01T01:01:00Z', 'healthy'
    );
    insert into app_private.monitor_stream_sources (stream_id, source_id)
    values ('m25.lifecycle', v_source_id);
    perform app_private.sweep_overdue_monitor_streams('2026-01-01T01:01:00Z');
    if exists (select 1 from app_private.monitoring_incidents where stream_id = 'm25.lifecycle' and incident_type = 'overdue_run') then
        raise exception 'exact next_due_at boundary was marked overdue';
    end if;
    perform app_private.sweep_overdue_monitor_streams('2026-01-01T01:01:01Z');
    if not exists (select 1 from app_private.monitoring_incidents where stream_id = 'm25.lifecycle' and incident_type = 'overdue_run' and status = 'open')
       or (select freshness_status from app_private.source_monitoring_freshness where source_id = v_source_id) <> 'stale' then
        raise exception 'overdue incident/freshness downgrade missing';
    end if;
    v_run_id := app_private.record_agent_feed_run('m25.lifecycle','run-zero','completed',0,'{"expected":1}','{"checked":1}','2026-01-01T02:00:00Z','2026-01-01T02:00:00Z');
    if (select last_terminal_status from app_private.monitor_stream_expectations where stream_id = 'm25.lifecycle') <> 'completed'
       or (select last_terminal_finding_count from app_private.monitor_stream_expectations where stream_id = 'm25.lifecycle') <> 0
       or (select liveness_status from app_private.monitor_stream_expectations where stream_id = 'm25.lifecycle') <> 'healthy' then
        raise exception 'completed zero-finding run was not distinct and healthy';
    end if;
    perform app_private.record_agent_feed_run('m25.lifecycle','run-partial','partial',1);
    perform app_private.record_agent_feed_run('m25.lifecycle','run-failed','failed',0);
    perform app_private.record_agent_feed_run('m25.lifecycle','run-cancelled','cancelled',0);
    perform app_private.record_agent_feed_run('m25.lifecycle','run-zero','completed',0,'{}','{}',now(),now(),1,'run-zero');
    if not exists (select 1 from app_private.agent_feed_run_lifecycle where stream_id = 'm25.lifecycle' and run_state = 'replayed' and replay_attempt = 1)
       or (select count(*) from app_private.agent_feed_run_lifecycle where stream_id = 'm25.lifecycle' and run_state in ('partial','failed','cancelled')) <> 3
       or not exists (select 1 from app_private.monitoring_incidents where stream_id = 'm25.lifecycle' and incident_type = 'partial_run' and details->>'run_id' = 'run-partial')
       or not exists (select 1 from app_private.monitoring_incidents where stream_id = 'm25.lifecycle' and incident_type = 'failed_run' and details->>'run_id' = 'run-failed')
       or not exists (select 1 from app_private.monitoring_incidents where stream_id = 'm25.lifecycle' and incident_type = 'scope_degradation' and details->>'run_id' = 'run-cancelled') then
        raise exception 'partial/failed/cancelled/replayed run lifecycle states missing';
    end if;

    insert into app_private.monitor_stream_expectations (
        stream_id, expected_cadence_seconds, grace_seconds, enabled, owner, liveness_status
    ) values ('m25.never_seen', 3600, 60, true, 'db-test', 'never_seen');
    perform app_private.sweep_overdue_monitor_streams('2026-01-01T10:00:00Z');
    if (select liveness_status from app_private.monitor_stream_expectations where stream_id = 'm25.never_seen') <> 'never_seen'
       or not exists (select 1 from app_private.monitoring_incidents where stream_id = 'm25.never_seen' and incident_type = 'absent_expected_run') then
        raise exception 'never-seen/absent expectation was not distinguished';
    end if;

    -- ----------
    -- DLQ/replay diagnostics are redaction-safe and contain no payload.
    -- ----------
    v_dlq_id := app_private.enqueue_agent_feed_dead_letter(v_retry.receipt_id, 'hostile_test', '{"safe":"diagnostic"}'::jsonb, 'cursor-m25');
    v_replay_id := app_private.request_agent_feed_replay('event_m25_hostile', null, 'db-test');
    if not exists (select 1 from app_private.agent_feed_dead_letters where id = v_dlq_id and replay_status = 'requested')
       or not exists (select 1 from app_private.agent_feed_replay_requests where id = v_replay_id and status = 'requested') then
        raise exception 'DLQ/replay diagnostic state was not persisted';
    end if;
    update app_private.agent_feed_delivery_attempts
       set purge_after = now() - interval '1 day', diagnostic = '{}'::jsonb,
           redaction_status = 'complete', redacted_at = now()
     where receipt_id = v_first.receipt_id and attempt_number = 1;
    update app_private.agent_feed_dead_letters
       set purge_after = now() - interval '1 day', diagnostic = '{}'::jsonb,
           redaction_status = 'complete', redacted_at = now()
     where id = v_dlq_id;
    update app_private.agent_feed_replay_requests
       set purge_after = now() - interval '1 day', diagnostic = '{}'::jsonb,
           redaction_status = 'complete', redacted_at = now()
     where id = v_replay_id;
    update app_private.agent_feed_receipts
       set purge_after = now() - interval '1 day'
     where id = v_retry.receipt_id;
    perform app_private.redact_expired_agent_feed_receipts(now());
    if (select raw_payload from app_private.agent_feed_receipts where id = v_retry.receipt_id) <> '{}'::jsonb
       or exists (select 1 from app_private.agent_feed_delivery_attempts where receipt_id = v_first.receipt_id and attempt_number = 1 and diagnostic <> '{}'::jsonb)
       or (select diagnostic from app_private.agent_feed_dead_letters where id = v_dlq_id) <> '{}'::jsonb
       or (select diagnostic from app_private.agent_feed_replay_requests where id = v_replay_id) <> '{}'::jsonb then
        raise exception 'redaction/purge left diagnostic payload material';
    end if;

    -- No database-boundary escape hatches or Realtime delivery objects.
    if exists (select 1 from pg_foreign_server)
       or exists (
           select 1 from pg_proc
            where lower(prosrc) like '%dblink%'
               or lower(prosrc) like '%postgres_fdw%'
               or lower(prosrc) like '%realtime%'
       ) then
        raise exception 'cross-database or Realtime construct detected';
    end if;
end
$$;

rollback;
