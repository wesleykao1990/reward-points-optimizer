# Rewards Optimizer runnable prototype v0.4.1

This zero-dependency TypeScript prototype gives Codex a working vertical slice rather than an empty repository.

Implemented:

- direct-card versus stored-value top-up plans;
- exact integer/micro-JPY accounting;
- top-up acquisition, purchase, and residual lots;
- conservation keyed by `(asset_id, reward_class)`;
- percentage/points-per-unit style rewards;
- normal versus limited-period reward classes;
- per-asset residual valuation and break-even sensitivity;
- winner/runner-up calculation with valuation isolation;
- canonical definition hashing without treating a hash as version identity;
- enforceable review-mode requirements;
- Agent Feed finding-to-untrusted-observation mapping and hostile-input rejection;
- a thin responsive web prototype and monitoring-health screen.

```bash
npm test
npm run demo
npm start
# open http://localhost:8788
```

No installation is required with Node 22. Data is intentionally synthetic. Codex should extend the contracts and tests rather than replacing this working kernel with a fresh scaffold.
