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

-- Representative replay pairs must return at most one version.
do $$
declare
    tx timestamptz;
    kt timestamptz;
    matches integer;
begin
    foreach tx in array array[
        '2026-02-15T00:00:00Z'::timestamptz,
        '2026-03-15T00:00:00Z'::timestamptz,
        '2026-06-01T00:00:00Z'::timestamptz
    ] loop
        foreach kt in array array[
            '2026-03-01T00:00:00Z'::timestamptz,
            '2026-04-01T00:00:00Z'::timestamptz,
            '2026-05-01T00:00:00Z'::timestamptz
        ] loop
            select count(*) into matches
            from app_private.reward_rule_versions rrv
            join app_private.reward_rules rr on rr.id = rrv.rule_id
            where rr.rule_key = 'rr_test_bitemporal_adjacent'
              and rrv.review_status = 'approved'
              and rrv.valid_from <= tx
              and (rrv.valid_to is null or rrv.valid_to > tx)
              and rrv.recorded_at <= kt
              and (rrv.superseded_at is null or rrv.superseded_at > kt);
            if matches > 1 then
                raise exception 'ambiguous replay for tx %, knowledge %: % matches', tx, kt, matches;
            end if;
        end loop;
    end loop;
end
$$;

rollback;
