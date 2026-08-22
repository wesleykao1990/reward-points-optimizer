# P0 live Agent Feed execution — 2026-08-22

## Scope

- plan: `sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003`
- operations manifest: `sha256:6aa634b868e43f9c3f58417602e7b4465e36824f26d00bd9187f043395b4fae8`
- task pack: `sha256:f0cdcfc20bc32c11d3024e054d64c334840c7cd7d453e871b70163ed327c03c2`
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

## Historical partials and bounded recovery

| Family | Historical selected-run result |
|---|---|
| `merchant.amazon-jp` | `loyalty_program_rules` official points page returned HTTP 503. |
| `point.d` | `transfer_partner_directory` remained partially checked: member-transfer terms were found, but the directory exposed no partner rates. |
| `point.jre` | `campaign_directory` and `program_terms` returned HTTP 403; merchant and transfer roles remained partially checked. |
| `point.nanaco` | Six structured role findings were accepted; Agent Feed rejected the exact transfer-role claim batch because its safety scanner treated the benign authentication-requirement field named `credential` as secret-bearing. |
| `reg.jp.meti.cashless` | All four required roles returned HTTP 403 from the official METI locator. |

No value was invented to convert these historical outcomes into success.

The historical Amazon partial above remains immutable. Its bounded retry used
the official Points main page
`https://www.amazon.co.jp/b?node=8123221051`; the prior
`www.cdn.amazon.co.jp` alias failed TLS hostname verification.

Five subsequent unresolved-only recovery runs completed the exact eleven
remaining family-role targets. They accepted eleven untrusted findings and
seven submitted evidence objects: one each for d POINT, nanaco, and Amazon;
four findings/three evidence objects for JRE POINT; and four findings/one
evidence object for METI. Every terminal scope reports `finding_found` for its
declared target IDs. These runs improve the operational source-role coverage;
they do not turn the findings into canonical evidence or published rules.

| Family | Run ID | Recovered targets |
|---|---|---:|
| `point.d` | `5c58e9ff-7017-4f4e-bf44-fce060f69d4a` | 1 |
| `point.jre` | `baebbdc0-6460-4e6c-914e-8b1f88f99c7e` | 4 |
| `point.nanaco` | `3f8cbb3f-0758-4570-ae6f-345786d7c9ce` | 1 |
| `merchant.amazon-jp` | `44ff344a-8ed3-4372-9916-3bbd4f16f386` | 1 |
| `reg.jp.meti.cashless` | `8b1222b4-d705-44ef-9698-ade97814d966` | 4 |

The Rewards-owned allowlist for those terminal identities is
`registry/planning/p0-agent-feed-reconciliation-map.v1.json`. It binds all
eleven targets to the current plan and manifest without copying page bodies or
inventing an economic value.

## Downstream boundary

The live runs are durable in Agent Feed. Rewards now contains the optional
signed internal ingress, exact five-run reconciliation map, and atomic receipt
plus checkpoint transaction. Agent Feed contains a durable signed delivery
worker. Historical event materialization and the live signed delivery itself
remain an explicit operator action; until the resulting Rewards receipt and
eleven checkpoint rows are independently observed, this report does not claim
that cross-database delivery is complete.
