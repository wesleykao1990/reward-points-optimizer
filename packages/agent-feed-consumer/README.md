# Agent Feed consumer package

This package belongs to the Rewards Optimizer and implements only the consumer side of Agent Feed protocol `0.1`.

Responsibilities:

- verify event signature and timestamp;
- validate Agent Feed event/finding/evidence schemas;
- store an idempotent receipt;
- map supported findings into `SourceObservation`;
- compute reward-domain semantic fingerprints;
- acknowledge only after durable persistence;
- expose replay and dead-letter diagnostics;
- create evidence-acquisition/review work, never rules.

It may depend on a published `@agent-feed/schema` artifact. It must not import Agent Feed server internals or query Agent Feed storage.

`protocol-lock.json` is the canonical repository-local dependency lock. It pins
the published `@agent-feed/schema@0.1.1` tarball by immutable release URL,
source tag/commit, SHA-256, byte length, and SHA-512 integrity. The offline
package validator rejects drift between this lock and `package-manifest.json`.
Update the pin only after a compatible Agent Feed release passes the
cross-project contract suite and the downloaded bytes match the release
manifest.

The immutable `schema-v0.1.1` release evidence is:

- URL: `https://github.com/wesleykao1990/agent-feed/releases/download/schema-v0.1.1/agent-feed-schema-0.1.1.tgz`
- SHA-256: `9e020aba4e291f2e5328897dfb07195aaf392f6ecdd742b5c13b890cffdd9d6e`
- SHA-512 integrity: `sha512-KHALcE3zQ/dey5GTXepDeXaz77Qf1DP3ySA+rcbG6eiFvUTws21cry8rfM191wyLeQthJ9ENd0neu23ETwX5/g==`

The application boundary is `createAgentFeedConsumerHandler`. It accepts the
exact raw body bytes, transport headers, and received time, then verifies the
timestamp/signature before calling one injected `AtomicPersistencePort.persist`
method. That method is the durable transaction boundary: the consumer does not
return an acknowledgement until it resolves successfully. The production
schema validator is loaded lazily from the pinned public package; focused tests
can inject `createFallbackSchemaValidator` while the artifact is not installed.

Receipts retain two deliberately different hashes: `payload_hash` is the
canonical event hash with only the top-level delivery `attempt` omitted, while
`transport_payload_hash` is the SHA-256 of the exact received bytes. They also
retain the nonempty delivery ID, ISO signature timestamp, signing key ID, and
delivery attempt. This lets Agent Feed retries vary transport metadata without
changing domain/event identity.

`run.started` deliveries carry a full published run envelope. Agent Feed
v0.1.1 terminal deliveries use the producer's exact six-field payload
(`status`, `completed_at`, `actual_scope`, `expected_scope`, `stats`, and
`error_summary`), which is validated locally with strict nested scope/stat
shapes. The pinned producer carries cancellation by `run.failed` with status
`cancelled` (its terminal selector maps every non-completed/non-partial status
to `run.failed`);
missing, extra, or mismatched terminal fields are quarantined.

`mapFindingToObservation` intentionally returns no observation for an unknown
finding type. Supported observations keep `canonical_evidence_ids` empty and
stage producer evidence as `lead_only`. `EvidencePromotionService` is the only
package path that can request promotion, and it requires Rewards permission,
an independently captured hash and locator, and an approved review.
