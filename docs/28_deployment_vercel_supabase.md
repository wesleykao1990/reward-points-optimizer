# Vercel frontend and Supabase backend deployment

This runbook deploys the current consumer alpha without widening its trust
boundary. Internal API audit labels remain in force. The customer UI presents
families and routes together in one neutral catalogue and retains the exact
wrong-information reporting controls.

## Topology

```text
browser
  -> Vercel static UI
  -> same-origin Vercel Node adapter
  -> Supabase transaction pooler (TLS, server-only URL)
  -> transaction-scoped SET LOCAL ROLE jro_runtime
  -> bounded app_api views / SECURITY DEFINER correction routines
```

Vercel hosts the browser assets and a thin request adapter because the current
application is Node-based. Supabase is the backend of record: PostgreSQL owns
the schema, released data, correction state, and all private evidence/rule
material. `app_private` and `app_api` are deliberately absent from the
Supabase Data API schema list; the browser receives no Supabase key or database
connection string.

The app does not yet have an account UI or deployment-specific user RLS
policies. The checked-in local Supabase configuration disables sign-up. The
hosted project must be configured the same way in its dashboard, and the hosted
alpha must not be described as a production consumer release.

## Versioned configuration

- `vercel.json` pins the Node 22 monorepo build, Tokyo function region, static
  output directory, security headers, fixture inclusion, and API duration.
- `api/handler.mjs` requires the database binding; the explicit Vercel rewrite
  sends every nested `/api/*` path to that checked adapter.
- `supabase/config.toml` keeps internal schemas out of the Data API and disables
  production-style seed handling.
- `scripts/stage_supabase_migrations.mjs` converts the canonical `db/*.sql`
  schema chain and `db/seeds/*.sql` released data into stable, one-time
  Supabase migration versions. It removes only the supported psql
  `ON_ERROR_STOP` directive and qualifies `pgcrypto.digest` with Supabase's
  hosted `extensions` schema; any other psql meta-command fails the check.
- `db/0018_deployment_runtime_role.sql` grants the runtime only exact reads and
  correction functions. Existing migration files are append-only after their
  first production application.

Run the local configuration check with:

```bash
pnpm deploy:supabase:check
pnpm --filter @jro/consumer-alpha-app test
pnpm --filter @jro/consumer-alpha-app typecheck
pnpm --filter @jro/consumer-alpha-app build
```

## Account configuration

### 1. GitHub

The repository is `wesleykao1990/reward-points-optimizer`. Deployment changes
reach `main` through the normal reviewed merge flow. No Supabase personal token
or database password is stored in GitHub Actions.

### 2. Supabase

Use the dedicated Rewards Optimizer project in the Tokyo/Northeast Asia region
(`fiksfdmmrvmsvjpvelji`). Keep its database password in the account password
manager. Do not use the separate Agent Feed database; the projects must remain
isolated. In the hosted Auth settings, disable new-user sign-ups because this
alpha does not yet have an authenticated account boundary.

Regenerate the immutable Supabase migration set whenever a canonical migration
is added:

```bash
node scripts/stage_supabase_migrations.mjs --write
git add db supabase/migrations
```

The generated `supabase/migrations/*.sql` files are committed deployment
artifacts. Canonical edits remain under `db/`; CI verifies that staging remains
deterministic.

Enable **Deploy to production** in the Supabase GitHub integration, set the
working directory to `.` and the production branch to `main`. Supabase then
applies committed migrations after each merge to `main`.

### 3. Vercel

Import the GitHub repository as one Vercel project with the repository root as
the Root Directory and `main` as the Production Branch. The committed
`vercel.json` supplies the remaining build settings.

Connect the Vercel project to the existing Supabase project through the
Supabase Vercel integration. The adapter prefers the synchronized server-only
`POSTGRES_URL`, which is Supabase's serverless transaction pooler, and falls
back to `POSTGRES_URL_NON_POOLING` only for integrations that omit it. The
runtime selects `jro_runtime` with `SET LOCAL ROLE` inside every checked-out
transaction so no session state can leak through the shared pooler.
The Vercel adapter also supplies Supabase's published 2021 production CA and
keeps certificate and hostname verification enabled. URL-level SSL parameters
are removed before the explicit trusted-root configuration is handed to `pg`,
because `pg` otherwise replaces the supplied TLS object when parsing them.
`JRO_DATABASE_URL` remains an explicit override for local or independently
managed deployments. Enable Vercel's automatic system environment variables so
generated preview and deployment hosts can be admitted exactly through
`VERCEL_URL` and related values. Never copy any database URL into a
client-prefixed variable or commit it to `.env`.

Connect the Vercel project to the GitHub repository. Vercel then creates a
production deployment for every merge to `main`. Preview builds intentionally
have no production database secret unless a separate staging Supabase project
is later configured.

## Continuous deployment behavior

Frontend releases use Vercel's native Git integration. A merge to `main`
creates the production deployment from the committed build and API config.

Backend releases use Supabase's native GitHub production deployment. The
integration watches `main`, applies pending files under `supabase/migrations`,
and uses Supabase's migration history to skip versions already applied.

Never edit or renumber an applied `db/NNNN_*.sql` or released-data seed. Add a
new numbered migration instead. Never repair production migration history or
reset the linked database without a separately reviewed recovery decision.

## Post-deployment verification

After both projects are live:

1. Confirm the Vercel production deployment is built from the expected `main`
   commit.
2. Load `/` and verify the Content Security Policy, no-store policy, neutral
   Japanese catalogue copy, grouped payment-method card, and report controls.
3. Verify `GET /api/experimental/rules` and
   `GET /api/experimental/facts` return bounded JSON without source URLs,
   hashes, evidence payloads, or database identifiers.
4. Submit one synthetic comparison through the UI and confirm the unified
   route response retains its internal synthetic/experimental audit fields
   without rendering those implementation labels as customer-facing badges.
5. In Supabase, verify all staged migration versions are present and that
   `jro_runtime` is `NOLOGIN`, non-superuser, and has no direct table writes.
6. Merge a harmless follow-up through a pull request and confirm Vercel deploys
   the new `main` commit while the Supabase production deployment reports the
   database is up to date.

The volatile recommendation/correction session remains process-local. A
serverless instance change can invalidate that optional draft action; durable
authenticated correction sessions are a separate product milestone.
