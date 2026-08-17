\set ON_ERROR_STOP on
begin;

insert into app_private.monitor_stream_expectations (
  stream_id, expected_cadence_seconds, grace_seconds, enabled, owner,
  last_terminal_run_at, next_due_at, liveness_status
) values (
  'rewards.test.daily', 3600, 60, true, 'db-test',
  '2026-08-17T00:00:00Z', '2026-08-17T01:01:00Z', 'healthy'
);

select app_private.sweep_overdue_monitor_streams('2026-08-17T02:00:00Z');
do $$
begin
  if not exists (
    select 1 from app_private.monitoring_incidents
     where stream_id='rewards.test.daily' and incident_type='overdue_run' and status='open'
  ) then raise exception 'missing overdue-run incident'; end if;
end $$;

select app_private.record_monitor_terminal_run(
  'rewards.test.daily','2026-08-17T02:05:00Z','completed'
);
do $$
begin
  if (select liveness_status from app_private.monitor_stream_expectations where stream_id='rewards.test.daily') <> 'healthy'
  then raise exception 'terminal run did not recover liveness'; end if;
end $$;

-- Successfully mapped receipts cannot retain unredacted pending payloads.
do $$
begin
  begin
    insert into app_private.agent_feed_receipts (
      event_id, protocol_version, stream_id, run_id, event_type,
      payload_hash, raw_payload, processing_status, redaction_status
    ) values (
      'event-redaction-test','0.1','rewards.test.daily','run-test','finding.submitted',
      'sha256:' || repeat('1',64),'{}'::jsonb,'mapped','pending'
    );
    raise exception 'expected terminal redaction constraint violation';
  exception when check_violation then null;
  end;
end $$;

insert into app_private.agent_feed_receipts (
  event_id, protocol_version, stream_id, run_id, finding_id, event_type,
  payload_hash, raw_payload, processing_status, redaction_status
) values (
  'event-transition-test','0.1','rewards.test.daily','run-test','finding-test','finding.submitted',
  'sha256:' || repeat('2',64),'{}'::jsonb,'mapped','complete'
);

insert into app_private.source_observations (
  observation_key, receipt_id, semantic_fingerprint, source_keys, subjects,
  change_type, summary, discovery_assessment, status
)
select 'so_transition_test', id, 'sha256:' || repeat('3',64), '[]'::jsonb,
       '[{"type":"program","id":"demo","name":"Demo"}]'::jsonb,
       'unknown','Synthetic transition test','{}'::jsonb,'rejected'
from app_private.agent_feed_receipts where event_id='event-transition-test';

do $$
begin
  begin
    update app_private.source_observations set status='new' where observation_key='so_transition_test';
    raise exception 'expected terminal observation transition violation';
  exception when raise_exception then
    if sqlerrm = 'expected terminal observation transition violation' then raise; end if;
  end;
end $$;

rollback;
