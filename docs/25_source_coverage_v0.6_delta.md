# Source coverage v0.6 delta — reward portals + unknown-world discovery

This document is additive to the 2026-08-20 v0.5 research. The original v0.5 files remain as the historical baseline.

## Reward portal expansion

Six additional portal families were added after follow-up research:

- `portal.warau` — P1
- `portal.gmo-poikatsu` — P1
- `portal.nifty-point-club` — P1
- `portal.chanceit` — P2
- `portal.amefri` — P2
- `portal.sugutama` — P3

The reward/cashback/point-portal domain therefore increases from 20 to **26 explicitly planned families**.

The complete portal-oriented list is `registry/planning/reward-portals.v0.6.tsv`. The six additions are also isolated in `registry/planning/source-family-additions.v0.6.tsv` so Codex can apply the v0.6 delta without treating the v0.5 registry as silently changed.

## Updated aggregate planning counts

- Total source families: **261**
- Eventual Agent Feed streams: **95** (no new stream required; additions reuse portal stream groups)
- Priority: P0 44, P1 76, P2 103, P3 38
- Category `cashback_portal`: **26**
- Baseline assessment: 48 covered, 20 partial, 193 missing
- P0 launch core: 44 / 19 streams
- P0+P1: 120 families / 42 streams
- P0+P1+P2: 223 families / 86 streams
- All planned: 261 / 95 streams

These are planning counts only. They are not claims that all 261 families are production-supported.

## Unknown-world discovery added

The v0.6 context adds:

- `docs/24_unknown_world_discovery_loop.md`
- `registry/planning/discovery-query-packs.v0.1.yaml`

The core architectural rule is:

```text
Discovery Producer
  → Agent Feed coverage_candidate finding
  → Rewards CoverageCandidate resolution/triage
  → accepted_for_research
  → Codex official-source research + PR
  → normal evidence/review gates
```

Agent Feed remains generic and does not become the reward-domain coverage authority. Codex is a maintainer/research agent, not the always-on monitor.

## Why the list remains open-ended

261 families are the known planned universe as of the research date, not a permanently exhaustive list. The unknown-world loop is designed to discover:

- new/rebranded point sites;
- new card/wallet products;
- new point or mileage programs;
- new transfer relationships;
- new payment interfaces;
- new merchant acceptance relationships;
- new official campaign/source surfaces.

Candidates that cannot yet be verified against an official operator source remain discovery backlog entries and are not counted as supported families.
