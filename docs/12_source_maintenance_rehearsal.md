# Source Maintenance Rehearsal v0.4.1

## Objective

Determine the least costly reliable combination of direct source checks and semantic agent monitoring before broad source expansion.

## Cohort

Use the same eight entries in `registry/source-maintenance-pilot.v0.3.yaml`. Do not change the source set during the comparison.

## Lane A — direct source operations

For each source at its cadence:

1. use only the approved/manual acquisition method;
2. record a dated environment-specific access observation;
3. capture/hash the permitted representation;
4. compare with the last valid snapshot;
5. classify materiality;
6. create canonical evidence/candidates only when justified;
7. record review time and impact.

## Lane B — semantic monitors through Agent Feed

External monitors may be OpenAI API workers, Claude agents, custom monitors, humans, or ChatGPT run-bundle exports.

Each monitor must begin a run, state expected scope, submit findings/evidence, and complete with actual scope/status. The Rewards Optimizer maps findings to `SourceObservation` and independently captures canonical evidence.

A ChatGPT Scheduled Task may also run as an independent sentinel. Because current Scheduled Tasks do not provide webhooks, it is not counted as an automatically integrated production monitor unless the result is imported as a run bundle or tool support is verified.

## Ground-truth event log

Every confirmed material change becomes an evaluation event. Record whether each lane detected it, detection time, classification, official source, duplicates, and review outcome.

## Metrics

- confirmed-change recall by lane;
- false positives and duplicate observations;
- median/maximum detection delay;
- official primary-source hit rate;
- human minutes per unchanged check and confirmed change;
- direct acquisition failure/manual share;
- Agent Feed partial/failed/zero-finding run rate;
- API/model cost per useful finding;
- time to canonical evidence and safe publication;
- changed-winner impact;
- independent-sentinel misses.

## Decision outcomes

- use semantic monitors for discovery and manual capture for truth;
- retain direct checks only for stable/high-risk sources;
- add permitted feeds/APIs where they outperform both lanes;
- reduce scope or freshness promise;
- obtain partner data;
- keep the product personal/fixed-wallet until operations are sustainable.

Realtime is not evaluated as a monitoring or delivery method. It may display live rehearsal status only.
