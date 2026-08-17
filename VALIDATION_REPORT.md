# Japan Rewards Optimizer Foundation v0.4.1 validation report

Validated: **2026-08-18 (Asia/Tokyo)**

## Result

**Passed for package contracts and runnable synthetic prototype.**

- JSON Schemas: 11;
- trusted sources: 140;
- access observations: 4;
- source review entries: 140;
- rehearsal sources: 8;
- seed scenario blueprints: 10;
- planned scenarios: 100, distributed 40/40/20;
- synthetic valuation fixtures reconcile with identical native ledgers and reverse the winner;
- semantic invalid-range self-tests reject invalid documents;
- prompt-injection fixtures produce no candidate/published rule;
- SQL structural checks passed;
- prototype syntax/build checks passed;
- prototype tests: 10/10 passed;
- browser/API smoke flow passed.
- Agent Feed `@agent-feed/schema@0.1.1` release pin matches the independently verified artifact URL, source commit, SHA-256, byte length, and SHA-512 integrity.

The prototype proves exact residual conservation, reward-class separation, valuation isolation, break-even sensitivity, reusable definition hashes, separate publication idempotency, bitemporal-overlap rejection, required review modes, and hostile Agent Feed intake rejection.

## Database limitation

The full v0.4.1 migration chain and SQL tests were not executed against PostgreSQL in this packaging environment. Codex must run every file under `db/tests/` against PostgreSQL 15+ before claiming the persistence gate.
