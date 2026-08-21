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

This package has no network, persistence, publication, canonical-evidence
promotion, or approved-rule API. Its envelopes are suitable only for isolated
experimental evaluation. Envelope branding is process-local; persisted or
rehydrated lookalikes are rejected until a separate trusted verifier exists.
