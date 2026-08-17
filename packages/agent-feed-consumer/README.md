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
