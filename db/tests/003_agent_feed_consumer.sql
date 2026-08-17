\set ON_ERROR_STOP on
begin;

insert into app_private.agent_feed_receipts (
  event_id, protocol_version, stream_id, run_id, finding_id, event_type,
  payload_hash, raw_payload
) values (
  'event_test_001', '0.1', 'rewards-optimizer.source-monitor', 'run_test_001',
  'finding_test_001', 'finding.submitted',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '{"synthetic":true}'::jsonb
);

-- Duplicate transport event must be rejected by the unique event receipt.
do $$
begin
  begin
    insert into app_private.agent_feed_receipts (
      event_id, protocol_version, stream_id, run_id, finding_id, event_type,
      payload_hash, raw_payload
    ) values (
      'event_test_001', '0.1', 'rewards-optimizer.source-monitor', 'run_test_001',
      'finding_test_001', 'finding.submitted',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '{"synthetic":true}'::jsonb
    );
    raise exception 'duplicate Agent Feed event was not rejected';
  exception when unique_violation then null;
  end;
end $$;

insert into app_private.source_observations (
  observation_key, receipt_id, semantic_fingerprint, source_keys, subjects,
  change_type, summary, discovery_assessment, raw_attributes, status
)
select
  'so_test_001', id,
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '["jp.synthetic"]'::jsonb,
  '[{"type":"payment_program","id":"synthetic","name":"Synthetic"}]'::jsonb,
  'funding_route', 'Synthetic lead only',
  '{"source_authority_claim":"primary","evidence_completeness":"partial","agent_confidence":0.9}'::jsonb,
  '{"canonical_source_capture_required":true}'::jsonb,
  'needs_evidence'
from app_private.agent_feed_receipts where event_id = 'event_test_001';

-- Staging observations intentionally have no direct reward-rule reference.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='app_private' and table_name='source_observations'
      and column_name in ('reward_rule_id','reward_rule_version_id')
  ) then
    raise exception 'source observation must not directly publish/link a reward rule';
  end if;
end $$;

rollback;
