# Trusted Data Source Catalogue v0.3

Research cutoff: **2026-08-20**

This catalogue contains **176** source seeds. The YAML registry is canonical; this document is a readable index.

> “Trusted” means that the publisher is appropriate for the listed authority scope. Authority does not grant collection permission, and a dated reachability observation is not durable technical truth.

## Registry state

### Tier summary

| Tier | Count |
|---|---:|
| `T0_REGULATOR` | 4 |
| `T1_CANONICAL` | 108 |
| `T2_OFFICIAL_SUPPORT` | 63 |
| `T3_PARTNER_CONTRACT` | 0 |
| `T4_DISCOVERY_ONLY` | 1 |

### Content-verification summary

| Status | Count |
|---|---:|
| `content_verified` | 8 |
| `registered` | 165 |
| `temporarily_unavailable` | 3 |

### Technical-feasibility summary

| Current derived classification | Count |
|---|---:|
| `plain_http_observed_reachable` | 1 |
| `environment_dependent_or_mixed` | 1 |
| `manual_capture_candidate` | 8 |
| `unknown` | 166 |

Eight official sources are marked content-verified. Three JRE POINT page identities remain registered as `temporarily_unavailable` because Research A observed HTTP 403 on their direct locators; the source identities are retained without claiming fetched evidence. Six content-verified sources belong to the project-owner-approved manual Seven-Eleven/nanaco slice; the remaining records preserve their prior verification and environment-specific access classifications. Manual reachability does not authorize automated collection.

## Selection rules

- Use the merchant for tender acceptance, branch, product, and channel facts.
- Use the card issuer for card earning, annual fee, interface, top-up, and funding exclusions.
- Use the payment provider for wallet earning, voucher/top-up rules, identity, caps, and campaigns.
- Use the loyalty issuer for reward class, redemption, expiry, and transfers.
- Use a specific campaign page over a generic campaign directory.
- Use T4 material only as a change detector that opens a first-party research ticket.
- Record terms permission and technical access separately before collection.

