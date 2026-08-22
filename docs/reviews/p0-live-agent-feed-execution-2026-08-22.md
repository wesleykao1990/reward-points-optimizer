# P0 live Agent Feed execution — 2026-08-22

## Scope

- plan: `sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003`
- operations manifest: `sha256:6aa634b868e43f9c3f58417602e7b4465e36824f26d00bd9187f043395b4fae8`
- task pack: `sha256:08f0734b9055894ca47b2506d8c46c2013cc5d135c3cd38c401e82cc64a7ab83`
- prepared set: `sha256:ca0d6bce0f416c62d953a3c69cee96a75134a17bc0157dabc3eb45b858ff2797`
- 44 work units, 19 streams, 301 family-role targets

## Reconciled selected runs

For each exact prepared work-unit hash, reconciliation selected the usable
terminal run with the most accepted findings and complete target-outcome
metadata. Zero-content duplicates and cancelled attempts were excluded.

| Measure | Count |
|---|---:|
| selected work units | 44 |
| completed | 39 |
| partial | 5 |
| required targets represented | 301 |
| accepted batches | 47 |
| accepted findings | 196 |
| accepted lead-only evidence | 187 |
| source references attempted | 226 |
| source references fetched | 221 |

All selected runs declare `publication_authority: none`. Findings and submitted
evidence are untrusted research inputs. They are not canonical economic truth,
canonical EvidenceRecords, or published reward rules.

The physical ledger contains 49 plan-bound runs: 44 selected and five
superseded attempts. A replacement Lawson run corrected a one-character target
ID transcription error in the earlier terminal run; the replacement matches all
six generated Lawson target IDs. Three superseded runs are completed and two
are cancelled. They remain immutable audit history and are excluded from the
selected-set totals above.

Twenty-four selected legacy runs omit the redundant `canonical: false`,
`task_id`, and `task_pack_sha256` metadata fields. Every one still carries the
authoritative `publication_authority: none`, and its plan, manifest, work-unit
hash, family, stream, roles, and target set reconcile exactly. Future producers
should emit the fuller metadata shape consistently; this is recorded as
metadata debt rather than publication ambiguity.

## Honest partials

| Family | Unresolved result |
|---|---|
| `merchant.amazon-jp` | `loyalty_program_rules` official points page returned HTTP 503. |
| `point.d` | `transfer_partner_directory` remained partially checked: member-transfer terms were found, but the directory exposed no partner rates. |
| `point.jre` | `campaign_directory` and `program_terms` returned HTTP 403; merchant and transfer roles remained partially checked. |
| `point.nanaco` | Six structured role findings were accepted; Agent Feed rejected the exact transfer-role claim batch because its safety scanner treated the benign authentication-requirement field named `credential` as secret-bearing. |
| `reg.jp.meti.cashless` | All four required roles returned HTTP 403 from the official METI locator. |

No value was invented to convert these outcomes into success. The Nanaco
transfer claim remains intact in the Rewards research artifact for a future
Agent Feed structured-claim admission fix.

## Downstream boundary

The live runs are durable in Agent Feed. Their metadata is
`awaiting_rewards_receipt_import`. A configured Rewards consumer/database must
still import and reconcile the terminal envelopes into Rewards-owned P0
operation checkpoints. That deployment step is intentionally not represented
as completed by this report.
