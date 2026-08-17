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

`protocol-lock.json` is the repository-local dependency lock copied from the
v0.4.1 two-project workspace. Update it only when a compatible Agent Feed
protocol release has passed the cross-project contract suite.
