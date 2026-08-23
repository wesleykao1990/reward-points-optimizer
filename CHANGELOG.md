# Changelog

## Unreleased — 2026-08-23

- Reflected 12 accepted non-P0 Agent Feed findings across 14 point, stored-value, electronic-money, and transit-IC families immediately as `active_experimental`. Added an authenticated correction RPC that atomically disputes or quarantines a flagged finding; none of these records are canonical. Yodobashi remains partial after the official source returned HTTP 403.
- Merged the award-wallet front-end revamp and expanded the merchant selector
  from the Seven-Eleven canary to every merchant family currently projected by
  the P0 catalogue.
- Removed the fixed purchase-claim ID map. Selected services now discover
  structured base-rate claims by family and source role, return their official
  source/check date, and mark that the claim was automatically used in the
  calculation.
- Added automatic structured Agent Feed reward processing: an admitted
  `reward-claim.v1` finding bound to an exact P0 target is compiled, persisted,
  and atomically activated without a manual promotion step. Malformed claims
  fail independently and are never inferred from prose.
- Added the bounded active reward-claim PostgreSQL projection and wired it into
  the normal recommendation runtime. Active computable rules now replace the
  bootstrap calculation for their service family automatically, with exact
  merchant/tax/validity/provenance bindings and sibling isolation.
- Added `GET /api/consumer/reference`, projecting source-backed wallet expiry,
  redemption, merchant acceptance, and campaign fields with stable family and
  claim IDs, effective dates, validity state, and official provenance.
- Repositioned the consumer shell from a per-purchase comparison tool to an
  award wallet. `balance` is now the landing tab, the redemption planner is
  promoted to `spend`, the merchant comparison keeps its behaviour as `earn`
  with the session log folded in, and the bottom bar carries five peer
  destinations.
- Added a lot-level ledger. Each programme expands into lots that each carry
  their own countdown, usage restriction, extendable/fixed verdict, and
  estimated/confirmed confidence, with rule exceptions pinned to the lot they
  qualify rather than the programme. A 90-day runway sizes bars by yen value
  and hands the tapped lot to the redemption planner. It runs on a
  checked-in balance dataset because no account/balance backend exists yet.
  Expiry and redemption reference fields now come from the source-backed P0
  catalogue when available.
- Added a per-figure valuation disclosure and per-rule source attribution, so
  no yen total is shown without the assumption behind it and no expiry rule
  without its source and check date.
- Replaced the visual system with an award-wallet console: white cards on a
  cool grey ground, one elevation step, full-round status chips, and a
  colour system where the primary hue never encodes status.
- Self-hosted the Latin subsets of Archivo and JetBrains Mono under
  `public/assets/fonts` (66 KB) and added `font-src 'self'` to the loopback
  and hosted CSP. No font CDN is contacted, so the same-origin stance holds.
- Added a motion layer adapted from yui540's public CSS studies: a diagonal
  clip-path wipe on a `--skew-x` variable, paired offset sheets, and one
  signature easing shared by every reveal. Frequent transitions run at about
  a third of the reference amplitude; the full length is spent only on the
  opening sheet and the comparison result. Balance figures count on the same
  curve and runway bars grow from the axis in a stagger.
- Guaranteed motion is never load-bearing: reveal classes are opt-in so the
  resting DOM is the finished state, the opening sheet self-removes on both
  `animationend` and a timeout, and `prefers-reduced-motion` clears reveal
  states outright instead of shortening them.
- Presented balance capture as credential-free by design (screenshot, paste,
  CSV, manual entry) and stated in settings what the product does not
  collect: no service logins, no bank or card statements, no browser storage.

## Unreleased — 2026-08-19

- Added a PostgreSQL-backed `AtomicPersistencePort` for verified Agent Feed
  events. Receipt, observation/evidence lead, and lifecycle effects now commit
  or roll back together through a private security-definer adapter; no
  canonical evidence, reward rule, or publication is created by intake.
- Added one deterministic nanaco economic pilot bound to the exact reviewed
  `rr_jp_cvs_006_nanaco_purchase_reward` definition, registered primary source,
  and `point.nanaco / earn_rules` role. It remains under review and requires
  explicit provisional activation.
- Added a server-owned PostgreSQL nanaco host that keeps the generic store and
  evidence verifier private, distinguishes Agent Feed lead IDs from canonical
  evidence keys, and activates only after an exact verified-evidence/source/
  rule-version lookup.
- Merged Agent Feed PR #16 to preserve the full nine-root `submit_batch` MCP
  declaration. The live ChatGPT connector remains unverified until PostgreSQL,
  the secure tunnel, and connector rediscovery are restored.

- Added a bounded current Agent Feed protocol `0.1` run for the registered
  Seven-Eleven payment-methods source. Its normalized finding contains exactly
  11 explicitly observed payment families and retains only lead-only evidence;
  no raw page body or inferred economic fact is stored.
- Added deterministic generation, atomic admission, private database
  persistence, and separately correctable Japanese catalogue entries for those
  11 provisional payment-acceptance rules. They remain `under_review`, outside
  recommendation calculation and canonical `RewardRuleVersion` publication.
