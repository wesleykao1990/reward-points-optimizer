# Review decisions — v0.4.1 preflight

## Accepted and fixed before implementation

1. `definition_hash` is the hash of canonicalized economic definition content, not historical version identity. The uniqueness constraint was removed; bitemporal non-overlap and publication idempotency govern history and retries.
2. Asset conservation is keyed by `(asset_id, reward_class)`. Normal, limited-period, and usage-limited rewards cannot cancel.
3. Generic `adjust` movements were removed from the contract. Future corrections require an explicit signed adjustment design with reason and evidence.
4. Review requirements are represented separately from completed review events. Approved/verified/golden records require the configured modes to be satisfied.
5. Monitoring streams have consumer-owned cadence and grace windows. A missed run is an incident and makes mapped source freshness stale.
6. A hostile Agent Feed run-bundle and rejected SourceObservation are regression fixtures. Canonical evidence remains empty.
7. ChatGPT Scheduled Tasks remain a small independent sentinel tier. Active-task caps and the hourly floor are documented; the scalable producer is a separately scheduled API worker.
8. Receipt redaction, observation state transitions, protocol security constants, and Agent Feed record immutability are pinned rather than left to implementation guesswork.

## Separate-project decision

Agent Feed remains a separate project because additional consumers are plausible, but v0.4.1 deliberately implements only the thin path needed to validate the Rewards consumer:

- protocol and schemas;
- begin/submit/complete lifecycle;
- local file and minimal REST path;
- persistence, terminal immutability, expected-run liveness;
- finding event and signed delivery contract.

Python SDK, full generic webhook/Claude adapters, polished MCP deployment, separate production Supabase project, and admin dashboard are deferred until the conserved Rewards kernel or a second consumer justifies them.

## Prototype decision

The workspace includes runnable, zero-dependency TypeScript prototypes for both projects plus a cross-project test. Codex must continue from these implementations, preserve their passing tests, and replace synthetic fixtures only through reviewed contract changes.
