# Provisional rule kernel

`@jro/provisional-rules` is a pure, fail-closed intake and state kernel for
experimental rule evaluation. It accepts a machine-checked candidate bound to
an Agent Feed `SourceObservation` and a caller-supplied deeply frozen P0
coverage index. Coverage binds a `(family_id, source_role_id)` pair to known
source IDs. `source_authority_role` is separate: it must agree with the
observation's `discovery_assessment.source_authority_claim`, and only a
primary-authority candidate may activate experimentally.

The admission boundary first rejects proxies, accessors, non-enumerable and
symbol properties, cycles, sparse arrays, unsupported values, and
secret/payment-card-like data. It then validates the candidate `RewardRule`
through `@jro/contracts`, rejects publication or completed-review claims, and
checks observation identity, source intersection, role, and P0 registration.

Use `admitProvisionalRuleCandidate`, `activateExperimental`, and
`recordCorrectionSignal` (or `createProvisionalRuleStore`) for the prototype
flow. The package exposes only `needs_evidence`, `machine_checked`,
`active_experimental`, `disputed`, and `quarantined` states. A credible
correction disputes an active candidate; severe security/source mismatch
signals quarantine it. Selection excludes disputed and quarantined envelopes.

`preflightProvisionalPublicationBatch` and `store.publishBatch` provide the
bounded bulk boundary. A `provisional-publication-batch.v1` contains 1–32 exact
admission requests, binds the sealed P0 source-role plan hash, snapshots the
whole hostile input before use, admits and activates every member before the
first store mutation, rejects duplicates, and emits a deterministic sorted
batch hash. Exact replay is idempotent while its versions remain active;
changed replay and replay after a correction fail closed so a disputed rule is
never resurrected.

For `accepted_payment_methods`, admission additionally requires the
SourceObservation to declare the exact accepted payment family and the rule to
allow exactly one correspondingly named payment instrument. This permits a
single plural source finding to support an atomic family-by-family catalogue
without allowing the adapter to invent an unobserved payment family.

The nanaco economic pilot uses the narrower `createNanacoEconomicPilot`
boundary. Callers provide an untrusted `SourceObservation`, while the candidate,
coverage mapping, source, family-role, and economic definition come from one
generated, hash-checked artifact. Lead-only observations can be admitted only
as `needs_evidence`. Activation additionally calls a server-owned canonical-
evidence verifier supplied when the route is created; that verifier must query
the canonical evidence store and confirm the exact evidence/source/rule
binding. The host must not expose this capability as a client-controlled DTO.
The generic admission API is not the supported activation path for this
economic pilot.

This package has no network, canonical-evidence promotion, or approved-rule
API. Its "publication" vocabulary refers only to the isolated experimental
catalogue, never canonical `RewardRuleVersion` publication. Envelope and batch
branding are process-local; persisted or rehydrated lookalikes are rejected
until a separate trusted verifier exists. PostgreSQL persistence is a distinct
trusted-adapter boundary and does not recreate these in-process capabilities.

The descriptor-driven `compileP0ResearchImplementation` adapter also accepts
the four bounded P0 research envelopes (Research-A, Research-B, wallet/card,
and merchant/transit/regulatory Wave-D). It normalizes each source, role, and
claim deterministically, emits one correction-capable `catalogue_fact` entry
per accepted claim, and emits zero executable derived rules because these raw
claims do not provide the complete operation/asset/calculation projection. The
legacy `adaptResearchArtifact` and `compileResearchImplementation` names remain
Research-A compatibility aliases. The checked-in implementation snapshots
contain 87 + 111 + 103 + 63 = 364 facts and are seeded by
`scripts/generate_p0_research_implementation_seeds.mjs`.
