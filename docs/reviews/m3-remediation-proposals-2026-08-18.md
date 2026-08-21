# M3 remediation proposal review — 2026-08-18

## Decision

The append-only proposal set is `BLOCKED` and non-authoritative. It contains exactly nine proposals for the nine evaluated non-transfer scenarios. No source mapping, registry, queue, observation, scenario, gate, or promotion state was changed. `JP-XFR-002` is explicitly excluded.

Machine-readable set: [remediation-proposals-2026-08-18.v0.1.json](../../fixtures/m3/remediation-proposals-2026-08-18.v0.1.json).

## Classification

| Scenario | Proposed action class | Mapping after | Note |
| --- | --- | --- | --- |
| `JP-CVS-002` | retain + permission + technical | unchanged | Payment FAQ remains the authority boundary. |
| `JP-CVS-006` | retain + permission + technical; conditional official addition | unchanged until approval | Add only if credit-load reward/expiry/limit facts are missing. |
| `JP-CVS-014` | retain + permission + technical | unchanged | Preserve interface and reward-layer separation. |
| `JP-QR-007` | retain + permission + technical | unchanged | Keep reward and progress exclusions distinct. |
| `JP-QR-008` | retain + permission + technical | unchanged | Manual reachability is not permission or availability. |
| `JP-CMP-003` | narrow/split + specific official campaign terms + access review | pending | Retain current mapping until human scope approval. |
| `JP-CMP-007` | specific official terms/probability + possible narrow/split + access review | pending | No lottery guarantee is inferred. |
| `JP-CMP-009` | retain + permission + technical | unchanged | Require fresh valid-time capture. |
| `JP-ECOM-012` | narrow/split + specific official cancellation/refund/progress terms + access review | pending | Retain current mapping until merchant scope approval. |

## Evidence and blocker coverage

The proposals copy `mapping_before` exactly from `M3_AUTHORITATIVE_PRIMARY_SOURCE_IDS` and carry every source-ID/blocker-code pair reported by the experiment for the evaluated mappings: 101 pairs covered. The common blockers are unresolved registry and review-queue terms, unapproved collection paths, unknown technical feasibility, and missing technical observations; `jp.paypay.third-party-card-voucher` additionally carries `manual_reachability_only`.

Candidate source requirements are descriptors only; they do not invent or register source IDs. There are no `replace_source` or `engine_gap` actions. All proposals have `approval.human_approval: false`, `approval.decision: pending`, `promotion.status: BLOCKED`, and `promotion.gate_override: false`.

## Required human decisions

Before any evidence collection or promotion, a human must approve source terms, permitted capture/storage, technical access, and (for campaign/e-commerce proposals) the exact scenario scope and first-party source. Rejected or unapproved proposals leave the authoritative mapping and `BLOCKED` state unchanged.
