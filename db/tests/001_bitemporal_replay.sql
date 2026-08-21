\set ON_ERROR_STOP on

begin;

insert into app_private.reward_rules (
    rule_key, rule_type, name, lifecycle_status, created_by
) values (
    'rr_test_bitemporal_overlap', 'base_reward', 'Bitemporal overlap test', 'published', 'db-test'
);

insert into app_private.reward_rule_versions (
    rule_id, version, definition, definition_hash,
    valid_from, valid_to, recorded_at, superseded_at,
    review_status, review_mode, required_review_modes, completed_review_modes, reviewed_by, reviewed_at,
    change_reason, created_by
)
select id, 1, '{}'::jsonb, 'sha256:' || repeat('1', 64),
       '2026-01-01T00:00:00Z', null,
       '2026-02-01T00:00:00Z', '2026-09-01T00:00:00Z',
       'approved', 'human_second_review', array['human_second_review'], array['human_second_review'], 'db-test', '2026-02-01T00:00:00Z',
       'test v1', 'db-test'
from app_private.reward_rules where rule_key = 'rr_test_bitemporal_overlap';

-- This backdated version overlaps v1 in both economic and system time and must fail.
do $$
begin
    begin
        insert into app_private.reward_rule_versions (
            rule_id, version, definition, definition_hash,
            valid_from, valid_to, recorded_at, superseded_at,
            review_status, review_mode, required_review_modes, completed_review_modes, reviewed_by, reviewed_at,
            change_reason, created_by
        )
        select id, 2, '{}'::jsonb, 'sha256:' || repeat('2', 64),
               '2026-03-01T00:00:00Z', null,
               '2026-04-01T00:00:00Z', '2026-09-01T00:00:00Z',
               'approved', 'human_second_review', array['human_second_review'], array['human_second_review'], 'db-test', '2026-04-01T00:00:00Z',
               'ambiguous backdated test', 'db-test'
        from app_private.reward_rules where rule_key = 'rr_test_bitemporal_overlap';
        raise exception 'expected bitemporal exclusion violation';
    exception
        when exclusion_violation then null;
    end;
end
$$;

insert into app_private.reward_rules (
    rule_key, rule_type, name, lifecycle_status, created_by
) values (
    'rr_test_bitemporal_adjacent', 'base_reward', 'Bitemporal adjacency test', 'published', 'db-test'
);

-- Adjacent system intervals are valid even when economic intervals overlap.
insert into app_private.reward_rule_versions (
    rule_id, version, definition, definition_hash,
    valid_from, valid_to, recorded_at, superseded_at,
    review_status, review_mode, required_review_modes, completed_review_modes, reviewed_by, reviewed_at,
    change_reason, created_by
)
select id, 1, '{}'::jsonb, 'sha256:' || repeat('3', 64),
       '2026-01-01T00:00:00Z', null,
       '2026-02-01T00:00:00Z', '2026-04-01T00:00:00Z',
       'approved', 'human_second_review', array['human_second_review'], array['human_second_review'], 'db-test', '2026-02-01T00:00:00Z',
       'adjacent v1', 'db-test'
from app_private.reward_rules where rule_key = 'rr_test_bitemporal_adjacent';

insert into app_private.reward_rule_versions (
    rule_id, version, definition, definition_hash,
    valid_from, valid_to, recorded_at, superseded_at,
    review_status, review_mode, required_review_modes, completed_review_modes, reviewed_by, reviewed_at,
    change_reason, created_by
)
select id, 2, '{}'::jsonb, 'sha256:' || repeat('4', 64),
       '2026-03-01T00:00:00Z', null,
       '2026-04-01T00:00:00Z', null,
       'approved', 'human_second_review', array['human_second_review'], array['human_second_review'], 'db-test', '2026-04-01T00:00:00Z',
       'adjacent v2', 'db-test'
from app_private.reward_rules where rule_key = 'rr_test_bitemporal_adjacent';

-- Representative replay pairs must return at most one version.  Include both
-- generated points and every half-open boundary: a replay implementation must
-- not become ambiguous only at the exact instant a validity interval opens or
-- closes.
do $$
declare
    max_matches bigint;
begin
    with tx_points as (
        select ts
        from (values
            ('2026-01-01T00:00:00Z'::timestamptz),
            ('2026-03-01T00:00:00Z'::timestamptz),
            ('2026-04-01T00:00:00Z'::timestamptz),
            ('2026-06-01T00:00:00Z'::timestamptz)
        ) as v(ts)
        union
        select '2026-01-01T00:00:00Z'::timestamptz + n * interval '7 days'
        from generate_series(0, 28) as g(n)
    ),
    knowledge_points as (
        select ts
        from (values
            ('2026-02-01T00:00:00Z'::timestamptz),
            ('2026-04-01T00:00:00Z'::timestamptz),
            ('2026-05-01T00:00:00Z'::timestamptz),
            ('2026-09-01T00:00:00Z'::timestamptz)
        ) as v(ts)
        union
        select '2026-02-01T00:00:00Z'::timestamptz + n * interval '7 days'
        from generate_series(0, 28) as g(n)
    ),
    replay_pairs as (
        select tx.ts as transaction_time, kt.ts as knowledge_time
        from tx_points tx cross join knowledge_points kt
    ),
    replay_counts as (
        select p.transaction_time, p.knowledge_time, count(rrv.id) as matches
        from replay_pairs p
        left join app_private.reward_rules rr
          on rr.rule_key = 'rr_test_bitemporal_adjacent'
        left join app_private.reward_rule_versions rrv
          on rrv.rule_id = rr.id
         and rrv.review_status = 'approved'
         and rrv.valid_from <= p.transaction_time
         and (rrv.valid_to is null or rrv.valid_to > p.transaction_time)
         and rrv.recorded_at <= p.knowledge_time
         and (rrv.superseded_at is null or rrv.superseded_at > p.knowledge_time)
        group by p.transaction_time, p.knowledge_time
    )
    select coalesce(max(matches), 0)
      into max_matches
      from replay_counts;

    if max_matches > 1 then
        raise exception 'ambiguous generated replay pair: maximum % matches', max_matches;
    end if;

    -- Explicitly assert both sides of the half-open boundaries.  A version is
    -- visible at its start and not visible at its economic/system end.
    if (select count(*)
        from app_private.reward_rules rr
        join app_private.reward_rule_versions rrv on rrv.rule_id = rr.id
        where rr.rule_key = 'rr_test_bitemporal_adjacent'
          and rrv.review_status = 'approved'
          and rrv.valid_from <= '2026-03-01T00:00:00Z'::timestamptz
          and (rrv.valid_to is null or rrv.valid_to > '2026-03-01T00:00:00Z'::timestamptz)
          and rrv.recorded_at <= '2026-04-01T00:00:00Z'::timestamptz
          and (rrv.superseded_at is null or rrv.superseded_at > '2026-04-01T00:00:00Z'::timestamptz)
       ) <> 1 then
        raise exception 'expected exactly one adjacent replay result at boundary';
    end if;
end
$$;

rollback;
