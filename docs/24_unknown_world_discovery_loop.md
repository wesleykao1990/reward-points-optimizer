# Unknown-world discovery loop — v0.6 planning context

## Goal

Known-world monitoring answers:

```text
registered source family
→ did anything change?
```

Unknown-world discovery answers:

```text
market / official announcements / partner directories / new portals
→ is there something important we do not track yet?
```

The purpose of the unknown-world loop is to continuously expand the coverage universe without weakening the Rewards trust model or turning Agent Feed into a rewards-specific crawler.

## Responsibility split

### Discovery Producer

A web/search/feed/sitemap research worker explores broad discovery scopes and submits structured candidates.

### Agent Feed

Agent Feed remains generic. It records discovery runs, scope, findings, evidence, idempotency, liveness and delivery. It does **not** decide whether a new points program or card should become supported.

Use a generic finding profile such as:

```text
finding_type = coverage_candidate
```

### Rewards Optimizer consumer

Rewards owns entity resolution, coverage-candidate state, domain relevance, source-family registration, canonical evidence and rule publication.

### Codex

Codex is not the continuous monitor. Codex is the implementation/research maintainer that acts on an accepted candidate: research official sources, propose catalogue/source-family changes, add tests, regenerate package checksums where required, and open a PR. It must never directly publish economic truth from a discovery finding.

## Candidate types

A `CoverageCandidate` can represent:

- `new_source_for_existing_family`
- `new_source_family`
- `new_reward_portal`
- `new_selectable_product`
- `new_reward_asset`
- `new_transfer_relationship`
- `new_merchant_or_channel`
- `new_payment_interface`
- `new_campaign_surface`
- `provider_rebrand_or_shutdown`
- `possible_duplicate_or_alias`

## Candidate lifecycle

```text
discovered
  ↓
normalized
  ↓
resolved_against_registry
  ├─ existing_family_child_source
  ├─ duplicate_or_alias
  └─ genuinely_novel
          ↓
       triaged
          ├─ rejected
          ├─ deferred
          └─ accepted_for_research
                    ↓
             evidence_acquisition
                    ↓
               proposal_ready
                    ↓
               Codex PR / human review
                    ↓
                 onboarded
```

No candidate state transition directly creates a `RewardRuleVersion`.

## Discovery scopes

Use broad query packs rather than fixed source-family URLs. Suggested scopes:

### New loyalty/payment programs

Japanese query concepts include:

- 新ポイントサービス
- ポイントサービス開始
- 新決済サービス
- QR決済 開始
- 電子マネー 新サービス
- ポイント制度 リニューアル
- 共通ポイント 提携開始

### New transfer relationships

- ポイント交換 開始
- マイル交換 開始
- 移行レート 変更
- ポイント増量 交換
- ホテルポイント マイル 交換

### New card and wallet products

- 新クレジットカード 発表
- 新カード ポイント還元
- 新ウォレット 決済
- 新プリペイドカード
- 新デビットカード ポイント

### New reward portals / point sites

- ポイントサイト 新サービス
- ポイ活 サービス 開始
- ショッピング経由 ポイント
- ポイント交換先 追加
- ポイントモール 新設

### Merchant/payment acceptance changes

- PayPay 導入
- 楽天ペイ 導入
- d払い 導入
- 共通ポイント 導入
- タッチ決済 対応
- ポイント 提携 店舗

### Travel loyalty

- マイレージ 新提携
- ホテル ロイヤルティ 新提携
- ポイント移行 パートナー
- 日本 会員プログラム 開始

## Discovery sources

Use source classes with different authority roles:

1. **Official announcement surfaces** — company newsrooms, program notices, press releases, campaign pages, help/FAQ changes.
2. **Official structured surfaces** — sitemaps, RSS/Atom feeds, partner directories, merchant directories, exchange-partner directories, app-store listings where relevant.
3. **Regulatory/industry surfaces** — FSA/METI/industry registration lists and payment/loyalty announcements.
4. **Broad web/search discovery** — search-engine queries against the query packs.
5. **Trade/consumer discovery** — payments media, point-site comparisons, travel loyalty media, social posts. These are discovery only and must lead to official evidence before onboarding.
6. **Known-site graph expansion** — inspect new outbound domains/entities linked by official partner or exchange directories.

Point sites are especially useful discovery surfaces because their merchant/card/service catalogues reveal new products and rate changes. They are still not canonical issuer evidence for the underlying credit card or merchant rule.

## Novelty resolution before alerting humans

Every discovery finding must be resolved against:

- existing `family_id`s;
- provider/program aliases;
- known official domains;
- known product IDs;
- known merchant IDs;
- known transfer relationships;
- historical/rebranded names.

Possible outcomes:

