# M3 real-data alpha candidate — 2026-08-20

## Outcome

The project owner approved **manual use of paraphrased structured facts** on 2026-08-20 and directed the work to proceed. Automated collection and copied page-body storage remain prohibited by project policy. This is an internal product decision, not a claim of publisher-issued licensing or legal advice.

The first real-data alpha slice now has **six verified, approved, hash-bound normalized evidence records** and two immutable golden scenario fixtures. Both completed the declared `solo_dual_pass` followed by `agent_challenged` sequence, clear the isolated per-scenario gate, and bind the exact under-review rule definitions used by their replay. A generated seed now stores the evidence, scenarios, exact provenance links, and sealed replays in private canonical database tables. The project has not published those rules or activated real-data frontend routes.

Machine-readable record: [jp-cvs-real-data-alpha-candidate-2026-08-20.v0.1.json](../../fixtures/m3/jp-cvs-real-data-alpha-candidate-2026-08-20.v0.1.json).

`JP-XFR-002` remains excluded as previously deferred.

## Verified observations

- The three registered first-party pages rendered in a manual browser without authentication on 2026-08-20.
- The Seven-Eleven nanaco page visibly describes cash charge increments and limits, tender-combination exclusions, product exclusions, and the existence of purchase-based points.
- The nanaco earning area links to first-party detail pages that visibly describe the ordinary-purchase rate and Seven Card Plus charge reward.
- The prior `merchant.seveneleven.payment-faq` mapping was specifically about nanaco payment eligibility. `JP-CVS-002` now maps to the exact `merchant.seveneleven.payment-methods` page.
- Seven-Eleven's site terms restrict use of site content beyond legally permitted/private-use bounds. The nanaco site policy also restricts reproduction and commercial use without prior consent and asks for prior consent before linking.

No page body, screenshot, or excerpt was saved. Each normalized structured snapshot is stored locally and its exact bytes are SHA-256 bound by an `EvidenceRecord`; these hashes cover the project-created normalized representation, not the publisher's page body. A primary bounded reread and an independent agent challenge completed the declared evidence review modes. The payment-method snapshot was corrected to include debit/prepaid and gift/QUO families before approval.

## Verified evidence, candidate-only calculation inputs

The candidate record contains normalized paraphrases for:

- nanaco cash charge increments and limits at Seven-Eleven;
- payment methods that cannot be combined with nanaco;
- the ordinary eligible-purchase nanaco point rate;
- the Seven Card Plus to nanaco charge point rate.
- the standard Seven Card Plus credit-charge minimum, increment, per-charge maximum, balance limit, preregistration requirement, and posting cycle;
- the nanaco point-to-electronic-money conversion value and its no-cancellation condition.

The facts are evidence-approved for the two isolated M3 fixtures, and integrated replay plus accountable scenario review now pass. The two frozen replay oracles are materialized as golden fixtures and private canonical database rows. That does not authorize rule publication, production recommendation, or frontend activation.

## Mapping corrections completed

`JP-CVS-002` now uses the exact first-party Seven-Eleven payment-method source.

`JP-CVS-006` now uses the exact nanaco purchase-earning, Seven Card Plus charge amount/earning, and point-redemption detail sources alongside the Seven-Eleven nanaco rules source.

## Recorded source-policy decision

The project-owner decision is:

1. `approved_manual` for manual browser review;
2. store paraphrased normalized facts and hashes, not copied page bodies or screenshots;
3. retain source identity, URL, capture time, and attribution;
4. use weekly manual refresh for this high-volatility slice;
5. do not infer permission for automated collection from reachability or `robots.txt` behavior.

The reviewed rule-version mapping, immutable golden materialization, and private canonical database seeding are complete for `JP-CVS-002` and `JP-CVS-006`. Each golden document records exact definition hashes, validity rectangles, evidence IDs, replay versions/hashes, result-origin metadata, and an explicit `publication_authorized: false` replay boundary. The database additionally requires exact evidence/rule links and one sealed replay, and makes the completed golden graph immutable. Rule publication remains a distinct gate requiring approved versions and completed publication requests; frontend activation remains separate.

A machine-generated publication dossier now binds exactly five proposed version-2 rules to their version-1 definition hashes, evidence IDs, golden fixture hashes, and replay hashes. The deliberately synthetic unsupported-tender denial is retained only in the golden fixture and explicitly excluded from publication. The separate accountable human decision remains `pending`, so no publication SQL exists. The generator refuses stale hashes, incomplete confirmations, agent-like reviewer identities, or partial publication.

## Release blockers discovered during encoding

The first encoding pass found that the official shopping rule uses a **before-tax** denominator while the engine previously ignored `scope.tax_basis`. This checkpoint resolves that contract defect: a purchase line can now carry an explicit, validated `tax_exclusive_amount_jpy`; tax-exclusive rules must use eligible line items; and calculation fails closed when the value is absent or invalid.

The separate credit-charge blocker is also resolved at the evidence level. The first-party Seven Card source states the standard route's JPY 5,000 minimum, JPY 1,000 increment, JPY 30,000 per-charge maximum, JPY 50,000 balance limit, preregistration requirement, reward rate, and monthly posting cycle. These values remain non-publishable until an explicit rule-publication review completes.

## Verification at this checkpoint

- all 11 schemas compile and the offline package validator accepts 144 sources, five access observations, six indexed real-data evidence records, 10 seed blueprints, and 100 planned scenarios;
- the M3 source gate passes 9 tests and keeps automation blocked while allowing only the six owner-approved manual source paths through source-policy promotion readiness;
- the M3 gate and remediation suites pass 28 focused tests, including strict preflight-result provenance and the historical August 18 artifacts under their original source mappings;
- the contracts suite passes 22 tests and the rule engine passes 74 tests, including explicit tax-exclusive success and missing-value fail-closed coverage;
- the focused golden-fixture suites pass 14 tests, including exact schema/semantic validation, canonical fixture/result/replay hash verification, zero evaluator calls when the JP-CVS-006 preregistration fact is missing, and accountable preflight rejection of the below-minimum plan;
- the generated seed freshness check passes, and a clean PostgreSQL 16.14 database passes five migrations, one seed, and eight SQL tests including direct-publish, forged-request, provenance-mutation, and incomplete-golden attacks;
- root typecheck, tests, property tests, and build all pass.

After this checkpoint, both scenarios have manual independent calculation artifacts, integrated replay, passed negative/conservation/replay checks, ordered accountable review events, exact under-review rule-version bindings, canonical-hash manifests, and private canonical persistence. `JP-CVS-002` replays an accepted credit-card family against a deliberately unsupported tender without inventing rewards. `JP-CVS-006` proves the JPY 5,000 credit top-up, JPY 660 gross / JPY 600 tax-exclusive purchase, 25 plus 3 points, and JPY 4,340 residual principal; missing preregistration and the below-minimum comparison are rejected before reward calculation. The real-data modules and golden files remain excluded from the package entrypoint. Rule publication and frontend activation remain separate blocked steps.
