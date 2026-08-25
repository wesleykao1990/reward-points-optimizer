# Production exchange-directory reconciliation

Date: 2026-08-26

## Purpose

The point graph must answer two different questions without confusing them:

1. does an official programme directory currently list a destination; and
2. do we have every parameter needed to calculate that route exactly?

Agent Feed monitors the first question. Rewards owns the second. A producer
submits `rewards.transfer_change` with one structured
`raw_attributes.exchange_directory_snapshot`. The snapshot enumerates official
directory rows and classifies each row as:

- `exact_executable`: complete structured claims compile through the ordinary
  route compiler and match the declared source/destination assets;
- `incomplete_parameters`: the row is real, but an exact rate, fee schedule,
  minimum, increment, cap, timing or prerequisite is missing;
- `inactive`: the provider no longer offers the route; or
- `informational_excluded`: the destination is not a point/value asset the
  optimizer should route through.

The producer does not publish a graph rule by asserting `exact_executable`.
`reconcileProductionExchangeDirectory` runs the entry through the same
compiler used by recommendations. The consumer database independently checks
the structured snapshot and asset tuple before it can enter the graph.

## Complete and partial snapshots

A complete snapshot means the producer enumerated the whole current official
directory. Omitted entries therefore disappear. A partial snapshot changes
only its listed entry IDs and preserves the other entries back to the latest
complete snapshot. This supports both periodic full enumeration and small
Agent Feed change events.

Every accepted snapshot writes three immutable records in the same transaction:

1. the directory snapshot and normalized entries;
2. an affected-node/rule change event; and
3. one focused research task for every incomplete row.

There is no route cache to rebuild. The database-backed graph reads the newest
reconciled snapshot on every recommendation request, so a committed update is
visible immediately. Inactive or incomplete replacements remove the old edge
instead of leaving stale arithmetic active.

## Producer payload example

```json
{
  "exchange_directory_snapshot": {
    "version": "production-exchange-directory-snapshot.v1",
    "directory_id": "directory.moppy.exchange",
    "family_id": "point.moppy",
    "source_role_id": "transfer_partner_directory",
    "source_asset_id": "asset.point.moppy",
    "complete": false,
    "sources": [
      {
        "source_id": "jp.moppy.exchange",
        "family_id": "point.moppy",
        "roles": ["transfer_partner_directory"],
        "url": "https://pc.moppy.jp/exchange/",
        "publisher": "Moppy",
        "official_domain": "pc.moppy.jp"
      }
    ],
    "entries": [
      {
        "entry_id": "moppy-to-ponta",
        "destination_asset_id": "asset.point.ponta",
        "disposition": "incomplete_parameters",
        "primary_claim_id": null,
        "claims": [],
        "research_request": {
          "missing_fields": ["fee_schedule"],
          "question_ja": "交換額ごとのPontaポイント手数料表を公式ページで確認してください。"
        }
      }
    ]
  }
}
```

An executable entry uses the same shape but supplies a primary
`transfer_rule` claim and any companion prerequisite claims. Rates such as
`15P～` remain incomplete unless the provider supplies a formula or complete
table. A bounded, explicitly published 315-to-300 transaction may coexist as
its own executable entry.

## Systematic enumeration backlog

The first full-enumeration jobs should cover the programme-owned outbound
directories for ANA, JAL, Bic Point, d POINT, JRE POINT, nanaco, PayPay,
Rakuten Point, Saison Permanent Points, Seven Mile, V Point and WAON POINT.
For every visible directory row the job must emit exactly one disposition.
That is stronger than merely proving that at least one route exists for each
programme.

The twelve task records are reconciliation checkpoints, not twelve Agent Feed
or LLM calls. The preferred run groups four programme directories per submitted
batch: one `begin_run`, three `submit_batch` calls and one `complete_run` for
the full twelve-directory pass. Each finding contains one whole directory
snapshot with all of its rows. Row IDs are used only for targeted database
replacement and retry accounting. Producers may fetch independent official
directories concurrently; an LLM is optional for difficult extraction and is
never required once per directory row.

Agent Feed remains generic: it detects that official directory content
changed and delivers the structured finding. Rewards decides which assets are
supported, compiles complete claims, and creates missing-parameter research
tasks. Newly discovered assets therefore remain incomplete until the Rewards
asset catalogue has an explicit identity and unit.

## Operational checks

- `pnpm --filter @jro/provisional-rules test`
- `db/tests/034_production_exchange_directory_reconciliation.sql`
- `node scripts/stage_supabase_migrations.mjs --check`

The SQL test proves initial visibility, partial replacement, removal after an
incomplete update, research-task creation and private-table isolation.
