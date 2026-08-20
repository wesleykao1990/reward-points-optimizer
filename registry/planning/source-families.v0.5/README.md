# Source Families v0.5 — planning registry

Research date: 2026-08-20.

This directory is the Codex-facing planning inventory for the 255 source families required by the broader Japan Rewards Optimizer vision. It is **not canonical economic truth** and does not grant automated-collection permission.

## Files

- `p0.tsv` — all 44 P0 families with source roles, cadence and representative URLs.
- `p1-index.tsv` — all 73 P1 families and monitoring metadata.
- `p1-sources.tsv` — representative source URLs/verification notes for P1.
- `p2-index.tsv` — all 101 P2 families and monitoring metadata.
- `p2-sources.tsv` — representative source URLs/verification notes for P2.
- `p3-index.tsv` — all 37 P3 families and monitoring metadata.
- `p3-sources.tsv` — representative source URLs/verification notes for P3.

Use `../source-coverage-summary.2026-08-20.json` for aggregate counts.

## How to use

1. Start with the priority index (`p0.tsv`, `p1-index.tsv`, etc.).
2. Join P1–P3 rows to the matching `*-sources.tsv` on `family_id` when URLs are needed.
3. Use the category source-pack requirements in `docs/20_source_coverage_strategy_2026-08-20.md` and `docs/23_source_coverage_research_audit_2026-08-20.md` when a compact index does not repeat `required_source_roles`.
4. Never mark a family fully supported solely because a representative root URL exists.
5. A `candidate_to_verify` URL is an onboarding lead, not production evidence.
6. `covered`/`partial`/`missing` describe the state of the pre-existing 140-page seed registry at research time, not a permanent support status.
7. Do not interpret issuer-family counts as user-selectable product counts; see `registry/product-catalogue/`.

## Coverage counts

- P0: 44
- P1: 73
- P2: 101
- P3: 37
- Total: 255

The intended expansion order is P0 → selected P1 + maintenance rehearsal → broader P1/P2 → P3 only when user demand and maintenance capacity justify it.