## Regulators and compliance (4)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `gov.caa.stealth-marketing` | `T0_REGULATOR` | Consumer Affairs Agency, Japan | [Stealth marketing guidance](https://www.caa.go.jp/policies/policy/representation/fair_labeling/stealth_marketing) | `affiliate_disclosure`, `advertising_disclosure` | `registered` | `unknown` | low / quarterly |
| `gov.fsa.electronic-payment-intermediary` | `T0_REGULATOR` | Financial Services Agency, Japan | [Electronic payment intermediary registration guidance](https://www.fsa.go.jp/common/shinsei/dendai/index.html) | `financial_regulation`, `account_information_services` | `registered` | `unknown` | medium / quarterly |
| `gov.fsa.registered-providers` | `T0_REGULATOR` | Financial Services Agency, Japan | [Licensed and registered financial service providers](https://www.fsa.go.jp/menkyo/menkyo.html) | `provider_due_diligence` | `registered` | `unknown` | medium / monthly |
| `gov.ppc.credit-card-number-faq` | `T0_REGULATOR` | Personal Information Protection Commission, Japan | [Credit-card numbers and personal information FAQ](https://www.ppc.go.jp/all_faq_index/faq1-q1-25) | `privacy_classification` | `registered` | `unknown` | low / quarterly |

## Technical and platform documentation (12)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `tech.apple.wallet-loyalty` | `T1_CANONICAL` | Apple | [Apple Wallet loyalty passes](https://developer.apple.com/wallet/loyalty-passes/) | `loyalty_passes`, `barcodes` | `registered` | `unknown` | medium / quarterly |
| `tech.cloud-run.job-retries` | `T1_CANONICAL` | Google Cloud | [Cloud Run Jobs retry guidance](https://docs.cloud.google.com/run/docs/jobs-retries) | `worker_retries`, `checkpointing` | `registered` | `unknown` | medium / monthly |
| `tech.expo.secure-store` | `T1_CANONICAL` | Expo | [Expo SecureStore documentation](https://docs.expo.dev/versions/latest/sdk/securestore/) | `mobile_secure_storage` | `registered` | `unknown` | medium / monthly |
| `tech.expo.sqlite` | `T1_CANONICAL` | Expo | [Expo SQLite documentation](https://docs.expo.dev/versions/latest/sdk/sqlite/) | `offline_database` | `registered` | `unknown` | medium / monthly |
| `tech.google.places-policies` | `T1_CANONICAL` | Google | [Places API policies and caching restrictions](https://developers.google.com/maps/documentation/places/web-service/policies) | `merchant_identity`, `data_retention` | `registered` | `unknown` | medium / quarterly |
| `tech.google.wallet-loyalty` | `T1_CANONICAL` | Google | [Google Wallet loyalty cards](https://developers.google.com/wallet/retail/loyalty-cards) | `loyalty_passes`, `barcodes` | `registered` | `unknown` | medium / quarterly |
| `tech.moneytree.link-sdk` | `T1_CANONICAL` | Moneytree | [Moneytree LINK SDK overview](https://docs.link.getmoneytree.com/docs/link-sdk-overview) | `account_aggregation`, `oauth_pkce` | `registered` | `unknown` | medium / monthly |
| `tech.postgresql.range-types` | `T1_CANONICAL` | PostgreSQL Global Development Group | [PostgreSQL range types and exclusion constraints](https://www.postgresql.org/docs/17/rangetypes.html) | `range_types`, `exclusion_constraints`, `temporal_integrity` | `registered` | `unknown` | low / before_release |
| `tech.postgresql.triggers` | `T1_CANONICAL` | PostgreSQL Global Development Group | [PostgreSQL trigger behavior](https://www.postgresql.org/docs/current/trigger-definition.html) | `database_triggers`, `immutability`, `controlled_transitions` | `registered` | `unknown` | low / before_release |
| `tech.supabase.cron` | `T1_CANONICAL` | Supabase | [Supabase Cron documentation](https://supabase.com/docs/guides/cron) | `scheduler` | `registered` | `unknown` | medium / monthly |
| `tech.supabase.database` | `T1_CANONICAL` | Supabase | [Supabase Database overview](https://supabase.com/docs/guides/database/overview) | `postgres`, `postgis`, `extensions` | `registered` | `unknown` | medium / monthly |
| `tech.supabase.rls` | `T1_CANONICAL` | Supabase | [Supabase Row Level Security guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) | `row_level_security`, `database_access_control` | `registered` | `unknown` | medium / quarterly |

## Point, mileage, and loyalty program rules (20)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `global.ihg.terms` | `T1_CANONICAL` | IHG Hotels & Resorts | [IHG One Rewards terms](https://www.ihg.com/content/us/en/customer-care/member-tc.html?hideUHF=false) | `hotel_program_terms`, `transfer_rules` | `registered` | `unknown` | medium / monthly |
| `global.marriott.bonvoy-terms` | `T1_CANONICAL` | Marriott International | [Marriott Bonvoy terms](https://www.marriott.com/loyalty/terms/default.mi) | `hotel_program_terms`, `airline_transfer_rules` | `registered` | `unknown` | medium / monthly |
| `jp.ana.mileage-club` | `T1_CANONICAL` | ANA | [ANA Mileage Club](https://www.ana.co.jp/ja/jp/amc/) | `program_terms`, `mileage_overview` | `registered` | `unknown` | medium / monthly |
| `jp.dpoint.home` | `T2_OFFICIAL_SUPPORT` | NTT DOCOMO | [d POINT Club official site](https://dpoint.docomo.ne.jp/index.html) | `program_overview`, `campaign_discovery` | `registered` | `unknown` | high / weekly |
| `jp.dpoint.terms` | `T1_CANONICAL` | NTT DOCOMO | [d POINT Club terms](https://dpoint.docomo.ne.jp/global/terms/agreement.html) | `membership_terms`, `earn_rules`, `redemption_rules` | `registered` | `unknown` | medium / monthly |
| `jp.jal.mileage-park-howto` | `T1_CANONICAL` | Japan Airlines | [JAL Mileage Park earning guide](https://partner.jal.co.jp/howto/) | `card_stack`, `jal_pay_exclusions`, `mileage_rates` | `registered` | `unknown` | high / weekly |
| `jp.jrepoint.home` | `T1_CANONICAL` | JR East | [JRE POINT official site](https://www.jrepoint.jp/) | `program_overview`, `merchant_discovery` | `registered` | `unknown` | high / weekly |
| `jp.jrepoint.suica-earning` | `T1_CANONICAL` | JR East | [JRE POINT earning with registered Suica](https://www.jrepoint.jp/point/append/suica/) | `suica_registration`, `merchant_earn_rules` | `registered` | `unknown` | high / weekly |
| `jp.nanaco.earning` | `T1_CANONICAL` | Seven Card Service | [How to earn nanaco points](https://www.nanaco-net.jp/how-to/save_point/) | `earn_rules`, `rounding` | `registered` | `manual_capture_candidate` | high / weekly |
| `jp.nanaco.redemption-value` | `T1_CANONICAL` | Seven Card Service | [Convert nanaco points to electronic money](https://www.nanaco-net.jp/how-to/use_point/money.html) | `redemption_value`, `conversion_rules` | `content_verified` | `manual_capture_candidate` | medium / monthly |
| `jp.nanaco.shopping-earning` | `T1_CANONICAL` | Seven Card Service | [nanaco payment earning by merchant](https://www.nanaco-net.jp/how-to/save_point/shopping.html) | `merchant_earn_rules`, `rounding`, `posting_timing`, `product_exclusions` | `content_verified` | `manual_capture_candidate` | high / weekly |
| `jp.sevencard.nanaco-charge` | `T1_CANONICAL` | Seven Card Service | [Seven Card Plus nanaco credit-charge rules](https://www.7card.co.jp/point/save.html) | `nanaco_credit_charge_eligibility`, `nanaco_credit_charge_amount_limits`, `nanaco_credit_charge_increment`, `nanaco_charge_earn_rules`, `posting_timing` | `content_verified` | `manual_capture_candidate` | high / weekly |
| `jp.ponta.overview` | `T1_CANONICAL` | Loyalty Marketing / Recruit | [Ponta program overview](https://point.recruit.co.jp/pontaweb/about/ponta/) | `program_overview`, `earn_rules`, `redemption_rules` | `registered` | `unknown` | medium / monthly |
| `jp.ponta.point-types` | `T1_CANONICAL` | Loyalty Marketing / Recruit | [Ponta point types](https://point.recruit.co.jp/pontaweb/about/point/) | `point_types`, `expiry` | `registered` | `unknown` | medium / monthly |
| `jp.rakuten.pointclub` | `T1_CANONICAL` | Rakuten Group | [Rakuten PointClub](https://point.rakuten.co.jp/) | `point_balance`, `program_overview`, `campaign_discovery` | `registered` | `unknown` | high / weekly |
| `jp.vpoint.app-terms` | `T1_CANONICAL` | V Point | [V Point app terms](https://privacy.vpoint.co.jp/terms/point-app/) | `app_terms`, `barcode_usage` | `registered` | `unknown` | low / quarterly |
| `jp.vpoint.member-terms` | `T1_CANONICAL` | CCCMK Holdings / V Point | [V Member and V Point terms](https://tsite.jp/tm/pc/register/STKIp0108001.do) | `membership_terms`, `earn_rules`, `redemption_rules` | `registered` | `unknown` | medium / monthly |
| `jp.vpoint.overview` | `T1_CANONICAL` | V Point | [V Point official overview](https://web.tsite.jp/vpoint/) | `program_overview` | `registered` | `unknown` | medium / monthly |
| `jp.vpoint.value-and-use` | `T2_OFFICIAL_SUPPORT` | V Point | [How to use V Points](https://t-point.tsite.jp/use/about/) | `redemption_value`, `redemption_methods` | `registered` | `unknown` | medium / monthly |
| `jp.waonpoint.earning-faq` | `T2_OFFICIAL_SUPPORT` | AEON Marketing | [WAON POINT earning FAQ](https://faq.waonpoint.jp/category/show/11?site_domain=default) | `earn_rules`, `presentation_requirement` | `registered` | `unknown` | high / weekly |
| `jp.waonpoint.faq` | `T2_OFFICIAL_SUPPORT` | AEON Marketing | [WAON POINT official FAQ](https://faq.waonpoint.jp/category/show/1?site_domain=default) | `program_rules`, `redemption_rules` | `registered` | `unknown` | high / weekly |

## QR, wallet, stored-value, and payment reward rules (11)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `jp.aeonpay.overview` | `T1_CANONICAL` | AEON Financial Service | [AEON Pay overview](https://www.aeon.co.jp/service/lp/aeonpay/) | `payment_methods`, `program_overview` | `registered` | `unknown` | high / weekly |
| `jp.aeonpay.reward-guide` | `T2_OFFICIAL_SUPPORT` | AEON Financial Service | [AEON Pay reward explanation](https://www.aeon.co.jp/column/20240221_02/) | `base_earn`, `payment_route` | `registered` | `unknown` | high / weekly |
| `jp.aupay.reward-guide` | `T2_OFFICIAL_SUPPORT` | KDDI | [au PAY reward-rate guide](https://media.aupay.wallet.auone.jp/articles/422) | `base_earn`, `stacking` | `registered` | `unknown` | high / weekly |
| `jp.paypay.calculation-faq` | `T2_OFFICIAL_SUPPORT` | PayPay | [PayPay point calculation FAQ](https://paypay.ne.jp/help/c0373/) | `rounding`, `split_payment`, `eligible_basis` | `registered` | `unknown` | high / weekly |
| `jp.paypay.eligibility-faq` | `T2_OFFICIAL_SUPPORT` | PayPay | [PayPay Step eligibility and service changes FAQ](https://paypay.ne.jp/help/c0111/) | `identity_verification`, `points_used_basis`, `service_changes` | `registered` | `unknown` | high / weekly |
| `jp.paypay.reward-rate` | `T1_CANONICAL` | PayPay | [PayPay reward-rate explanation](https://paypay.ne.jp/article/reward-rate/) | `base_earn`, `eligible_basis` | `registered` | `unknown` | high / weekly |
| `jp.paypay.step` | `T1_CANONICAL` | PayPay | [PayPay Step](https://paypay.ne.jp/event/paypaystep/) | `tier_conditions`, `identity_verification`, `monthly_progress` | `registered` | `unknown` | high / weekly |
| `jp.paypay.third-party-card-voucher` | `T1_CANONICAL` | PayPay | [PayPay third-party card voucher help](https://paypay.ne.jp/help/c0551/) | `voucher_purchase`, `funding_route`, `purchase_increment`, `residual_balance`, `merchant_exclusions`, `reward_exclusions`, `rollout_eligibility` | `content_verified` | `plain_http_observed_reachable` | very_high / daily |
| `jp.rakutenpay.double-points` | `T1_CANONICAL` | Rakuten Payment | [Rakuten Pay combined point earning](https://pay.rakuten.co.jp/detail/point/double/) | `stacking`, `point_card_presentment` | `registered` | `unknown` | high / weekly |
| `jp.rakutenpay.point-detail` | `T1_CANONICAL` | Rakuten Payment | [Rakuten Pay point detail](https://pay.rakuten.co.jp/detail/point/) | `base_earn`, `eligible_basis` | `registered` | `unknown` | high / weekly |
| `jp.rakutenpay.point-program` | `T1_CANONICAL` | Rakuten Payment | [Rakuten Pay point program](https://pay.rakuten.co.jp/topics/pointprogram/) | `base_earn`, `presentation_requirement`, `funding_source` | `registered` | `unknown` | high / weekly |

## Card product pages (4)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `jp.aupaycard.product` | `T1_CANONICAL` | KDDI / au Financial Service | [au PAY Card](https://www.au.com/payment/card/) | `annual_fee`, `base_earn`, `autocharge_rewards` | `registered` | `unknown` | high / weekly |
| `jp.dcard.product` | `T1_CANONICAL` | NTT DOCOMO | [d Card product and benefit overview](https://d-card.jp/st/abouts/d-cardapply.html) | `annual_fee`, `base_earn`, `product_eligibility` | `registered` | `unknown` | medium / monthly |
| `jp.paypaycard.product-compare` | `T1_CANONICAL` | PayPay Card | [PayPay Card product comparison](https://www.paypay-card.co.jp/service/card/compare/) | `annual_fee`, `product_benefits` | `registered` | `unknown` | medium / monthly |
| `jp.rakutencard.product` | `T1_CANONICAL` | Rakuten Card | [Rakuten Card product overview](https://www.rakuten-card.co.jp/card/rakuten-card/) | `annual_fee`, `base_earn`, `product_eligibility` | `registered` | `unknown` | medium / monthly |

## Card reward and exclusion rules (7)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `jp.nanaco.sevencard-earning` | `T1_CANONICAL` | Seven Card Service | [Seven Card Plus purchase and nanaco charge earning](https://www.nanaco-net.jp/how-to/save_point/creditcard.html) | `card_purchase_earn_rules`, `nanaco_charge_earn_rules`, `rounding` | `content_verified` | `manual_capture_candidate` | high / weekly |
| `jp.dcard.exclusions` | `T1_CANONICAL` | NTT DOCOMO | [d Card point exclusions and posting timing](https://d-card.jp/st/services/dcard_attention.html) | `excluded_transactions`, `posting_timing` | `registered` | `unknown` | high / weekly |
| `jp.dcard.special-merchants` | `T1_CANONICAL` | NTT DOCOMO | [d Card special merchant benefits](https://d-card.jp/st/services/points/use.html) | `merchant_bonus`, `base_earn` | `registered` | `unknown` | high / weekly |
| `jp.paypaycard.point-rules` | `T1_CANONICAL` | PayPay Card | [PayPay Card point rules](https://www.paypay-card.co.jp/service/benefit/point/) | `base_earn`, `excluded_transactions` | `registered` | `unknown` | high / weekly |
| `jp.smbc.eligible-merchant-rewards` | `T1_CANONICAL` | Sumitomo Mitsui Card | [SMBC eligible convenience and restaurant rewards](https://www.smbc-card.com/nyukai/merit/proper_p5.jsp) | `merchant_bonus`, `payment_channel`, `exclusions` | `registered` | `unknown` | high / weekly |
| `jp.smbc.vpoint-up-program` | `T1_CANONICAL` | Sumitomo Mitsui Card | [SMBC V Point Up Program](https://www.smbc-card.com/nyukai/merit/vpoint_up_program.jsp) | `user_conditions`, `merchant_bonus`, `payment_channel` | `registered` | `unknown` | high / weekly |
| `jp.viewcard.suica-charge` | `T1_CANONICAL` | JR East / View Card | [View Card Mobile Suica charge reward rules](https://www.jreast.co.jp/card/first/viewsuica.html) | `mobile_suica_charge`, `charge_reward`, `payment_interface`, `reward_rate` | `content_verified` | `environment_dependent_or_mixed` | high / weekly |

## Merchant payment and points rules (16)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `merchant.biccamera.store-payment` | `T1_CANONICAL` | Bic Camera | [Bic Camera store payment methods and point rates](https://www.biccamera.com/bc/c/super/okaimono/oshiharai/oshiharai/index.jsp) | `payment_method_rate`, `co_branded_card_bonus` | `registered` | `unknown` | high / weekly |
| `merchant.familymart.famipay` | `T1_CANONICAL` | FamilyMart | [FamilyMart FamiPay and linked point programs](https://www.family.co.jp/famipay.html) | `loyalty_linking`, `base_earn`, `payment_route` | `registered` | `unknown` | high / weekly |
| `merchant.familymart.famipay-points` | `T2_OFFICIAL_SUPPORT` | FamilyMart | [FamilyMart FamiPay point linking guide](https://www.family.co.jp/famipay/app.html) | `point_card_linking`, `presentation_method` | `registered` | `unknown` | high / weekly |
| `merchant.familymart.payment` | `T1_CANONICAL` | FamilyMart | [FamilyMart accepted payment services](https://www.family.co.jp/services/payment.html) | `payment_acceptance`, `point_program_acceptance` | `registered` | `unknown` | high / weekly |
| `merchant.lawson.auto-membership` | `T1_CANONICAL` | Lawson | [Lawson automatic point identification with au PAY and d払い](https://www.lawson.co.jp/lab/tsuushin/art/1459479_4659.html) | `automatic_presentment`, `time_of_day_rate`, `stacking` | `registered` | `unknown` | high / weekly |
| `merchant.lawson.points` | `T1_CANONICAL` | Lawson | [Lawson purchase and payment point stacking](https://www.lawson.co.jp/lab/tsuushin/art/1505668_4659.html) | `point_card_presentment`, `stacking` | `registered` | `unknown` | high / weekly |
| `merchant.lawson.ponta` | `T1_CANONICAL` | Lawson | [Lawson Ponta and d Point rules](https://www.lawson.co.jp/ponta/) | `earn_rules`, `redemption_rules`, `excluded_products` | `registered` | `unknown` | high / weekly |
| `merchant.matsukiyo.store-payment-faq` | `T2_OFFICIAL_SUPPORT` | MatsukiyoCocokara & Co. | [Matsukiyo Cocokara store payment FAQ](https://faq.matsukiyococokara-online.com/kb/article/%E5%BA%97%E8%88%97%E3%81%A7%E5%88%A9%E7%94%A8%E5%8F%AF%E8%83%BD%E3%81%AA%E3%81%8A%E6%94%AF%E6%89%95%E6%96%B9%E6%B3%95%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6/) | `branch_variation`, `payment_acceptance`, `cash_only_items` | `registered` | `unknown` | high / weekly |
| `merchant.mcdonalds.payment` | `T1_CANONICAL` | McDonald's Japan | [McDonald's Japan payment methods by channel](https://www.mcdonalds.co.jp/shop/payment/) | `payment_acceptance`, `channel_scope` | `registered` | `unknown` | high / weekly |
| `merchant.seveneleven.bill-payment` | `T1_CANONICAL` | Seven-Eleven Japan | [Seven-Eleven bill and service payment methods](https://www.sej.co.jp/services/payment/) | `product_category_exclusion`, `payment_acceptance` | `registered` | `unknown` | high / weekly |
| `merchant.seveneleven.nanaco` | `T1_CANONICAL` | Seven-Eleven Japan | [Seven-Eleven nanaco payment rules](https://www.sej.co.jp/services/cash/nanaco.html) | `payment_combination`, `excluded_products`, `charge_limits` | `content_verified` | `manual_capture_candidate` | high / weekly |
| `merchant.seveneleven.payment-faq` | `T1_CANONICAL` | Seven-Eleven Japan | [Seven-Eleven Japan payment FAQ](https://faq.sej.co.jp/article/?knowledge_id=cidqbq4vr0h8m5o3skpg) | `payment_acceptance`, `product_exclusions` | `registered` | `manual_capture_candidate` | high / weekly |
| `merchant.seveneleven.payment-methods` | `T1_CANONICAL` | Seven-Eleven Japan | [Seven-Eleven Japan accepted payment methods](https://www.sej.co.jp/services/cash.html) | `payment_acceptance`, `payment_interface`, `ended_payment_rewards` | `content_verified` | `manual_capture_candidate` | high / weekly |
| `merchant.welcia.faq` | `T2_OFFICIAL_SUPPORT` | Welcia Yakkyoku | [Welcia official FAQ](https://www.welcia-yakkyoku.co.jp/inquire) | `payment_acceptance`, `waon_vpoint_rules` | `registered` | `unknown` | high / weekly |
| `merchant.yodobashi.payment` | `T1_CANONICAL` | Yodobashi Camera | [Yodobashi payment methods](https://www.yodobashi.com/ec/support/beginner/payment/) | `payment_method_rate`, `channel_scope` | `registered` | `unknown` | high / weekly |
| `merchant.zozo.payment` | `T1_CANONICAL` | ZOZO | [ZOZOTOWN payment methods](https://zozo.jp/_help/?id=62b3e9ae27c0cc0022163376) | `payment_acceptance`, `channel_scope` | `registered` | `unknown` | high / weekly |

## Merchant loyalty-program rules (16)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `jp.rakutenmarket.point-campaign-faq` | `T2_OFFICIAL_SUPPORT` | Rakuten Group | [Rakuten Ichiba point and campaign FAQ](https://ichiba.faq.rakuten.net/category/rakuten-point/campaign/) | `spu`, `campaign_caps`, `posting_timing` | `registered` | `unknown` | high / weekly |
| `merchant.amazonjp.partner-dpoint` | `T1_CANONICAL` | Amazon Japan | [Amazon Japan d Point partnership](https://www.amazon.co.jp/gp/help/customer/display.html?nodeId=TpNSQC8WKUSr0kHMib) | `account_linking`, `dpoint_earn`, `eligible_basis` | `registered` | `unknown` | high / weekly |
| `merchant.amazonjp.points-terms` | `T1_CANONICAL` | Amazon Japan | [Amazon Japan Points terms](https://www.amazon.co.jp/gp/help/customer/display.html?nodeId=201998170) | `point_terms`, `posting_timing`, `redemption` | `registered` | `unknown` | high / weekly |
| `merchant.biccamera.points` | `T1_CANONICAL` | Bic Camera | [Bic Camera point guide](https://www.biccamera.com/bc/c/info/point/index.jsp) | `base_earn`, `redemption_value`, `variable_sku_rate` | `registered` | `unknown` | high / weekly |
| `merchant.doutor.rank` | `T1_CANONICAL` | Doutor Coffee | [Doutor Value Card rank-up rules](https://www.doutor.co.jp/dvc/service/rank-up.html) | `annual_spend_tier`, `charge_rate` | `registered` | `unknown` | high / weekly |
| `merchant.doutor.value-card` | `T1_CANONICAL` | Doutor Coffee | [Doutor Value Card](https://www.doutor.co.jp/dvc/) | `charge_rewards`, `purchase_rewards`, `redemption_value` | `registered` | `unknown` | high / weekly |
| `merchant.itoyokado.nanaco-app` | `T1_CANONICAL` | Ito-Yokado | [Ito-Yokado app and nanaco points](https://www.itoyokado.co.jp/spe/chirashi_application/index.html) | `app_points`, `nanaco_linking`, `redemption` | `registered` | `unknown` | high / weekly |
| `merchant.matsukiyo.point-guide` | `T1_CANONICAL` | MatsukiyoCocokara & Co. | [Matsukiyo Cocokara point guide](https://www.matsukiyococokara-online.com/point) | `base_earn`, `tier_rules`, `expiry` | `registered` | `unknown` | high / weekly |
| `merchant.mcdonalds.rewards` | `T1_CANONICAL` | McDonald's Japan | [My McDonald's Rewards](https://www.mcdonalds.co.jp/shop/rewards/) | `loyalty_earn`, `daily_cap`, `expiry` | `registered` | `unknown` | high / weekly |
| `merchant.mcdonalds.rewards-faq` | `T2_OFFICIAL_SUPPORT` | McDonald's Japan | [My McDonald's Rewards FAQ](https://www.mcdonalds.co.jp/shop/rewards/faq/) | `enrollment`, `eligible_basis`, `excluded_items` | `registered` | `unknown` | high / weekly |
| `merchant.starbucks.rewards` | `T1_CANONICAL` | Starbucks Coffee Japan | [Starbucks Rewards Japan](https://www.starbucks.co.jp/rewards/) | `earn_rules`, `payment_route_exclusion`, `redemption` | `registered` | `unknown` | high / weekly |
| `merchant.welcia.home` | `T1_CANONICAL` | Welcia Yakkyoku | [Welcia campaigns and points](https://www.welcia-yakkyoku.co.jp/) | `campaign_discovery`, `waon_vpoint_rules` | `registered` | `unknown` | very_high / daily |
| `merchant.yahoo-shopping.paypay-points` | `T1_CANONICAL` | LY Corporation | [Yahoo Shopping PayPay point earning](https://support.yahoo-net.jp/PccShopping/s/article/H000005843) | `earn_rules`, `posting_timing`, `campaign_attribution` | `registered` | `unknown` | high / weekly |
| `merchant.yahoo-shopping.pending-cap` | `T2_OFFICIAL_SUPPORT` | LY Corporation | [Yahoo PayPay pending points and remaining cap](https://support.yahoo-net.jp/PccPaypay/s/article/H000013239) | `cap_progress`, `pending_points` | `registered` | `unknown` | high / weekly |
| `merchant.yodobashi.points` | `T1_CANONICAL` | Yodobashi Camera | [Yodobashi Gold Point Service](https://www.yodobashi.com/ec/support/member/pointservice/gold/index.html) | `redemption_value`, `program_rules` | `registered` | `unknown` | high / weekly |
| `merchant.zozo.points` | `T1_CANONICAL` | ZOZO | [ZOZOTOWN point usage](https://zozo.jp/_help/?id=671b2cd5f443ae98b41fa0ad) | `redemption_rules`, `fees`, `eligible_items` | `registered` | `unknown` | high / weekly |

## Merchant and participating-store directories (6)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `jp.aupay.merchant-list` | `T2_OFFICIAL_SUPPORT` | KDDI | [au PAY merchant list](https://aupay.wallet.auone.jp/store/list/) | `merchant_acceptance` | `registered` | `unknown` | high / weekly |
| `jp.nanaco.merchant-list` | `T2_OFFICIAL_SUPPORT` | Seven Card Service | [nanaco participating merchants](https://www.nanaco-net.jp/alliance/index.html) | `merchant_acceptance`, `earn_acceptance` | `registered` | `unknown` | high / weekly |
| `jp.paypay.merchant-list` | `T2_OFFICIAL_SUPPORT` | PayPay | [PayPay merchant list](https://paypay.ne.jp/shop/) | `merchant_acceptance` | `registered` | `unknown` | high / weekly |
| `jp.ponta.partner-list` | `T2_OFFICIAL_SUPPORT` | Loyalty Marketing / Recruit | [Ponta participating services](https://point.recruit.co.jp/point/?tab=pointUseService) | `merchant_participation`, `redemption_acceptance` | `registered` | `unknown` | high / weekly |
| `jp.vpoint.store-list` | `T2_OFFICIAL_SUPPORT` | V Point | [V Point participating stores](https://t-point.tsite.jp/store/list/) | `merchant_participation`, `earn_acceptance` | `registered` | `unknown` | high / weekly |
| `jp.vpoint.use-store-list` | `T2_OFFICIAL_SUPPORT` | V Point | [V Point redemption stores](https://t-point.tsite.jp/store/tpointuse/) | `merchant_participation`, `redemption_acceptance` | `registered` | `unknown` | high / weekly |

## Merchant-specific campaign rules (1)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `merchant.itoyokado.happy-day` | `T1_CANONICAL` | Ito-Yokado | [Ito-Yokado Happy Day payment eligibility](https://www.itoyokado.co.jp/special/happyday/) | `discount_eligibility`, `payment_channel_exclusions`, `coupon_requirement` | `registered` | `unknown` | very_high / daily |

## Campaign directories (17)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `jp.aeoncard.campaigns` | `T2_OFFICIAL_SUPPORT` | AEON Financial Service | [AEON Card campaigns](https://www.aeon.co.jp/app/campaign/?pathview=member) | `card_campaigns`, `member_campaigns` | `registered` | `unknown` | very_high / daily |
| `jp.aupay.campaigns` | `T2_OFFICIAL_SUPPORT` | KDDI | [au PAY campaigns](https://aupay.wallet.auone.jp/campaign/) | `campaign_discovery`, `campaign_validity` | `registered` | `unknown` | very_high / daily |
| `jp.aupay.local-campaigns` | `T2_OFFICIAL_SUPPORT` | KDDI | [au PAY local campaigns](https://media.aupay.wallet.auone.jp/dominant/) | `local_campaigns`, `location_scope` | `registered` | `unknown` | very_high / daily |
| `jp.dbarai.campaigns` | `T2_OFFICIAL_SUPPORT` | NTT DOCOMO | [d払い campaigns](https://service.smt.docomo.ne.jp/keitai_payment/campaign/) | `campaign_discovery`, `campaign_validity` | `registered` | `unknown` | very_high / daily |
| `jp.dbarai.local-campaigns` | `T2_OFFICIAL_SUPPORT` | NTT DOCOMO | [d払い local-government and regional campaigns](https://service.smt.docomo.ne.jp/keitai_payment/campaign/dpay_ouen/) | `local_campaigns`, `location_scope` | `registered` | `unknown` | very_high / daily |
| `jp.dcard.campaigns` | `T2_OFFICIAL_SUPPORT` | NTT DOCOMO | [d Card campaigns](https://d-card.jp/st/campaigns/nomember.html) | `card_campaigns`, `welcome_offers` | `registered` | `unknown` | very_high / daily |
| `jp.jrepoint.campaigns` | `T2_OFFICIAL_SUPPORT` | JR East | [JRE POINT campaigns](https://www.jrepoint.jp/campaign/list/) | `campaign_discovery`, `campaign_validity` | `temporarily_unavailable` | `unknown` | very_high / daily |
| `jp.nanaco.campaigns` | `T2_OFFICIAL_SUPPORT` | Seven Card Service | [nanaco campaigns](https://www.nanaco-net.jp/cp/index.html) | `campaign_discovery`, `campaign_validity` | `registered` | `unknown` | very_high / daily |
| `jp.paypay.campaigns` | `T2_OFFICIAL_SUPPORT` | PayPay | [PayPay campaigns](https://paypay.ne.jp/event/) | `campaign_discovery`, `campaign_validity` | `registered` | `unknown` | very_high / daily |
| `jp.paypay.local-campaigns` | `T2_OFFICIAL_SUPPORT` | PayPay | [PayPay local campaigns](https://paypay.ne.jp/event/support-local/) | `local_campaigns`, `location_scope` | `registered` | `unknown` | very_high / daily |
| `jp.paypaycard.campaigns` | `T2_OFFICIAL_SUPPORT` | PayPay Card | [PayPay Card campaigns](https://www.paypay-card.co.jp/event/) | `card_campaigns`, `welcome_offers` | `registered` | `unknown` | very_high / daily |
| `jp.ponta.campaigns` | `T2_OFFICIAL_SUPPORT` | Loyalty Marketing / Recruit | [Ponta campaigns](https://point.recruit.co.jp/point/?tab=campaign) | `campaign_discovery`, `campaign_validity` | `registered` | `unknown` | very_high / daily |
| `jp.rakutencard.campaigns` | `T2_OFFICIAL_SUPPORT` | Rakuten Card | [Rakuten Card campaigns](https://www.rakuten-card.co.jp/campaign/) | `card_campaigns`, `welcome_offers` | `registered` | `unknown` | very_high / daily |
| `jp.rakutenpay.campaigns` | `T2_OFFICIAL_SUPPORT` | Rakuten Payment | [Rakuten Pay campaigns](https://pay.rakuten.co.jp/campaign/) | `campaign_discovery`, `campaign_validity` | `registered` | `unknown` | very_high / daily |
| `jp.smbc.card-campaigns` | `T2_OFFICIAL_SUPPORT` | Sumitomo Mitsui Card | [SMBC card campaign directory](https://www.smbc-card.com/nyukai/campaign/index.jsp) | `card_campaigns`, `welcome_offers` | `registered` | `unknown` | very_high / daily |
| `jp.smbc.member-campaigns` | `T2_OFFICIAL_SUPPORT` | Sumitomo Mitsui Card | [SMBC member campaign directory](https://www.smbc-card.com/memfs/campaign/index.jsp) | `existing_customer_campaigns` | `registered` | `unknown` | very_high / daily |
| `jp.vpoint.campaigns` | `T2_OFFICIAL_SUPPORT` | V Point | [V Point campaigns](https://cpn.tsite.jp/list/all) | `campaign_discovery`, `campaign_validity` | `registered` | `unknown` | very_high / daily |

## Campaign terms (4)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `jp.aeonpay.campaign-channel-example` | `T1_CANONICAL` | AEON Financial Service | [AEON campaign with code-pay and WAON touch distinctions](https://www.aeon.co.jp/campaign/member/202607-20/) | `payment_channel_exclusion`, `campaign_validity` | `registered` | `unknown` | very_high / daily |
| `jp.dpoint.campaign-example-funding-exclusion` | `T1_CANONICAL` | NTT DOCOMO | [Official d POINT campaign with funding and channel exclusions](https://dpoint.docomo.ne.jp/cp_2/section/poincosquare/pacelacp_2606/index.html) | `funding_source_exclusion`, `mobile_order_exclusion`, `entry_requirement` | `registered` | `unknown` | very_high / daily |
| `jp.jal.multi-point-campaign-2026` | `T1_CANONICAL` | Japan Airlines | [JAL multi-card point transfer campaign](https://partner.jal.co.jp/jmb/partner/ecp01_bonus_mile2026/) | `conversion_bonus`, `partner_specific_deadlines` | `registered` | `unknown` | very_high / daily |
| `jp.jal.ponta-campaign-2026` | `T1_CANONICAL` | Japan Airlines | [JAL Ponta mileage conversion campaign](https://www.jal.co.jp/jp/ja/121campaign/2026/ponta-mile/) | `conversion_bonus`, `entry_deadline`, `validity` | `registered` | `unknown` | very_high / daily |

## Campaign archives (1)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `jp.dbarai.ended-campaigns` | `T2_OFFICIAL_SUPPORT` | NTT DOCOMO | [d払い ended campaigns](https://service.smt.docomo.ne.jp/keitai_payment/campaign/closed/finish.html) | `historical_campaigns`, `expiry_validation` | `registered` | `unknown` | high / weekly |

## Effective-date and change notices (1)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `jp.rakutenpay.change-notice-2026` | `T1_CANONICAL` | Rakuten Payment | [Rakuten Pay point-program change notice](https://pay.rakuten.co.jp/topics/pointprogram/info/2026/0115/) | `announced_change`, `effective_date_change` | `registered` | `unknown` | high / weekly |

## Point, mile, hotel, and cashback transfer rules (11)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `global.accor.jal-transfer` | `T1_CANONICAL` | Accor | [ALL Accor to JAL conversion](https://all.accor.com/loyalty-program/partners/use/japanairlines/index.en.shtml) | `conversion_ratio`, `identity_match`, `processing_time` | `registered` | `unknown` | high / weekly |
| `global.accor.partners` | `T1_CANONICAL` | Accor | [ALL Accor partner directory](https://all.accor.com/loyalty-program/partners/index.en.shtml) | `transfer_partners`, `conversion_routes` | `registered` | `unknown` | high / weekly |
| `global.hyatt.airline-transfer` | `T1_CANONICAL` | Hyatt | [World of Hyatt airline transfer partners](https://world.hyatt.com/content/gp/en/rewards/air-auto.html) | `conversion_ratio`, `minimum_transfer`, `bonus_threshold` | `registered` | `unknown` | high / weekly |
| `jp.ana.partner-points` | `T1_CANONICAL` | ANA | [ANA partner point exchange directory](https://www.ana.co.jp/ja/jp/shoppingandlife/point/) | `transfer_partners`, `conversion_routes` | `registered` | `unknown` | high / weekly |
| `jp.ana.rakuten-transfer` | `T1_CANONICAL` | ANA | [Rakuten Point and ANA miles](https://www.ana.co.jp/ja/jp/shoppingandlife/point/tameru_rakutenpoint/) | `conversion_ratio`, `transfer_conditions` | `registered` | `unknown` | high / weekly |
| `jp.ana.vpoint-transfer` | `T1_CANONICAL` | ANA | [V Point and ANA miles](https://www.ana.co.jp/ja/jp/shoppingandlife/point/tukau_tpoint/) | `conversion_ratio`, `transfer_conditions` | `registered` | `unknown` | high / weekly |
| `jp.jal.ponta-benefit` | `T1_CANONICAL` | Japan Airlines | [JAL and Ponta partner benefit](https://www.jal.co.jp/jp/ja/jalmile/use/partner/ponta/) | `conversion_ratio`, `eligibility` | `registered` | `unknown` | high / weekly |
| `jp.jal.ponta-portal` | `T1_CANONICAL` | Japan Airlines | [JMB x Ponta registration and overview](https://www.jal.co.jp/jp/ja/jmb/ponta/portal/) | `account_linking`, `eligibility` | `registered` | `unknown` | medium / monthly |
| `jp.moppy.exchange` | `T1_CANONICAL` | Ceres | [Moppy point exchange](https://pc.moppy.jp/cashback/) | `conversion_routes`, `fees`, `minimums` | `registered` | `unknown` | high / weekly |
| `jp.ponta.exchange-hub` | `T1_CANONICAL` | Loyalty Marketing / Recruit | [Ponta point exchange hub](https://point.recruit.co.jp/point/?tab=excPoint) | `transfer_partners`, `conversion_routes` | `registered` | `unknown` | high / weekly |
| `jp.ponta.jal-transfer` | `T1_CANONICAL` | Loyalty Marketing / Recruit | [Ponta to JAL transfer](https://point.recruit.co.jp/pontaweb/excpoint/pontajal/) | `conversion_ratio`, `minimum_transfer`, `eligibility` | `registered` | `unknown` | high / weekly |

## Cashback and point portals (11)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `global.rakuten-us.shopping-trip` | `T2_OFFICIAL_SUPPORT` | Rakuten Rewards | [Rakuten Shopping Trip tracking](https://www.rakuten.com/help/article/what-is-a-rakuten-shopping-trip-360002100588) | `attribution_window`, `tracking_requirements` | `registered` | `unknown` | high / weekly |
| `global.rakuten-us.terms` | `T1_CANONICAL` | Rakuten Rewards | [Rakuten US terms and cashback rules](https://www.rakuten.com/help/article/terms-conditions) | `cashback_terms`, `attribution_rules` | `registered` | `unknown` | high / weekly |
| `global.shopback.how-it-works` | `T1_CANONICAL` | ShopBack | [ShopBack how it works](https://www.shopback.com/how-shopback-works) | `cashback_process`, `tracking_requirements` | `registered` | `unknown` | high / weekly |
| `global.topcashback.extension` | `T2_OFFICIAL_SUPPORT` | TopCashback | [TopCashback browser extension](https://www.topcashback.com/help/browser-extension/) | `tracking_method`, `browser_workflow` | `registered` | `unknown` | medium / monthly |
| `global.topcashback.guarantee` | `T1_CANONICAL` | TopCashback | [TopCashback rate guarantee](https://www.topcashback.com/help/highest-cash-back-guarantee/) | `rate_policy`, `merchant_rates` | `registered` | `unknown` | high / weekly |
| `jp.ana.mileage-mall` | `T1_CANONICAL` | ANA / ANA X | [ANA Mileage Mall](https://mileagemall.ana.co.jp/) | `portal_rates`, `merchant_terms`, `attribution_rules` | `registered` | `unknown` | very_high / daily |
| `jp.hapitas.home` | `T1_CANONICAL` | Ozvision | [Hapitas offers](https://hapitas.jp/) | `merchant_rates`, `campaigns` | `registered` | `unknown` | very_high / daily |
| `jp.jal.mileage-park` | `T1_CANONICAL` | Japan Airlines | [JAL Mileage Park](https://partner.jal.co.jp/) | `portal_rates`, `merchant_terms`, `attribution_rules` | `registered` | `unknown` | very_high / daily |
| `jp.moppy.home` | `T1_CANONICAL` | Ceres | [Moppy offers](https://pc.moppy.jp/) | `merchant_rates`, `campaigns` | `registered` | `unknown` | very_high / daily |
| `jp.rebates.guide` | `T1_CANONICAL` | Rakuten Group | [Rakuten Rebates guide](https://www.rebates.jp/static/guide) | `attribution_rules`, `cashback_process` | `registered` | `unknown` | high / weekly |
| `jp.rebates.store-list` | `T1_CANONICAL` | Rakuten Group | [Rakuten Rebates store list](https://www.rebates.jp/stores) | `merchant_rates`, `merchant_terms` | `registered` | `unknown` | very_high / daily |

## Research A canonical page additions (32)

These page-level records bind the bounded P0 point-rules research artifact. Existing canonical IDs are reused where the page URL already has a registry identity; these 32 entries cover the remaining official locators. JRE direct locators that returned HTTP 403 remain `temporarily_unavailable` while their source identities are retained.

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `jp.dpoint.campaigns` | `T2_OFFICIAL_SUPPORT` | NTT DOCOMO | [d POINT campaign directory](https://dpoint.docomo.ne.jp/campaign/) | `campaign_discovery`, `campaign_validity` | `registered` | `unknown` | very_high / daily |
| `jp.dpoint.earn-mobile` | `T1_CANONICAL` | NTT DOCOMO | [d POINT mobile-service earning rules](https://dpoint.docomo.ne.jp/acc/mobile_use/index.html) | `earn_rules`, `eligible_basis` | `registered` | `unknown` | high / weekly |
| `jp.dpoint.info` | `T2_OFFICIAL_SUPPORT` | NTT DOCOMO | [d POINT notices](https://dpoint.docomo.ne.jp/info/index.html) | `service_changes`, `operational_notices` | `registered` | `unknown` | high / weekly |
| `jp.dpoint.merchant-list` | `T2_OFFICIAL_SUPPORT` | NTT DOCOMO | [d POINT participating-store directory](https://dpoint.docomo.ne.jp/store/index.html) | `merchant_acceptance`, `earn_acceptance` | `registered` | `unknown` | high / weekly |
| `jp.dpoint.terms-20260701` | `T1_CANONICAL` | NTT DOCOMO | [d POINT Club member terms effective 2026-07-01](https://dpoint.docomo.ne.jp/instruction/pdf/d_point_club_kiyaku_20260701.pdf) | `program_terms`, `earn_rules`, `expiry_rules`, `transfer_rules`, `redemption_rules` | `registered` | `unknown` | medium / monthly |
| `jp.dpoint.transfer` | `T2_OFFICIAL_SUPPORT` | NTT DOCOMO | [d POINT exchange directory](https://dpoint.docomo.ne.jp/store/exchange/index.html) | `transfer_partners`, `conversion_routes` | `registered` | `unknown` | high / weekly |
| `jp.dpoint.use-limited-faq` | `T2_OFFICIAL_SUPPORT` | NTT DOCOMO | [d POINT limited-use points FAQ](https://dpoint.docomo.ne.jp/guide/faq/Point/Dpoint04.html) | `expiry_rules`, `redemption_priority` | `registered` | `unknown` | high / weekly |
| `jp.dpoint.use-rate-faq` | `T2_OFFICIAL_SUPPORT` | NTT DOCOMO | [d POINT redemption-value FAQ](https://dpoint.docomo.ne.jp/static/guide/faq/Point/Dpoint07/) | `redemption_value`, `redemption_rules` | `registered` | `unknown` | high / weekly |
| `jp.dpoint.earn-timing-faq` | `T2_OFFICIAL_SUPPORT` | NTT DOCOMO | [d POINT earning-timing FAQ](https://dpoint.docomo.ne.jp/guide/faq/Point/Dpoint26.html) | `posting_timing`, `earn_rules` | `registered` | `unknown` | high / weekly |
| `jp.dpoint.use-guide` | `T2_OFFICIAL_SUPPORT` | NTT DOCOMO | [d POINT redemption guide](https://dpoint.docomo.ne.jp/guide/howto_use/index.html) | `redemption_rules`, `redemption_routes` | `registered` | `unknown` | high / weekly |
| `jp.jrepoint.expiry-faq` | `T2_OFFICIAL_SUPPORT` | JR East | [JRE POINT expiry FAQ](https://faq.jrepoint.jp/faq/show/29?site_domain=default) | `expiry_rules`, `reward_classes` | `registered` | `unknown` | medium / monthly |
| `jp.jrepoint.family-transfer-faq` | `T2_OFFICIAL_SUPPORT` | JR East | [JRE POINT family-transfer FAQ](https://faq.jrepoint.jp/faq/show/474?site_domain=default) | `transfer_eligibility`, `transfer_rules` | `registered` | `unknown` | high / weekly |
| `jp.jrepoint.info` | `T2_OFFICIAL_SUPPORT` | JR East | [JRE POINT notices](https://www.jrepoint.jp/information/list/) | `service_changes`, `operational_notices` | `registered` | `unknown` | high / weekly |
| `jp.jrepoint.merchant-card` | `T2_OFFICIAL_SUPPORT` | JR East | [JRE POINT card/barcode merchant earning page](https://www.jrepoint.jp/point/append/jrepoint-card/) | `merchant_acceptance`, `earn_rules` | `temporarily_unavailable` | `unknown` | high / weekly |
| `jp.jrepoint.overview` | `T2_OFFICIAL_SUPPORT` | JR East | [JRE POINT overview](https://www.jrepoint.jp/point/first/) | `program_overview`, `merchant_acceptance`, `redemption_rules` | `registered` | `unknown` | high / weekly |
| `jp.jrepoint.suica-info` | `T1_CANONICAL` | JR East | [JRE POINT Suica benefits](https://www.jrepoint.jp/information/suica/) | `earn_rules`, `suica_registration`, `redemption_value` | `registered` | `unknown` | high / weekly |
| `jp.jrepoint.transfer-terms` | `T1_CANONICAL` | JR East | [JRE POINT exchange special terms](https://www.jrepoint.jp/agreement/jrepoint/) | `program_terms`, `transfer_rules`, `conversion_routes` | `temporarily_unavailable` | `unknown` | medium / monthly |
| `jp.jrepoint.use-faq` | `T2_OFFICIAL_SUPPORT` | JR East | [JRE POINT use FAQ](https://faq.jrepoint.jp/faq/show/2724?category_id=115&site_domain=default) | `redemption_rules`, `redemption_routes` | `registered` | `unknown` | high / weekly |
| `jp.nanaco.expiry-confirm` | `T2_OFFICIAL_SUPPORT` | Seven Card Service | [nanaco balance and expiry confirmation](https://www.nanaco-net.jp/how-to/menu/confirm.html) | `expiry_rules`, `redemption_priority` | `registered` | `unknown` | medium / monthly |
| `jp.nanaco.info-app-end` | `T2_OFFICIAL_SUPPORT` | Seven Card Service | [nanaco app and online-service change notice](https://www.nanaco-net.jp/information/info_00099.html) | `service_changes`, `effective_date` | `registered` | `unknown` | high / weekly |
| `jp.nanaco.info` | `T2_OFFICIAL_SUPPORT` | Seven Card Service | [nanaco notices](https://www.nanaco-net.jp/information/index.html) | `service_changes`, `operational_notices` | `registered` | `unknown` | high / weekly |
| `jp.nanaco.info-saison-end` | `T2_OFFICIAL_SUPPORT` | Seven Card Service | [nanaco Saison/UC earning-end notice](https://www.nanaco-net.jp/information/info_00093.html) | `service_changes`, `effective_date` | `registered` | `unknown` | high / weekly |
| `jp.nanaco.info-vworld-end` | `T2_OFFICIAL_SUPPORT` | Seven Card Service | [nanaco V Point/World Point exchange-end notice](https://www.nanaco-net.jp/information/info_00084.html) | `service_changes`, `effective_date` | `registered` | `unknown` | high / weekly |
| `jp.nanaco.terms` | `T1_CANONICAL` | Seven Card Service | [nanaco terms index](https://www.nanaco-net.jp/terms/) | `program_terms`, `earn_rules`, `redemption_rules` | `registered` | `unknown` | medium / monthly |
| `jp.nanaco.terms-points` | `T1_CANONICAL` | Seven Card Service | [nanaco member terms and point-service special terms](https://entry.nanaco-net.jp/entry_all/kiyaku.html) | `program_terms`, `expiry_rules`, `redemption_rules` | `registered` | `unknown` | medium / monthly |
| `jp.nanaco.transfer-ana` | `T1_CANONICAL` | Seven Card Service | [nanaco to ANA miles exchange rules](https://www.nanaco-net.jp/how-to/use_point/ana.html) | `transfer_partners`, `conversion_routes`, `eligibility` | `registered` | `unknown` | high / weekly |
| `jp.nanaco.use` | `T2_OFFICIAL_SUPPORT` | Seven Card Service | [nanaco point use guide](https://www.nanaco-net.jp/how-to/use_point/index.html) | `redemption_rules`, `redemption_routes` | `registered` | `unknown` | high / weekly |
| `jp.nanaco.net-faq` | `T2_OFFICIAL_SUPPORT` | Seven Card Service | [nanaco online-shopping points FAQ](https://www.nanaco-net.jp/support/faq_net.html) | `earn_rules`, `redemption_rules` | `registered` | `unknown` | high / weekly |
| `jp.paypay.balance-points` | `T2_OFFICIAL_SUPPORT` | PayPay | [PayPay balance and points FAQ](https://paypay.ne.jp/help/c0048/) | `balance_types`, `expiry_rules`, `transfer_rules` | `registered` | `unknown` | high / weekly |
| `jp.paypay.points` | `T1_CANONICAL` | PayPay | [PayPay points rules](https://paypay.ne.jp/point/) | `point_types`, `expiry_rules`, `transfer_rules`, `redemption_rules`, `redemption_value` | `registered` | `unknown` | high / weekly |
| `jp.paypay.points-use` | `T2_OFFICIAL_SUPPORT` | PayPay | [PayPay points use guide](https://paypay.ne.jp/guide/point-use/) | `redemption_rules`, `redemption_routes`, `redemption_value` | `registered` | `unknown` | high / weekly |
| `jp.paypay.terms` | `T1_CANONICAL` | PayPay | [PayPay consumer terms](https://about.paypay.ne.jp/terms/consumer/rule/) | `program_terms`, `transfer_rules`, `redemption_rules` | `registered` | `unknown` | medium / monthly |

## Discovery-only change detectors (1)

| ID | Tier | Publisher | Source | Authority scope | Verification | Technical access | Volatility / cadence |
|---|---|---|---|---|---|---|---|
| `discovery.cashbackmonitor` | `T4_DISCOVERY_ONLY` | Cashback Monitor | [Cashback Monitor comparison index](https://www.cashbackmonitor.com/) | `portal_discovery` | `registered` | `unknown` | very_high / daily |
