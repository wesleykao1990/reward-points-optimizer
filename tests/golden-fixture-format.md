# Golden Fixture Format Guidance v0.3

The normative contract is `schemas/golden-scenario.schema.json`.

A fixture must calculate without live web access. It references immutable evidence for audit but contains frozen operation, asset, rule, and user-state facts.

## Minimum semantic requirements

- transaction and replay-knowledge timestamps;
- owned wallet and loyalty programs;
- user facts with explicit known/estimated/unknown state;
- one enclosing objective and frozen comparison facts;
- candidate operation-and-asset plans and dependencies;
- opening user-owned lots plus requested principal outputs;
- engine-emitted principal movements and ending asset lots;
- complete financial and non-financial rule outcomes;
- posting, expiry, restrictions, certainty, and clawback;
- definite winner or conditional winners;
- fallback/runner-up where meaningful;
- negative assertions;
- exact rule and evidence versions;
- independent calculation artifact and honest review mode.

## Numeric representation

- JPY amounts: integer fields named `*_jpy`.
- Reward quantities: non-negative decimal strings with asset scale metadata.
- Rates: basis points or arbitrary-precision decimal representation.
- Ratios: explicit source and destination units.
- Timestamps: ISO 8601 with offset.
- Validity end: exclusive unless a reviewed field explicitly states another convention.
- Ledger debit/credit direction: a sign field, not a negative quantity hidden inside an otherwise non-negative contract.

## Comparison policy

Compare:

- operation and plan eligibility;
- applied and rejected rule IDs;
- asset quantities by component and lot;
- ending assets and exact quantity conservation;
- reconciled merchant value, funding, opening consumption, ending value, rewards, fees, and net value;
- cap consumption and range;
- guaranteed and optional expected value;
- definite/conditional winner;
- next questions;
- reason codes.

Do not snapshot-test only localized prose.

## Updating a golden fixture

Never update expected values merely because the engine disagrees. Require new/corrected evidence, a separate expected calculation, an impact report, the selected review mode, a new fixture version, and preservation of historical fixtures.
