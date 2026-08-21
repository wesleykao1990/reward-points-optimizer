# M4 two-lane maintenance foundation review — 2026-08-19

## Decision

The implementation foundation for Milestone 4 is **GO**. The operational
30-day rehearsal has not run, so its decision remains `insufficient_data`.
No production capture permission, current reward fact, canonical evidence, or
green/amber/red operating conclusion is implied by this checkpoint.

## Deferred transfer experiment

Detailed review of `JP-XFR-002` remains deferred. The owner's statement that an
official ANA page describes converting two Rakuten Points to one ANA mile is
retained only as a human-supplied research note. It is not approved evidence or
a completed `human_second_review`, and all unresolved transfer details remain
promotion-blocking.

## Lane A — direct source operations

The new `@jro/source-maintenance` package provides:

- an immutable, ordered, hash-bound manifest for the exact eight-source cohort;
- a fail-closed permission, observation, capture-method, snapshot, diff, and
  materiality state machine;
- immutable ground-truth, lane-detection, run-ledger, and rehearsal-check
  records;
- deterministic recall, delay, false-positive, duplicate, official-source,
  review-time, acquisition, run-lifecycle, cost, winner-impact, and sentinel
  metrics;
- weekly maintenance-time medians and the documented green/amber/red decision
  thresholds; and
- synthetic fixtures that never contain raw official content or canonical
  evidence.

Inputs are validated again at the reducer boundary, including hashes, record
shape, source scope, timestamps, numeric fields, synthetic-evidence separation,
and global record identity. A completed zero-finding monitor run is valid only
when its actual scope equals the full ordered cohort. Partial, failed,
cancelled, and absent runs remain distinct measurable outcomes.

The current registry still marks all eight real sources `not_reviewed` with
unknown technical feasibility. Real Lane A capture therefore remains blocked
until source-specific permission and access observations are approved.

## Lane B — Agent Feed run-bundle import

The Agent Feed consumer now validates and normalizes a complete local run
bundle with the pinned published protocol schema. It snapshots caller input
before asynchronous work, generates deterministic event identity, preserves
import provenance, and submits one immutable batch to one explicitly atomic
persistence sink. There is no caller-supplied validator bypass or per-event
partial callback path. An absent sink, a failed sink, or malformed input is not
reported as imported.

Completed-zero, partial, failed, and cancelled terminal states remain distinct.
The hostile protocol fixture remains rejected as an untrusted lead with empty
canonical evidence and its security flags intact.

## Verification

- source-maintenance tests: 17/17;
- Agent Feed consumer tests: 27/27;
- root typecheck, unit tests, property tests, build, and package validation pass;
- root lint exits successfully with 53 pre-existing warnings outside M4; the M4
  files are clean and included in the root Biome allowlist; and
- both Lane A and Lane B received independent hostile re-review **GO** verdicts.

## Operational work still required

1. Resolve terms and permitted acquisition paths for the fixed cohort without
   inferring permission from reachability.
2. Record dated, per-source access observations and begin the real 30-day
   window only after those gates permit it.
3. Import semantic-monitor and independent-sentinel run bundles through an
   atomic persistence adapter and record expected-versus-actual scope.
4. Confirm material changes independently, acquire permitted canonical
   evidence, and record review time, cost, delay, and winner impact.
5. Apply a green/amber/red operating decision only after the full window and at
   least four complete weekly maintenance-time buckets exist.