```text
new page for existing family
→ source acquisition candidate

same program under a new alias
→ alias/rebrand candidate

new product under known issuer
→ selectable-product candidate

new program/domain/relationship
→ genuine coverage candidate
```

This prevents the unknown loop from spamming the review queue with false novelty.

## Candidate prioritization

Rank candidates using structured signals rather than agent confidence alone:

- novelty versus registry;
- Japan/user relevance;
- potential economic impact on a purchase route;
- national/merchant reach;
- connectivity to already supported assets/programs;
- source authority and evidence completeness;
- recency;
- repeated independent discovery;
- expected maintenance cost.

Suggested decision bands:

- **High:** likely changes an optimizer winner or unlocks a major program → immediate review.
- **Medium:** useful expansion but unlikely to affect the current alpha → backlog.
- **Low:** niche/uncertain/foreign long tail → P3/discovery backlog.

## Agent Feed run model

Create discovery streams separate from known-world streams, for example:

```text
discovery.jp.reward-portals
discovery.jp.payment-programs
discovery.jp.cards-wallets
discovery.jp.transfer-partners
discovery.jp.merchant-acceptance
discovery.jp.travel-loyalty
```

A discovery run uses the normal lifecycle:

```text
begin_run
→ submit_batch(coverage_candidate findings)
→ complete_run
```

Expected scope records query packs/source classes rather than specific reward families.

A zero-candidate completed run means the market was checked and no candidate crossed the submission threshold. A missing/failed discovery run is still an overdue/degraded condition.

## Rewards-side persistence

Recommended future table/model:

```text
coverage_candidates
coverage_candidate_evidence
coverage_candidate_alias_matches
coverage_candidate_reviews
coverage_candidate_outcomes
```

Minimum candidate fields:

```text
candidate_id
candidate_type
proposed_name
normalized_name
proposed_domain
country_scope
source_evidence_refs
discovery_run_id
novelty_resolution
matched_existing_ids[]
priority_band
status
first_seen_at
last_seen_at
review_reason
accepted_research_issue_url
```

## Codex handoff

When a candidate reaches `accepted_for_research`, the Rewards service or operator creates a structured GitHub Issue containing:

- candidate ID/type;
- discovery evidence;
- why it appears novel;
- possible existing matches;
- expected source roles;
- target priority;
- acceptance tests;
- explicit instruction that discovery evidence is not canonical truth.

Codex then:

1. reads the issue and current context branch;
2. searches official sources;
3. determines whether it is truly new, an alias, child source or new product;
4. proposes source-family/product-catalogue changes;
5. adds regression/coverage tests;
6. regenerates release checksums if a main-package change is intentionally made;
7. opens a PR; never writes directly to `main` for research additions.

## Self-improving discovery

After candidate review, feed the outcome back into discovery:

```text
accepted true new family
→ add discovered terminology/domain to future query seeds

alias/duplicate
→ expand alias dictionary and suppress repeats

false positive
→ add negative pattern/source rule

new official directory discovered
→ add it as a recurring discovery surface
```

This creates a closed loop where the discovery system learns the market vocabulary and reduces duplicate/noisy findings over time.

## Metrics

Track both known-world and unknown-world health. Unknown-world metrics should include:

- discovery runs completed/missed/failed;
- candidates per run;
- genuine-new-family precision;
- duplicate/alias rate;
- candidate-to-accepted-research conversion;
- accepted-to-onboarded conversion;
- median time discovery → triage;
- median time accepted → PR;
- median time accepted → supported;
- percentage of new programs first discovered by this loop versus manually;
- retrospective miss rate;
- new-source versus new-family versus new-product mix;
- useful candidate per unit of research cost.

## Safety / anti-spam gates

- Limit candidate batch size and per-query duplication.
- Do not submit raw search results as candidates without a concrete entity/change claim.
- Prefer official evidence before assigning High priority.
- Discovery/trade/SNS sources never create canonical rules.
- No automatic new family becomes `fully_supported`.
- No Codex-generated PR can bypass existing evidence/review/bitemporal constraints.

## Rollout

### Stage D0 — manual prototype

Run the query packs manually once per week and submit a JSON run bundle through Agent Feed. Measure candidate precision.

### Stage D1 — API discovery worker

Schedule 6–10 broad discovery streams daily/weekly. Use web search plus official sitemaps/notices. Submit only deduplicated candidates.

### Stage D2 — candidate review + GitHub issue handoff

Persist `CoverageCandidate`, triage, and create Codex research issues for accepted candidates.

### Stage D3 — feedback optimization

Use accepted/rejected/alias outcomes to tune query packs, aliases and source weighting.

Do not automate registry promotion or rule publication until the loop has demonstrated high novelty precision and manageable review cost.
