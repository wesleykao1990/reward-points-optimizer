-- Staged from db/0037_credit_card_rule_review_gate_scope.sql; edit the canonical source, not this file.
-- The operator explicitly removed separate rule-level publication gates for
-- the credit-card coverage workflow. Preserve the existing requirement for
-- every other publisher; only rule versions created by this trusted workflow
-- may have zero required rule-review modes. Evidence remains verified through
-- the completed solo_dual_pass mode.

begin;

alter table app_private.reward_rule_versions
  drop constraint if exists reward_rule_versions_check2;

alter table app_private.reward_rule_versions
  add constraint reward_rule_versions_check2 check (
    review_status <> 'approved'
    or (
      reviewed_at is not null
      and (
        (
          created_by = 'chatgpt-credit-card-coverage'
          and cardinality(required_review_modes) = 0
          and cardinality(completed_review_modes) = 0
          and review_mode is null
        )
        or (
          review_mode is not null
          and cardinality(required_review_modes) > 0
          and required_review_modes <@ completed_review_modes
        )
      )
    )
  );

commit;
