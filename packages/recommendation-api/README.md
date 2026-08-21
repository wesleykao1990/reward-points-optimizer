# `@jro/recommendation-api`

This package is the pure, offline Milestone 5 recommendation boundary for the
internal/synthetic beta. It is a deterministic adapter around
`@jro/rule-engine`; it is not a live rewards service and it does not make a
production recommendation claim.

## Boundary and current status

The package accepts one explicit versioned request and returns one immutable,
JSON-serializable response. The supported API version is `"1"`. The request
must identify `timezone: "Asia/Tokyo"`, an absolute `transaction_time`, and an
absolute `replay_knowledge_at` that is not earlier than the transaction. A
production-mode request is always fail-closed with
`production_authorization_unavailable`, even if the caller supplies a green
source-maintenance value. Synthetic/internal requests return
`verification_status: "synthetic_only"` and must not be presented as current
reward advice.

The M4 operational state is still `insufficient_data`: the fixed eight-source
cohort remains `not_reviewed` with unknown technical feasibility. Consequently
this package is an internal foundation and cannot activate a real-data beta.
The deferred `JP-XFR-002` ANA/Rakuten transfer experiment remains a human
research note, not approved evidence.

There is no HTTP server, database adapter, authentication implementation,
Agent Feed replay path, or production deployment in this package. The host
application must keep authentication, persistence, and authorization ports on
the trusted server side and must never expose them to an untrusted caller.

## Recommendation boundary

`recommend` (also exported as `evaluateRecommendation`, `evaluate`, and
`recommendRewards`) performs the following checks before invoking the engine:

- Merchant resolution uses canonical IDs or normalized exact aliases. A branch
  selector is mandatory; ambiguous aliases, mismatched IDs, fuzzy matches, and
  chain-to-branch inference are rejected.
- Frozen comparison facts bind every candidate merchant purchase to the exact
  merchant, branch, JPY amount, channel, interface, line-item multiset, and
  transaction date. A mismatching candidate is retained in the response as a
  rejected plan with a stable reason.
- Every supplied rule must have exactly one assurance for its exact
  `rule_id@version`, with concrete evidence IDs. Unexpected, duplicate,
  missing, stale, unresolved, lead-only, or otherwise blocked trust states are
  denied before engine evaluation. Evidence and freshness fields in the
  response are metadata; they do not grant production authority.
- The objective must be one of the explicitly supported engine objectives
  (`maximize_guaranteed_net_value` or `maximize_expected_net_value`) with a
  probability policy, ending-asset valuation policy, and tie-breakers.
  Unsupported objective aliases such as `minimize_net_cost` and
  `maximize_destination_value` are rejected.
- Candidate order, catalog order, rule order, asset order, and evidence order
  are normalized for the input hash. Results contain the complete disjoint
  eligible/rejected candidate partition, winner/safe/runner-up IDs, conditional
  explanations, assumptions/questions, valuation sensitivities, and trust
  assessments.

The response includes `replay.input_hash` and `replay.output_hash` but never
includes engine canonical input/output bodies. Use `verifyRecommendationHashes`
to recompute the public output hash and `serializeRecommendation` for stable
JSON. BigInt values are represented as strings, and returned objects are deeply
frozen; caller-owned input is not frozen or retained.

## History and canonical replay ports

`createRedactedHistoryRecord` supports session-only, 30-day, 90-day, and
user-selected retention decisions. Persisted history contains only hashes and
an allowlisted redacted summary; it rejects caller-supplied user IDs/references,
PII, wallets, facts, and unverified hashes. Legal holds require a separately
supplied trusted `HistoryAuthorizationPort`; input flags cannot self-authorize
a hold. This module computes a record and performs no persistence.

`authorizeReplay`/`buildReplayArtifact` support only `synthetic`,
`golden_fixture`, and `redacted_incident` replay classes. They recompute request
and result hashes, require absolute times, engine/rules/valuation versions,
`sealed: true`, `contains_user_data: false`, and host-authorized actor scopes.
Synthetic/golden artifacts require a host-verified fixture manifest; incidents
require a host-verified approval bound to both hashes and an allowlisted
redacted payload. Restricted user data, caller-supplied approvals, lookup or
token surfaces, and Agent Feed replay are denied. These authorization ports are
capabilities for a trusted server boundary, not data a client may provide.

The security admission scanner rejects prohibited payment credentials and
unsafe values (including nested/key/value evasion, cycles, accessors,
`toJSON`, prototype-pollution keys, unsupported values, BigInt where admission
does not permit it, and non-finite numbers) with stable redacted diagnostics.

## Scope

This is an internal/synthetic M5 foundation. Production authorization,
source-maintenance completion, real evidence promotion, HTTP/DB/auth adapters,
and a real current-reward beta are follow-up work.
