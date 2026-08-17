# Golden Scenario Program v0.3

## 1. Purpose

The 100 scenarios are a challenge set for engine correctness and data operations. They are not a consumer survey and are not required before a narrowly scoped alpha.

## 2. Status progression

```text
planned -> researched -> calculated -> reviewed -> golden -> superseded | retired
```

A golden fixture is immutable, versioned, replayed in CI, and labeled with the review mode that actually occurred.

## 3. Distribution

The v0.3 plan retains:

- 40 Level 1 single-rule scenarios;
- 40 Level 2 stacking scenarios;
- 20 Level 3 adversarial scenarios.

It now explicitly includes top-up/voucher routes, residual balances, uncertainty, probabilistic campaigns, reward classes, and clawbacks.

## 4. Required contents

Each fixture records:

- transaction and replay-knowledge timestamps;
- an enclosing objective and frozen comparison facts;
- candidate operation plans and dependencies;
- opening user-owned lots, requested principal outputs, engine-emitted movements, and ending asset lots;
- merchant/location/channel/product facts;
- owned instruments and loyalty programs;
- known, estimated, unknown, and not-applicable user facts;
- reward valuations by asset/class/expiry horizon;
- candidate plans;
- definite winner or conditional winners;
- runner-up where meaningful;
- complete principal-movement and reward-component ledgers;
- reconciled merchant value, external funding, opening asset consumption, ending assets, rewards, fees, and net value;
- posting, expiry, restrictions, certainty, and clawback;
- cap state and ranges;
- applied and rejected rule versions;
- negative assertions;
- evidence and review metadata.

## 5. Independent calculation

The expected result must be calculated before reading engine output.

For a solo build:

1. calculate in a separate worksheet;
2. preserve the worksheet artifact;
3. do not view engine output during the calculation;
4. wait through the recorded cooling-off period;
5. reread raw evidence;
6. complete the checklist;
7. compare movements, reward components, ending assets, and the complete economic reconciliation.

A model audit can challenge the result but does not become the accountable reviewer.

## 6. Review modes

- `solo_dual_pass` — honest solo workflow.
- `agent_challenged` — additional independent model/deterministic challenge.
- `human_second_review` — another person reproduces the result.
- `expert_review` — specialist approval for high-loss or regulated cases.

## 7. Review policy for the first ten seed scenarios

The first research batch uses an explicit, non-aspirational policy:

| Seed scenario | Required mode before golden |
|---|---|
| `JP-XFR-002` — Rakuten Point to ANA transfer | `human_second_review` |
| The other nine seed scenarios | `solo_dual_pass`, followed by an `agent_challenged` discrepancy pass |

Any scenario escalates to `human_second_review` or `expert_review` when source wording is ambiguous, the result could credibly cause material loss, or the rule introduces a new transfer, annual-fee, clawback, or campaign-cap interpretation. An unavailable required reviewer leaves the fixture below `golden`; it does not weaken the gate.

## 8. Boundary design

Derive tests from:

- amount denominator and rounding;
- minimum and maximum acquisition increments;
- top-up and purchase caps;
- residual balance and expiry;
- campaign and transfer windows;
- enrollment, targeting, tier, and identity state;
- known versus unknown progress;
- interface, channel, funding, and asset class;
- ordinary and excluded products;
- refund/reversal and cap restoration;
- probabilistic versus guaranteed reward.

Not every boundary requires a separate golden fixture; reviewed rules can generate systematic boundary tests.

## 9. Negative assertions

Examples:

- a top-up reward is not earned again when the balance is spent;
- the full acquisition cost is not assigned to one smaller purchase;
- residual value does not disappear;
- limited-period points are not treated as unrestricted normal points;
- unknown enrollment is not `false` or `true` by default;
- an undisclosed lottery is not guaranteed cashback;
- excluded funding does not contribute to reward or tier spend when both are excluded;
- canceled spend does not remain in earned rewards unless terms say the reward is retained;
- an announced but postponed change does not match;
- an unverified branch does not inherit chain certainty.

## 10. Time and throughput budget

Treat scenario research as explicit product work. Initial planning ranges are listed in the implementation plan; replace them with measured throughput after the first ten.

The 100-scenario program runs in parallel with product validation. Only scenarios supporting an exposed alpha feature are blocking for that feature.

## 11. Promotion rubric

A reviewer answers:

- Is each source authoritative for the exact field?
- Is permission/capture method recorded?
- Is the exact passage preserved?
- Are operation order, principal inputs/output requests, and engine-emitted movements complete?
- Are user facts and uncertainty explicit?
- Are rounding, cap, tier, posting, expiry, and clawback explicit?
- Do principal quantities and ending lots conserve?
- Do guaranteed and expected economics reconcile exactly to their formulas?
- Are probabilistic rewards separated?
- Are rejected attractive alternatives explained?
- Can the result be reproduced without engine output?
- Does the recorded review mode match reality?

Any unsupported material field blocks promotion or is conservatively removed/bounded.
