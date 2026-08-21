# `@jro/challenge-track`

The M7 challenge-track package is the validation boundary for the repository's
versioned 100-scenario research queue. It admits planning metadata only: it
does not acquire evidence, calculate a scenario, review a result, or promote a
scenario to `golden`.

`parseChallengeCoveragePlan` accepts either the parsed plain-data object or the
contents of `scenarios/scenario-coverage-plan.v0.3.yaml`. It rejects unknown or
missing fields, non-plain/proxy/accessor/hidden/symbol/cyclic input, malformed
IDs, category-prefix mismatches, source/feature duplicates, false distribution
declarations, and any status other than the current `planned` checkpoint.

`admitChallengeCoveragePlan` returns a deeply frozen canonical snapshot:

```ts
{
  value: frozenPlan,
  canonical_json: "...",
  sha256: "sha256:<64 lowercase hex>"
}
```

Scenario entries are sorted by stable ID for hashing. Source and feature lists
are sorted as unordered identifiers; the four golden-gate checklist items are
validated as a fixed set and emitted in the canonical checklist order.

Callers may pass `knownSourceIds` to require every declared source to resolve,
and `requiredSeedIds` (or `seedIds`/`seedScenarioIds`) to require a selected
seed subset. `requireSeedIds: true` selects the ten M3 seed IDs. These options
affect admission only and are not added to the plan hash.

The repository CLI always supplies the canonical trusted-registry IDs. A
generic library call that omits `knownSourceIds` performs structural plan
validation only and is not the authoritative repository admission boundary.

`admitSyntheticChallengeSet` accepts only the exact in-process plan capability
returned by coverage admission. Synthetic cases use the `SYN-M7-*` namespace,
contain no source/evidence/golden claims, and never satisfy evidence coverage.
The batch runner likewise requires the exact admitted plan and case-set
capabilities, one exact submitted record per runnable case, and explicit
reader/evaluator ports. Any preflight defect blocks the whole batch before an
evaluator call.

The report accepts only runner-minted results bound to the same plan and case
set. It keeps declared, planned, bound, executed, passed, evidence-backed, and
golden counts separate. Run the canonical offline audit from the repository
root:

```bash
pnpm challenge:validate
```

At this checkpoint it reports 100 declared/planned targets and zero executed,
evidence-backed, or golden scenarios. Production and evidence-track readiness
remain false.

The package is Node.js 22+ and ESM. Its checks are offline and deterministic.