- Bound payment-acceptance candidates to the exact singular/plural payment
  families declared by their `SourceObservation`; invented or mismatched
  payment families now reject the entire batch before mutation.
- Added atomic provisional-publication batches for 1–32 fully admitted
  candidates, including sealed-plan binding, deterministic identities,
  all-or-nothing in-process and PostgreSQL persistence, idempotent exact replay,
  and correction-safe removal without resurrection.
- Added a separate Japanese localhost `先行公開データ` catalogue for the exact
  machine-checked Seven-Eleven acceptance candidate. The UI can report a
  bounded correction that disputes and removes that exact version; provisional
  data remains excluded from synthetic optimizer recommendations.
- Added the P0 source-operations alpha: an exact, hash-bound inventory of 44
  source families, 19 Agent Feed streams, and 301 required semantic source
  roles, plus private PostgreSQL planning/readiness persistence with a one-way
  exact-count seal and post-seal append/truncate denial.
- Kept P0 readiness fail-closed across producer authorization, permission,
  technical acquisition, liveness, canonical evidence or conservative
  exclusion, and impact mapping. The database starts with zero ready roles and
  zero supported families; only the existing Seven-Eleven rehearsal role is
  separately experimental.
- Added an interim P0 provisional-rule ingestion checkpoint: a fail-closed
  in-process kernel, private PostgreSQL persistence, correction-driven
  exclusion/quarantine, and one durable Seven-Eleven payment-acceptance
  rehearsal imported from a local Agent Feed run bundle.
- Kept the rehearsal explicitly experimental: its transport receipt is marked
  unverified, submitted evidence remains lead-only, the rule remains
  `under_review`, and no canonical rule approval, publication request, or
  consumer-frontend route is created.
- Hardened provisional admission against forged/hostile representations,
  lifecycle and review claims, semantic-role/authority confusion, duplicate
  family-role coverage, non-primary activation, and database JSON NULL or
  legacy-field fail-open behavior.
- Added the first project-owner-approved manual real-data slice for
  Seven-Eleven/nanaco: five first-party normalized snapshots, hash-bound draft
  evidence, exact source mappings, and fail-closed review/publication controls.
- Completed isolated integrated replay, accountable scenario review, exact
  reviewed rule-version binding, and immutable golden materialization for
  `JP-CVS-002` and `JP-CVS-006`; both remain unpublished.
- Added a reproducibly generated private database seed for the six approved
  EvidenceRecords and two golden scenarios, exact sealed-replay completion and
  immutability constraints, and an adversarial SQL gate. All six associated
  rules remain `under_review`, have no publication request, and are excluded
  from the approved-rule API view.
- Prepared a deterministic five-rule publication dossier and an all-or-nothing
  SQL generator. It binds exact definition/evidence/fixture/replay hashes,
  rejects stale or agent-authored decisions, and refuses to emit publication
  SQL while the accountable human review remains pending. The deliberately
  synthetic unsupported-tender rule is explicitly excluded from publication.
- Extended the golden-scenario contract with rule definition hashes, validity
  and evidence bindings, replay admission/version/hash provenance, and honest
  engine-versus-preflight result origins.
- Added explicit preflight-result provenance to the M3 promotion gate so an
  invalid candidate is paired with its replay without pretending the reward
  engine evaluated it.
- Added explicit per-line tax-exclusive eligible spend to the purchase-plan
  contract and engine. Tax-exclusive rules now require explicit values and
  fail closed instead of calculating from tax-inclusive tender amounts.
- Kept the real nanaco route unpublished while explicit rule-publication review
  and frontend activation remain pending.
- Added the Milestone 7 deterministic challenge-track package: strict canonical
  100-target admission, non-evidentiary `SYN-M7-*` probes, capability-bound
  all-or-nothing batch execution, and exact progress accounting.
- Added `pnpm challenge:validate`. Its canonical audit reports 100
  declared/planned targets and zero executed, evidence-backed, or golden
  scenarios; production remains blocked by M3/M4.
- Closed hostile-review bypasses for forged plan/case/result lookalikes,
  alias-shaped and partial batches, replay-wrapper cleanup, cross-plan case
  binding, artifact TOCTOU/mutation, and hostile registry representations. The
  M7 infrastructure decision is **GO**; the real 100-scenario evidence program
  remains pending.
- Added the Milestone 6 local synthetic consumer alpha: immutable Tokyo-scoped
  onboarding state, exact per-asset valuation/cap admission, fail-closed
  presentation, host-owned synthetic deep links, and hash-bound session-only
  corrections.
- Added a loopback-only Node/static-DOM shell with an allowlisted manual-state
  DTO, deterministic full-input recommendation IDs, bounded issued-result
  correction authority, strict CSP/Host/Origin/body/query controls, and no
  browser storage, cookies, source/evidence output, or unsafe HTML rendering.
