# M3 non-human seed experiment review — 2026-08-18

## Decision

The experiment is `BLOCKED` for golden promotion: 9/9 evaluated scenarios remain blocked and 0 were promoted. This is the expected fail-closed result, not a failed experiment. `JP-XFR-002` was excluded as `excluded_requires_separate_human_review` and was not evaluated.

The machine-readable record is [non-human-seed-experiment-2026-08-18.v0.1.json](../../fixtures/m3/non-human-seed-experiment-2026-08-18.v0.1.json).

## Design and boundary

The run audited the exact ten-seed blueprint against the trusted-source registry, source-review queue, and source-access observations, and included manual-browser research/access on 2026-08-18. Automated collection was not attempted. No page bodies/raw captures were stored, and the run did not create candidate calculation artifacts, run the engine, or attempt promotion. Manual reachability is recorded as a probe result only; it is not treated as permission, approved evidence, or a current rule capture. The registry, queue, and observation inputs remain 2026-08-17 snapshots.

The source gate found 10 blocked scenarios over 18 unique declared sources. There were 0 automation-ready and 0 promotion-ready sources or scenarios. The 107 promotion blockers are explained by:

- 18 registry terms statuses still `not_reviewed`;
- 18 review-queue terms statuses still `not_reviewed`;
- 18 registry collection paths and 18 review-queue paths still `requires_terms_review`;
- 17 sources with unknown technical feasibility and no declared observation;
- 1 source with manual-only reachability (`jp.paypay.third-party-card-voucher`), which does not authorize automated collection or promotion.

## Terms assessment distinction

The manifest's `terms_assessment` is a review-only observation from the manual-browser pass. It does not mutate the registry/queue, determine legal permission, or change the source-gate counts.

| Review assessment | Sources |
| --- | --- |
| Restricted observed for terms/storage/capture handling | `merchant.seveneleven.payment-faq`, `merchant.seveneleven.nanaco`, `jp.nanaco.earning`, `jp.dpoint.campaign-example-funding-exclusion`, `jp.dcard.exclusions` |
| Unresolved / not reviewed (including both SMBC sources) | `jp.ana.rakuten-transfer`, `jp.aupay.campaigns`, `jp.dbarai.campaigns`, `jp.paypay.calculation-faq`, `jp.paypay.campaigns`, `jp.paypay.eligibility-faq`, `jp.paypay.third-party-card-voucher`, `jp.rakutenpay.change-notice-2026`, `jp.rebates.guide`, `jp.smbc.eligible-merchant-rewards`, `jp.smbc.vpoint-up-program`, `merchant.amazonjp.points-terms`, `merchant.yahoo-shopping.paypay-points` |

## Scenario outcomes

| Scenario | Readiness | Probe/research boundary | Promotion |
| --- | --- | --- | --- |
| `JP-CVS-002` | `BLOCKED` | Seven-Eleven payment FAQ manually reached; payment-class scoping is a follow-up note only | `BLOCKED` |
| `JP-CVS-006` | `BLOCKED` | Nanaco pages manually reached; credit-load reward/expiry/limit details unresolved | `BLOCKED` |
| `JP-CVS-014` | `BLOCKED` | SMBC pages manually reached; contactless scope noted, V Point Up extra and capture terms unresolved | `BLOCKED` |
| `JP-QR-007` | `BLOCKED` | Exact terms/content not freshly captured; funding-source match is only a negative-assertion lead | `BLOCKED` |
| `JP-QR-008` | `BLOCKED` | Voucher availability/current details unknown; manual reachability does not establish feature state | `BLOCKED` |
| `JP-CMP-003` | `BLOCKED` | d払い limited-reward and PayPay lottery routes have different semantics/dates; comparison is incoherent | `BLOCKED` |
| `JP-CMP-007` | `BLOCKED` | PayPay lottery maximum is not guaranteed; au PAY terms/probability are absent | `BLOCKED` |
| `JP-CMP-009` | `BLOCKED` | Prior announcement/postponement lead lacks fresh valid-time capture | `BLOCKED` |
| `JP-ECOM-012` | `BLOCKED` | Amazon unavailable; Rebates/Yahoo cancellation behavior is partial and refund/progress restoration unestablished | `BLOCKED` |

All 12 declared negative assertions remain unchecked (`status: BLOCKED`). They are preserved as invariant targets, not passed facts. No scenario has approved evidence, completed independent calculation, engine replay, or review event in this run.

## Follow-up required before any promotion

1. Resolve source-specific terms, permitted capture/storage method, and technical observation for every declared source.
2. Capture only permitted, immutable first-party evidence and map every primary source explicitly.
3. Complete the independent calculation before any engine replay; then perform the required `solo_dual_pass` and `agent_challenged` review sequence for the nine non-transfer scenarios.
4. Handle `JP-XFR-002` in a separate human-second-review lane; do not fold it into this manifest's non-human result.

## Deferred transfer review — 2026-08-19

The project owner deferred the detailed `JP-XFR-002` human review so Milestone 4 can begin. The owner independently confirmed only that the registered source is an official ANA page about converting Rakuten Points to ANA miles and reported a ratio of 2 Rakuten Points to 1 ANA mile.

This statement is retained as a human-supplied research note, not approved evidence or a completed `human_second_review`. Minimums, increments, caps, posting delay, cancellation, eligible point classes, source-use permission, boundary calculations, and independent reconciliation remain unresolved. `JP-XFR-002` therefore remains below `golden` and promotion-blocked until the detailed review resumes.
