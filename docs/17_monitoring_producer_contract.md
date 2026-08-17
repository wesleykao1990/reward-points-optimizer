# Monitoring producer contract

Monitoring agents live outside the Rewards Optimizer and submit through Agent Feed.

Supported producers include:

- an OpenAI Responses API worker with web search;
- a Claude scheduled/agent workflow;
- a custom source monitor;
- a human research session;
- a ChatGPT monitor exported as a run bundle.

Each monitor must:

1. begin a run with expected scope;
2. report actual scope and terminal status;
3. distinguish no findings from failure;
4. submit claims as findings, not facts;
5. attach source URLs/locators and unresolved ambiguity;
6. never publish a reward rule;
7. complete partial/failed runs honestly;
8. avoid secrets, account data, and dynamic payment credentials.

Production monitors should compare current search results against a bounded known-state excerpt supplied by the Rewards Optimizer, not the whole rule database.

## Expected-run liveness

Every production monitoring stream is registered in the Rewards consumer with an expected cadence and grace window independent of producer metadata. A terminal run is owed within that window. A completed zero-finding run means the producer checked successfully; no terminal run means the lane is overdue, mapped source freshness becomes stale, and an incident is raised.

The producer must not self-declare liveness. Terminal `partial`, `failed`, and `cancelled` runs prove execution but degrade freshness; only a scope-complete `completed` run restores healthy status.
