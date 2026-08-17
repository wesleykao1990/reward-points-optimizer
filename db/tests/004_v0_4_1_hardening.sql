\set ON_ERROR_STOP on
begin;

insert into app_private.reward_rules (rule_key, rule_type, name, lifecycle_status, created_by)
values ('rr_test_hash_reuse', 'base_reward', 'Definition hash reuse', 'published', 'db-test');

-- The same canonical economic definition may legitimately recur in non-overlapping history.
insert into app_private.reward_rule_versions (
  rule_id, version, definition, definition_hash, valid_from, valid_to,
  recorded_at, superseded_at, review_status, review_mode,
  required_review_modes, completed_review_modes, reviewed_by, reviewed_at,
  change_reason, created_by
)
select id, 1, '{"model":"percentage","rate_bps":100}'::jsonb,
       'sha256:' || repeat('a',64),
       '2026-01-01T00:00:00Z','2026-03-01T00:00:00Z',
       '2026-01-01T00:00:00Z','2026-03-01T00:00:00Z',
       'approved','human_second_review',array['human_second_review'],array['human_second_review'],
       'db-test','2026-01-01T00:00:00Z','first interval','db-test'
from app_private.reward_rules where rule_key='rr_test_hash_reuse';

insert into app_private.reward_rule_versions (
  rule_id, version, definition, definition_hash, valid_from, valid_to,
  recorded_at, superseded_at, review_status, review_mode,
  required_review_modes, completed_review_modes, reviewed_by, reviewed_at,
  change_reason, created_by
)
select id, 2, '{"model":"percentage","rate_bps":100}'::jsonb,
       'sha256:' || repeat('a',64),
       '2026-03-01T00:00:00Z',null,
       '2026-03-01T00:00:00Z',null,
       'approved','human_second_review',array['human_second_review'],array['human_second_review'],
       'db-test','2026-03-01T00:00:00Z','reintroduced definition','db-test'
from app_private.reward_rules where rule_key='rr_test_hash_reuse';

-- Approved rows cannot claim completion without satisfying required review modes.
do $$
begin
  begin
    insert into app_private.reward_rule_versions (
      rule_id, version, definition, definition_hash, valid_from, valid_to,
      recorded_at, superseded_at, review_status, review_mode,
      required_review_modes, completed_review_modes, reviewed_by, reviewed_at,
      change_reason, created_by
    )
    select id, 3, '{"model":"percentage","rate_bps":200}'::jsonb,
           'sha256:' || repeat('b',64),
           '2027-01-01T00:00:00Z',null,
           '2027-01-01T00:00:00Z',null,
           'approved','human_second_review',array['human_second_review'],array[]::text[],
           'db-test','2027-01-01T00:00:00Z','missing review','db-test'
    from app_private.reward_rules where rule_key='rr_test_hash_reuse';
    raise exception 'expected required review constraint violation';
  exception when check_violation then null;
  end;
end $$;

-- Publication retries use an explicit idempotency key rather than definition hash uniqueness.
insert into app_private.rule_publication_requests (
  rule_id, idempotency_key, request_hash, status, created_by
)
select id, 'publish-request-1', 'sha256:' || repeat('c',64), 'received', 'db-test'
from app_private.reward_rules where rule_key='rr_test_hash_reuse';

do $$
begin
  begin
    insert into app_private.rule_publication_requests (
      rule_id, idempotency_key, request_hash, status, created_by
    )
    select id, 'publish-request-1', 'sha256:' || repeat('d',64), 'received', 'db-test'
    from app_private.reward_rules where rule_key='rr_test_hash_reuse';
    raise exception 'expected publication idempotency conflict';
  exception when unique_violation then null;
  end;
end $$;

rollback;