- Closed independent hostile-review findings covering Proxy/hidden/accessor
  input, PAN/token/email data, decimal overflow, empty or reordered state,
  forged/blocked output, unresolved questions labeled definite, duplicate
  fallback, request-ID collisions, unissued corrections, evidence leakage,
  and misleading official-link labels. The M6 decision is **GO only for the
  local synthetic checkpoint**; real-data and production use remain blocked.
- Added the Milestone 5 pure offline recommendation boundary for an
  internal/synthetic foundation: exact merchant/branch and frozen-purchase
  matching, explicit bitemporal inputs, versioned trust/evidence admission,
  deterministic candidate partitioning and hash verification, and a hard
  production blocker.
- Added security admission, allowlisted redacted history/retention decisions,
  and host-authorized hash-bound fixture/incident replay contracts. These are
  in-process ports only; no HTTP, database, authentication, or current-reward
  production beta is enabled.
- Recorded the independent Milestone 5 core and security **GO** reviews while
  retaining the M4 `insufficient_data` operational gate and deferred
  `JP-XFR-002` human experiment.
- Added the Milestone 4 two-lane maintenance foundation with an immutable
  eight-source cohort, fail-closed direct-check records, deterministic rehearsal
  metrics, and synthetic-only fixtures.
- Added pinned-schema local Agent Feed run-bundle validation and normalization
  with a single immutable atomic-batch persistence boundary.
- Added hostile regressions for method and scope substitution, forged records,
  malformed coverage, incomplete run visibility, validation races, and partial
  callback persistence.
- Deferred the detailed `JP-XFR-002` experiment while retaining the owner's ANA
  2:1 conversion statement as a non-evidentiary research note.

## 0.4.1 — 2026-08-17

- Applied the pre-implementation review fixes and added runnable prototype code.
- Removed historical uniqueness from definition hashes and added publication idempotency.
- Conserved assets by asset plus reward class and removed generic adjust movements.
- Added required review modes/events, monitoring liveness, hostile Agent Feed regression, receipt redaction, and observation transition controls.
- Pinned the published Agent Feed `@agent-feed/schema@0.1.1` artifact by exact release URL, source commit, SHA-256, size, and SHA-512 integrity.
- Implemented Milestone 2.5 with the pinned Agent Feed `schema-v0.1.1` artifact, exact-byte signed intake, transport/semantic dedupe separation, and acknowledgement after atomic persistence.
- Added canonical `SourceObservation` storage, lead-only evidence acquisition/promotion gates, run lifecycle/liveness incidents, and redacted dead-letter/replay diagnostics.
- Added the 0004 migration, 007 adversarial SQL gate, tagged hostile run-bundle fixture, fresh/non-super PostgreSQL verification, and legacy-data upgrade coverage.


## 0.4.0 — 2026-08-17

- Moved generic agent monitoring transport into the separate sibling `agent-feed` project.
- Added Agent Feed protocol `0.1` consumer boundary and app-specific `SourceObservation` contract.
- Added transport receipt, semantic dedupe, submitted-evidence staging, and no-direct-rule-publication reference migration.
- Added an app-side Agent Feed integration Codex prompt.
- Converted the 30-day maintenance rehearsal into direct-check versus semantic-monitor lanes.
- Documented the Supabase stack and made Realtime optional UX only.
- Added capability-gated ChatGPT monitoring: independent sentinel or run-bundle fallback where outbound tools are unavailable.

## 0.3.0 — 2026-08-17

Convergence revision after independent review of v0.2.

### Fixed

- Replaced current-only approved-interval protection with full bitemporal rectangle exclusion across economic and system time.
- Made `app_api` views `security_invoker` and `security_barrier` so a grant cannot silently lend migration-owner privileges.
- Declared and implemented canonical semantic validation for cross-field user-state and cap ranges.
- Corrected the probabilistic certainty conditional so `probability_source` is non-null when required.
- Reclassified the View Card source as environment-dependent/mixed and retained both the manual-browser 200 and datacenter 403 observations.

### Added

- `docs/13_semantic_validation_contract.md`.
- A second synthetic valuation fixture proving winner reversal with an unchanged native ledger.
- Full replay-ambiguity acceptance/property requirements.
- Residual-value break-even sensitivity as a Milestone 1B/product requirement.
- Explicit first-ten review-mode policy and personal/internal-alpha scope.
- Separate Codex prompts for Milestone 1A and Milestone 1B.

### Changed

- Split the engine foundation into 1A conservation/reconciliation and 1B calculation/uncertainty expansion.
- The initiating Codex run stops after percentage and points-per-unit conservation proofs.
- ADR-006 now names JSON Schema and the semantic-validation contract as complementary canonical layers.

## 0.2.0 — 2026-08-17

Breaking revision after the first independent review.

- Replaced flat recipes with operation-and-asset plans.
- Added residual asset lots, reward classes, settlement, expiry, restrictions, uncertainty, certainty, refunds, and clawbacks.
- Added source access observations and a maintenance rehearsal.
- Hardened schema separation, RLS, retention, immutability, interval integrity, and foreign-key relationships.
- Moved broad scenario expansion behind an operational feasibility gate.

## 0.1.0 — 2026-08-17

Initial evidence-first foundation package.
