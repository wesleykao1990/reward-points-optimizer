-- Official-source baseline payment/reward facts for the five golden commerce surfaces.
begin;

with rows(fact_key,surface_key,instrument_key,action,state,split_mode,source_key,confidence,applicability) as (values
('caf_amazon_credit_card','commerce.amazon.co.jp','instrument.payment.credit-card','pay','yes','supported','commerce.amazon-jp.payment-guide',0.98,'{"order_restrictions_possible":true}'),
('caf_amazon_paypay','commerce.amazon.co.jp','instrument.wallet.paypay','pay','yes','supported','commerce.amazon-jp.payment-guide',0.99,'{"funding":"PayPay balance or points","order_restrictions_possible":true}'),
('caf_amazon_merpay','commerce.amazon.co.jp','instrument.wallet.merpay','pay','yes','supported','commerce.amazon-jp.payment-guide',0.99,'{"can_combine_with":["Amazon Points","Amazon Gift Card"]}'),
('caf_amazon_paidy','commerce.amazon.co.jp','instrument.payment.paidy','pay','yes','unknown','commerce.amazon-jp.payment-guide',0.99,'{}'),
('caf_amazon_carrier','commerce.amazon.co.jp','instrument.payment.carrier-billing','pay','yes','unknown','commerce.amazon-jp.payment-guide',0.98,'{}'),
('caf_amazon_convenience','commerce.amazon.co.jp','instrument.payment.convenience-store','pay','yes','unknown','commerce.amazon-jp.payment-guide',0.98,'{}'),
('caf_amazon_netbank_atm','commerce.amazon.co.jp','instrument.payment.netbank-atm','pay','yes','unknown','commerce.amazon-jp.payment-guide',0.97,'{}'),
('caf_amazon_gift_redeem','commerce.amazon.co.jp','instrument.value.amazon-gift-card','redeem','yes','supported','commerce.amazon-jp.payment-guide',0.99,'{}'),
('caf_amazon_points_redeem','commerce.amazon.co.jp','program.jp.amazonpoint','redeem','yes','supported','commerce.amazon-jp.payment-guide',0.98,'{}'),

('caf_rakuten_credit_card','commerce.rakuten.ichiba.jp','instrument.payment.credit-card','pay','yes','unknown','commerce.rakuten-ichiba.payment-help',0.98,'{"shop_or_product_may_restrict":true}'),
('caf_rakuten_bank_transfer','commerce.rakuten.ichiba.jp','instrument.payment.bank-transfer','pay','yes','unknown','commerce.rakuten-ichiba.payment-help',0.98,'{"shop_or_product_may_restrict":true}'),
('caf_rakuten_postpay','commerce.rakuten.ichiba.jp','instrument.payment.postpay','pay','yes','unknown','commerce.rakuten-ichiba.payment-help',0.98,'{"shop_or_product_may_restrict":true}'),
('caf_rakuten_applepay','commerce.rakuten.ichiba.jp','instrument.wallet.applepay','pay','yes','unknown','commerce.rakuten-ichiba.payment-help',0.98,'{"shop_or_product_may_restrict":true}'),
('caf_rakuten_convenience','commerce.rakuten.ichiba.jp','instrument.payment.convenience-store','pay','yes','unknown','commerce.rakuten-ichiba.payment-help',0.98,'{"shop_or_product_may_restrict":true}'),
('caf_rakuten_paypal','commerce.rakuten.ichiba.jp','instrument.payment.paypal','pay','yes','unknown','commerce.rakuten-ichiba.payment-help',0.98,'{"shop_or_product_may_restrict":true}'),
('caf_rakuten_points_redeem','commerce.rakuten.ichiba.jp','program.jp.rakutenpoint','redeem','yes','supported','commerce.rakuten-ichiba.payment-help',0.95,'{"order_context_dependent":true}'),

('caf_yahoo_credit_card','commerce.yahoo.shopping.jp','instrument.payment.credit-card','pay','yes','unknown','commerce.yahoo-shopping.payment-help',0.99,'{"store_or_product_may_restrict":true}'),
('caf_yahoo_debit_card','commerce.yahoo.shopping.jp','instrument.payment.debit-card','pay','yes','unknown','commerce.yahoo-shopping.payment-help',0.98,'{"store_or_product_may_restrict":true}'),
('caf_yahoo_paypay','commerce.yahoo.shopping.jp','instrument.wallet.paypay','pay','yes','supported','commerce.yahoo-shopping.payment-help',0.99,'{"store_or_product_may_restrict":true}'),
('caf_yahoo_postpay','commerce.yahoo.shopping.jp','instrument.payment.postpay','pay','yes','unknown','commerce.yahoo-shopping.payment-help',0.98,'{"brand":"ゆっくり払い","store_or_product_may_restrict":true}'),
('caf_yahoo_cod','commerce.yahoo.shopping.jp','instrument.payment.cash-on-delivery','pay','yes','unknown','commerce.yahoo-shopping.payment-help',0.97,'{"store_or_product_may_restrict":true}'),
('caf_yahoo_carrier','commerce.yahoo.shopping.jp','instrument.payment.carrier-billing','pay','yes','unknown','commerce.yahoo-shopping.payment-help',0.98,'{"store_or_product_may_restrict":true}'),
('caf_yahoo_convenience','commerce.yahoo.shopping.jp','instrument.payment.convenience-store','pay','yes','unknown','commerce.yahoo-shopping.payment-help',0.98,'{"store_or_product_may_restrict":true}'),
('caf_yahoo_payeasy','commerce.yahoo.shopping.jp','instrument.payment.pay-easy','pay','yes','unknown','commerce.yahoo-shopping.payment-help',0.98,'{"store_or_product_may_restrict":true}'),
('caf_yahoo_voucher','commerce.yahoo.shopping.jp','instrument.value.yahoo-shopping-voucher','redeem','yes','supported','commerce.yahoo-shopping.payment-help',0.99,'{"store_or_product_may_restrict":true}'),
('caf_yahoo_vpoint_no','commerce.yahoo.shopping.jp','program.jp.vpoint','redeem','no','none','commerce.yahoo-shopping.payment-help',0.99,'{"explicit_official_exclusion":true}'),

('caf_bic_credit_card','commerce.biccamera.com','instrument.payment.credit-card','pay','yes','supported','commerce.biccamera-web.payment-list',0.99,'{}'),
('caf_bic_paypay','commerce.biccamera.com','instrument.wallet.paypay','pay','yes','unknown','commerce.biccamera-web.payment-list',0.99,'{"browser_constraints_possible":true}'),
('caf_bic_rakutenpay','commerce.biccamera.com','instrument.wallet.rakutenpay','pay','yes','unknown','commerce.biccamera-web.payment-list',0.99,'{"browser_constraints_possible":true}'),
('caf_bic_dbarai','commerce.biccamera.com','instrument.wallet.dbarai','pay','yes','unknown','commerce.biccamera-web.payment-list',0.99,'{"browser_constraints_possible":true}'),
('caf_bic_aupay','commerce.biccamera.com','instrument.wallet.aupay','pay','yes','unknown','commerce.biccamera-web.payment-list',0.99,'{"browser_constraints_possible":true}'),
('caf_bic_merpay','commerce.biccamera.com','instrument.wallet.merpay','pay','yes','unknown','commerce.biccamera-web.payment-list',0.99,'{"browser_constraints_possible":true}'),
('caf_bic_paidy','commerce.biccamera.com','instrument.payment.paidy','pay','yes','unknown','commerce.biccamera-web.payment-list',0.99,'{}'),
('caf_bic_bank','commerce.biccamera.com','instrument.payment.bank-transfer','pay','yes','unknown','commerce.biccamera-web.payment-list',0.99,'{}'),
('caf_bic_postal','commerce.biccamera.com','instrument.payment.postal-transfer','pay','yes','unknown','commerce.biccamera-web.payment-list',0.99,'{}'),
('caf_bic_convenience','commerce.biccamera.com','instrument.payment.convenience-store','pay','yes','unknown','commerce.biccamera-web.payment-list',0.99,'{}'),
('caf_bic_netbank_atm','commerce.biccamera.com','instrument.payment.netbank-atm','pay','yes','unknown','commerce.biccamera-web.payment-list',0.99,'{}'),
('caf_bic_bitcoin','commerce.biccamera.com','instrument.payment.bitcoin','pay','yes','unknown','commerce.biccamera-web.payment-list',0.99,'{}'),
('caf_bic_cod','commerce.biccamera.com','instrument.payment.cash-on-delivery','pay','yes','unknown','commerce.biccamera-web.payment-list',0.99,'{}'),
('caf_bic_shopping_loan','commerce.biccamera.com','instrument.payment.shopping-loan','pay','yes','unknown','commerce.biccamera-web.payment-list',0.99,'{}'),
('caf_bic_gift_redeem','commerce.biccamera.com','instrument.value.biccamera-gift-card','redeem','yes','supported','commerce.biccamera-web.payment-list',0.99,'{}'),
('caf_bic_point_redeem','commerce.biccamera.com','program.jp.bicpoint','redeem','yes','supported','commerce.biccamera-web.point-guide',0.99,'{"value_jpy_per_point":1}'),
('caf_bic_point_earn','commerce.biccamera.com','program.jp.bicpoint','earn','yes','unknown','commerce.biccamera-web.point-guide',0.99,'{"rate_varies_by_product":true}'),

('caf_zozo_credit_card','commerce.zozotown.jp','instrument.payment.credit-card','pay','yes','supported','commerce.zozotown.help',0.99,'{}'),
('caf_zozo_debit_card','commerce.zozotown.jp','instrument.payment.debit-card','pay','yes','unknown','commerce.zozotown.help',0.98,'{}'),
('caf_zozo_paypay','commerce.zozotown.jp','instrument.wallet.paypay','pay','yes','supported','commerce.zozotown.paypay',0.99,'{"some_items_excluded":true,"id_link_required_for_members":true}'),
('caf_zozo_cod','commerce.zozotown.jp','instrument.payment.cash-on-delivery','pay','yes','unknown','commerce.zozotown.help',0.98,'{}'),
('caf_zozo_convenience','commerce.zozotown.jp','instrument.payment.convenience-store','pay','yes','unknown','commerce.zozotown.help',0.98,'{}'),
('caf_zozo_postpay','commerce.zozotown.jp','instrument.payment.postpay','pay','yes','unknown','commerce.zozotown.help',0.98,'{"brands":["GMO後払い","ツケ払い"]}'),
('caf_zozo_point_redeem','commerce.zozotown.jp','program.jp.zozopoint','redeem','yes','supported','commerce.zozotown.help',0.98,'{}'),
('caf_zozo_zozocard','commerce.zozotown.jp','instrument.payment.zozocard','pay','yes','supported','commerce.zozotown.zozocard',0.99,'{}')
)
insert into app_private.commerce_acceptance_facts (fact_key,surface_id,context_id,instrument_entity_id,action,acceptance_state,split_tender_mode,amount_constraint,applicability,trusted_source_id,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select r.fact_key,s.id,c.id,e.id,r.action,r.state,r.split_mode,'{}'::jsonb,r.applicability::jsonb,ts.id,'official_platform_help',r.source_key,ts.source_url,timestamptz '2026-08-26 00:00:00+09',r.confidence,jsonb_build_object('seed','golden_site_v1','source_authority','official'),'active'
from rows r
join app_private.commerce_surfaces s on s.surface_key=r.surface_key
join app_private.commerce_contexts c on c.surface_id=s.id and c.context_type='surface_default' and c.status='active'
join app_private.entities e on e.entity_key=r.instrument_key
join app_private.trusted_sources ts on ts.source_key=r.source_key
on conflict (fact_key) do nothing;

with rows(fact_key,surface_key,program_key,instrument_key,component_kind,value_model,amount_basis,rankability,stacking_mode,choice_group,eligibility,source_key,confidence) as (values
('crf_amazon_points_dynamic','commerce.amazon.co.jp','program.jp.amazonpoint',null,'merchant_loyalty','{"type":"dynamic_by_item_or_order","rate_fixed":false,"optimizer_requires_resolved_offer":true}','eligible_item_subtotal','conditional','additive',null,'{"payment_method_independent_unless_order_terms_say_otherwise":true}','commerce.amazon-jp.payment-guide',0.92),
('crf_amazon_paypay_external','commerce.amazon.co.jp','program.jp.paypaypoint','instrument.wallet.paypay','payment_wallet_reward','{"type":"external_program_variable","rate_fixed_here":false,"optimizer_requires_paypay_rule":true}','instrument_paid_portion','conditional','additive',null,'{"amazon_points_can_also_be_earned":true}','commerce.amazon-jp.payment-guide',0.94),
('crf_rakuten_base_1pct','commerce.rakuten.ichiba.jp','program.jp.rakutenpoint',null,'marketplace_reward','{"type":"rate_percent","rate_percent":1}','eligible_item_subtotal','rankable','additive',null,'{"regular_purchase_base":true,"item_or_shop_multiplier_can_override_or_multiply":true}','commerce.rakuten-ichiba.item-search-api',0.99),
('crf_rakuten_point_rate_template','commerce.rakuten.ichiba.jp','program.jp.rakutenpoint',null,'marketplace_reward','{"type":"official_api_field","field":"pointRate","unit":"multiplier","start_field":"pointRateStartTime","end_field":"pointRateEndTime","resolver_keys":["shopCode","itemCode"],"applies_to":"crf_rakuten_base_1pct"}','eligible_item_subtotal','conditional','conditional',null,'{"exact_offer_resolution_required":true}','commerce.rakuten-ichiba.item-search-api',0.99),
('crf_bic_basic_point','commerce.biccamera.com','program.jp.bicpoint',null,'merchant_loyalty','{"type":"default_rate_percent","rate_percent":10,"dynamic_override_required":true}','eligible_item_subtotal','conditional','additive',null,'{"official_note":"point rate may change or vary","product_override_wins":true}','commerce.biccamera-web.point-guide',0.99),
('crf_zozo_zozocard_5pct','commerce.zozotown.jp','program.jp.zozopoint','instrument.payment.zozocard','funding_card_reward','{"type":"rate_percent","rate_percent":5}','post_discount_tax_exclusive','rankable','conditional',null,'{"excluded_amounts":["coupon","ZOZO Points","other discounts","PayPay-paid portion"],"excluded_items_possible":true}','commerce.zozotown.zozocard',0.99),
('crf_zozo_paypay_range','commerce.zozotown.jp','program.jp.paypaypoint','instrument.wallet.paypay','payment_wallet_reward','{"type":"rate_percent_range","min_rate_percent":0.5,"max_rate_percent":1.0,"depends_on":"PayPay Step"}','instrument_paid_portion','conditional','additive',null,'{"ekyc_required_from":"2026-06-02","paypay_point_paid_amount_excluded":true,"some_items_excluded":true}','commerce.zozotown.paypay',0.99)
)
insert into app_private.commerce_reward_facts (fact_key,surface_id,context_id,loyalty_program_entity_id,payment_instrument_entity_id,component_kind,value_model,amount_basis,rankability,stacking_mode,choice_group,eligibility,cap_model,rounding_mode,trusted_source_id,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select r.fact_key,s.id,c.id,lp.id,pi.id,r.component_kind,r.value_model::jsonb,r.amount_basis,r.rankability,r.stacking_mode,r.choice_group,r.eligibility::jsonb,'{}'::jsonb,'unknown',ts.id,
case when r.source_key='commerce.rakuten-ichiba.item-search-api' then 'official_api' when r.source_key='commerce.zozotown.zozocard' then 'official_card_issuer' else 'official_platform_help' end,
r.source_key,ts.source_url,timestamptz '2026-08-26 00:00:00+09',r.confidence,jsonb_build_object('seed','golden_site_v1','source_authority','official'),'active'
from rows r
join app_private.commerce_surfaces s on s.surface_key=r.surface_key
join app_private.commerce_contexts c on c.surface_id=s.id and c.context_type='surface_default' and c.status='active'
left join app_private.entities lp on lp.entity_key=r.program_key
left join app_private.entities pi on pi.entity_key=r.instrument_key
join app_private.trusted_sources ts on ts.source_key=r.source_key
on conflict (fact_key) do nothing;

commit;
