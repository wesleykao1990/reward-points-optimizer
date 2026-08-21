# Milestone 7 challenge-track infrastructure review

Date: **2026-08-19 (Asia/Tokyo)**

## Decision

**GO for the deterministic M7 challenge-track infrastructure. The evidence-backed
100-scenario workstream is not complete and production remains blocked.**

The canonical coverage plan contains exactly 100 declared targets, split 40
single-rule, 40 stacking, and 20 adversarial. All 100 targets remain `planned`.
This checkpoint has zero executed real scenarios, zero evidence-backed
scenarios, and zero golden scenarios.

## Implemented boundary

`@jro/challenge-track` provides:

- strict admission of the canonical 100-target coverage plan, fixed level and
  category totals, stable IDs, source references, status, and release tracks;
- separately named `SYN-M7-*` challenge cases that are permanently excluded
  from evidence and golden coverage;
- host-capability admission for plans, case sets, and runner results, so a
  structural clone or recomputed public hash is not authorization;
- an exact, fail-closed batch executor with complete case bijection, retained
  one-read artifacts, distinct raw/canonical hashes, immutable evaluator inputs,
  deterministic accounting, and zero evaluator calls after any preflight
  defect;
- a deterministic 100-row progress report that keeps declared, planned, bound,
  executed, passed, evidence-backed, and golden counts separate; and
- `pnpm challenge:validate`, which reads the canonical plan and trusted-source
  registry and emits a stable audit without inventing execution or promotion.

## Independent hostile review

The first review found that structural plan lookalikes, alias-shaped runner
requests, and partial batches could reach the evaluator. Remediation replaced
the permissive discovery paths with exact schemas, private in-process capability
registries, plan-to-case binding, a full admitted-case bijection, and an
all-or-nothing preflight.

The final review also found and closed three integration bypasses:

- a replay wrapper could clean an unknown-field request before validation;
- a case set and genuine batch minted for one plan identity could be reported
  under a byte-identical second plan identity; and
- registry proxies, hidden or symbol fields, and accessors could reach the CLI
  source adapter.

The verifier reran every reproduction. All were denied before evaluator calls
or hostile dereference, and the final verdict was **GO**.

## Verification evidence

- challenge-track tests: **41/41 passed**;
- challenge-track strict typecheck and build: passed;
- challenge-track scoped Biome check: clean;
- root typecheck, tests, property tests, build, and lint: passed;
- root lint retains the same 53 pre-existing warnings outside M7;
- CLI audit was byte-identical across two runs and reported 100
  declared/planned, 0 executed/evidence/golden, `production_ready: false`, and
  explicit M3/M4 blockers.

## Remaining blockers

M7 infrastructure does not replace source permission, evidence capture,
independent calculation, review, or golden promotion. M3 real evidence remains
blocked, M4 operational maintenance remains `insufficient_data`, and the
deferred human transfer experiment remains outside this checkpoint. A passing
synthetic replay never changes a canonical scenario lifecycle.
