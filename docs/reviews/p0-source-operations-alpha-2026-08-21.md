# P0 source-operations alpha review

Date: **2026-08-21 (Asia/Tokyo)**

## Decision

**GO for a private P0 planning/readiness control plane. This is not broad P0
evidence coverage, supported-product data, canonical rule publication, or
production advice.**

The checkpoint admits the exact P0 planning universe as 44 source families, 19
Agent Feed streams, and 301 unique `(family_id, source_role_id)` requirements.
The normalized artifact is bound to
`sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003`
and retains provenance to the reviewed off-main planning TSV without merging or
copying its representative URLs.

## Implemented boundary

`@jro/p0-source-operations` validates plain immutable data before use, rejects
hostile representations and structural substitutions, normalizes non-semantic
ordering, and admits only the exact reviewed plan. It computes readiness for
each required role across producer authorization, collection permission,
technical acquisition, stream liveness, canonical evidence or conservative
exclusion, and source-to-rule impact mapping. A planning label such as
`covered` cannot satisfy these operational gates.

Migration `0007_p0_source_operations.sql` stores the plan and its role-level
operational state privately. Seed `003_p0_source_operations.sql` expands the
exact 44/19/301 snapshot, then performs a one-way seal. Sealing verifies exact
child and planning-status counts; later updates, deletes, inserts, and truncates
are rejected. The private readiness views are security-invoker and security-
barrier, and PUBLIC receives no table, view, or trigger-function capability.

The initial database state has zero ready roles and zero ready families. Only
the existing `merchant.7eleven/accepted_payment_methods` rehearsal is marked
`experimental_eligible`; it remains not ready with six explicit blockers:
producer authorization, permission review, technical path, liveness,
canonical evidence, and impact mapping.

## Independent hostile review

Independent review confirmed the exact source provenance, counts, normalized
hash, hostile input rejection, readiness semantics, and absence of URLs or
product/SKU expansion. It initially reproduced a database append gap: an
INSERT-privileged owner could add a new family and role to the nominally
immutable snapshot, while the prior SQL test still passed.

The remediation added the one-way exact-count seal, serialized child inserts
against sealing, denied all post-seal child inserts, and added statement-level
TRUNCATE guards. The original append exploit and new truncate probes are now
part of the SQL gate. A fresh PostgreSQL 16 run passed all seven migrations,
three seeds, and eleven database tests.

## Scope and next data step

This checkpoint creates no page-level trusted source, selectable card SKU,
economic rule, canonical EvidenceRecord, publication request, public API, or
frontend route. It does not claim that any of the 44 planning families is fully
supported.

The next P0 data step is one authorized producer run and evidence-acquisition
pack for an explicitly selected family-role, followed by collection-permission,
semantic-support, extractor-authenticity, and correction-adjudication checks.
Missing rates, products, campaigns, dates, acceptance relationships, and source
relationships must not be inferred. Unknown-world `CoverageCandidate`
discovery remains a separate later milestone.
