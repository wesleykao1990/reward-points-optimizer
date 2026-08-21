# Controlled database seeds

`001_m3_real_data_goldens.sql` is generated from the reviewed `JP-CVS-002`
and `JP-CVS-006` fixtures, manifests, evidence records, normalized snapshots,
and trusted-source registry entries.

Regenerate and verify it with:

```bash
pnpm seed:m3:generate
pnpm seed:m3:check
```

The seed writes only private canonical rows. Reward rules and versions remain
`under_review`, no completed publication request is created, no frontend route
is enabled, and the API approved-rule view remains empty for these rules.

`002_p0_provisional_rehearsal.sql` is a one-time, drift-sensitive local
rehearsal seed. It imports the exact checked-in Agent Feed run bundle as an
explicitly unsigned/unverified receipt, retains submitted evidence as
`lead_only`, and creates one private `active_experimental` candidate for the
`merchant.7eleven` / `accepted_payment_methods` family-role. The candidate is
not a canonical `RewardRuleVersion`, cannot enter the approved-rule API, and is
intended only for prototype evaluation and correction testing.

Apply the numbered seeds only after all numbered migrations. The database
integration runner applies both seeds automatically to a confirmed disposable
database before running the SQL tests.
