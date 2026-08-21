# P0 source operations

This private package admits the exact P0 planning universe and evaluates source-role readiness without converting planning records into evidence or reward rules.

The current plan contains 44 source families, 19 Agent Feed streams, and 301 required `(family_id, source_role_id)` slots. A baseline status such as `covered` means only that useful page-level seeds existed during planning. It never means a family, product, card SKU, or economic rule is supported.

A role is ready only when its producer run, collection permission, technical path, stream liveness, canonical evidence or explicit conservative exclusion, and source-to-rule impact mapping all pass. `lead_only` and discovery evidence remain blockers. Private experimental eligibility is reported separately and never satisfies readiness.

This package performs no network access, persistence, evidence promotion, rule publication, product catalogue enumeration, or unknown-world discovery.
