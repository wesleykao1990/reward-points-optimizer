# P0 Agent Feed terminal reconciliation map — 2026-08-22

This document records the host-owned binding used by the internal Rewards
ingress for the five completed P0 recovery runs. The checked-in data is
`registry/planning/p0-agent-feed-reconciliation-map.v1.json`. It is an
allowlist of exact terminal run/event identities and target outcomes; it is
not a source registry, an evidence publication, or a reward-rule seed.

## Admission identity

The map is admitted only against the current
`registry/planning/p0-source-role-plan.v0.1.json` and its derived manifest:

| Field | Value |
| --- | --- |
| plan hash | `sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003` |
| manifest hash | `sha256:6aa634b868e43f9c3f58417602e7b4465e36824f26d00bd9187f043395b4fae8` |
| completed runs | 5 |
| reconciled targets | 11 |
| target outcome | `resolved` for every listed target |
| economic findings count | 11 untrusted Agent Feed finding outcomes; no canonical economic claims are created by this map |

Every checkpoint retains the exact Agent Feed terminal event ID, run ID,
opaque P0 target ID, stream, family, source role, request/input hash, and
locator observed in the terminal `actual_scope`. The map contains no copied
page body and no inferred reward rate, transfer ratio, campaign condition, or
merchant relationship.

## Reconciled runs

| Agent Feed run | terminal event | Rewards family | stream | targets | work-unit hash |
| --- | --- | --- | --- | ---: | --- |
| `5c58e9ff-7017-4f4e-bf44-fce060f69d4a` | `evt_5c58e9ff-7017-4f4e-bf44-fce060f69d4a_terminal` | `point.d` | `economy.docomo` | 1 | `sha256:78e4f157f43b462a46690948798fa793eb105eb09b0581e8ddd69722cf54aae2` |
| `baebbdc0-6460-4e6c-914e-8b1f88f99c7e` | `evt_baebbdc0-6460-4e6c-914e-8b1f88f99c7e_terminal` | `point.jre` | `transit.jre-suica-view` | 4 | `sha256:0f84d16355858f8e4496254d2cce5147bb92679590b252f5f604d8ef281dcf48` |
| `3f8cbb3f-0758-4570-ae6f-345786d7c9ce` | `evt_3f8cbb3f-0758-4570-ae6f-345786d7c9ce_terminal` | `point.nanaco` | `economy.seven-nanaco` | 1 | `sha256:8a065f31af7c36e225c581b36643885654c7317f3f1e9d3909ba7734ddb1fa65` |
| `44ff344a-8ed3-4372-9916-3bbd4f16f386` | `evt_44ff344a-8ed3-4372-9916-3bbd4f16f386_terminal` | `merchant.amazon-jp` | `merchant.jp-ecommerce` | 1 | `sha256:6c9e1a94024e0875ce930350c37daaaa1bf9490096bfff1c5c4301a102c57435` |
| `8b1222b4-d705-44ef-9698-ade97814d966` | `evt_8b1222b4-d705-44ef-9698-ade97814d966_terminal` | `reg.jp.meti.cashless` | `regulatory.jp.cashless` | 4 | `sha256:d38503129d1f62378820a9b8518a9a73c2c0df28a2d22f2c79cda98cef352e2e` |

The terminal observations occurred at `2026-08-22T19:13:00+09:00` in the
Agent Feed run records. Each target was recorded as `finding_found` in the
Agent Feed `actual_scope`; the Rewards checkpoint representation maps that
transport-level result to the P0 operations outcome `resolved`.

## Locator fingerprints and receipt placeholders

`locator_fingerprint` is the Rewards operations fingerprint
`canonicalSha256(exact_locator_string)`. It is a fingerprint of the locator
string, not a content hash and not evidence of page freshness. The values are
kept to make a later retry or correction detect a changed locator without
letting Agent Feed choose canonical evidence.

The map uses five deterministic, non-production UUID placeholders for
`receipt_id`. They exist only because the P0 reconciliation contract requires
a valid receipt-shaped ID before the database receipt exists. The terminal
PostgreSQL adapter admits the map, persists the verified Agent Feed receipt,
replaces the placeholder with the UUID returned by the atomic persistence
function, and reconciles that bound UUID in the same transaction. A failed
binding rolls back both writes.

## Trust boundary

Agent Feed findings and submitted evidence remain untrusted inputs. The map
does not promote them to `EvidenceRecord`, publish `RewardRuleVersion`, or
create economic claims. The `economic_findings_accepted` counter records the
bounded finding outcome associated with each recovered target for P0 coverage
accounting only; it must not be read as a canonical rule count. Canonical
economic truth still requires the existing source, evidence, bitemporal,
review, and reward-class conservation gates.

