# Scenario research queue v0.3

`scenario-coverage-plan.v0.3.yaml` contains exactly 100 research targets with the retained 40 single-rule / 40 stacking / 20 adversarial distribution.

The plan covers top-ups, vouchers, residual balances, charge rewards, limited points, unknown state, probabilistic campaigns, refunds/clawbacks, transfers, and bitemporal boundaries.

These records are not expected truth. A scenario becomes golden only through `docs/06_golden_scenario_program.md` and the review policy in `docs/04_implementation_plan.md`.

For the first ten scenarios:

- low/medium-risk purchase cases use at least `solo_dual_pass`;
- transfer, large-campaign, annual-fee, or credible loss-causing cases require `human_second_review` before golden;
- unavailable review means the feature remains outside the alpha rather than being mislabeled verified.
