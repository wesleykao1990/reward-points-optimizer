-- Staged from db/0047_online_commerce_golden_backfill.sql; edit the canonical source, not this file.
-- Make the five-site online-commerce golden dataset self-contained on a clean database.
-- Earlier hosted environments already had these entities; all statements are idempotent.
begin;

insert into app_private.entities
  (entity_key, entity_type, display_name, legal_name, locale, metadata, status)
values
  ('merchant.biccamera','merchant','Bic Camera','Bic Camera Inc.','ja-JP','{"country":"JP","category":"electronics_retail","commerce_seed":"golden"}'::jsonb,'active'),
  ('instrument.wallet.paypay','qr_wallet','PayPay',null,'ja-JP','{"commerce_dependency":true}'::jsonb,'active'),
  ('instrument.wallet.merpay','qr_wallet','Merpay',null,'ja-JP','{"commerce_dependency":true}'::jsonb,'active'),
  ('instrument.wallet.applepay','payment_interface','Apple Pay',null,'ja-JP','{"commerce_dependency":true}'::jsonb,'active'),
  ('instrument.wallet.rakutenpay','qr_wallet','Rakuten Pay',null,'ja-JP','{"commerce_dependency":true}'::jsonb,'active'),
  ('instrument.wallet.dbarai','qr_wallet','d払い',null,'ja-JP','{"commerce_dependency":true}'::jsonb,'active'),
  ('instrument.wallet.aupay','qr_wallet','au PAY',null,'ja-JP','{"commerce_dependency":true}'::jsonb,'active'),
  ('program.jp.rakutenpoint','loyalty_program','Rakuten Point',null,'ja-JP','{"commerce_dependency":true}'::jsonb,'active'),
  ('program.jp.vpoint','loyalty_program','V Point',null,'ja-JP','{"commerce_dependency":true}'::jsonb,'active'),
  ('program.jp.bicpoint','loyalty_program','Bic Point',null,'ja-JP','{"value_jpy_per_point":1,"commerce_dependency":true}'::jsonb,'active'),
  ('program.jp.paypaypoint','loyalty_program','PayPay Points',null,'ja-JP','{"commerce_dependency":true}'::jsonb,'active')
on conflict (entity_key) do nothing;


insert into app_private.entities (entity_key, entity_type, display_name, legal_name, locale, metadata, status) values
('merchant.amazon-jp','merchant','Amazon.co.jp','Amazon Japan G.K.','ja-JP','{"country":"JP","category":"marketplace","commerce_seed":"golden"}'::jsonb,'active'),
('merchant.rakuten-ichiba','merchant','Rakuten Ichiba','Rakuten Group, Inc.','ja-JP','{"country":"JP","category":"marketplace","commerce_seed":"golden"}'::jsonb,'active'),
('merchant.yahoo-shopping','merchant','Yahoo! Shopping','LY Corporation','ja-JP','{"country":"JP","category":"marketplace","commerce_seed":"golden"}'::jsonb,'active'),
('merchant.zozotown','merchant','ZOZOTOWN','ZOZO, Inc.','ja-JP','{"country":"JP","category":"fashion_ecommerce","commerce_seed":"golden"}'::jsonb,'active'),
('instrument.payment.credit-card','payment_interface','Credit card',null,'ja-JP','{"commerce_generic":true}'::jsonb,'active'),
('instrument.payment.debit-card','payment_interface','Debit card',null,'ja-JP','{"commerce_generic":true}'::jsonb,'active'),
('instrument.payment.bank-transfer','payment_interface','Bank transfer',null,'ja-JP','{"commerce_generic":true}'::jsonb,'active'),
('instrument.payment.postal-transfer','payment_interface','Postal transfer',null,'ja-JP','{"commerce_generic":true}'::jsonb,'active'),
('instrument.payment.netbank-atm','payment_interface','Net banking / ATM',null,'ja-JP','{"commerce_generic":true}'::jsonb,'active'),
('instrument.payment.convenience-store','payment_interface','Convenience-store payment',null,'ja-JP','{"commerce_generic":true}'::jsonb,'active'),
('instrument.payment.cash-on-delivery','payment_interface','Cash on delivery',null,'ja-JP','{"commerce_generic":true}'::jsonb,'active'),
('instrument.payment.postpay','payment_interface','Postpay / deferred payment',null,'ja-JP','{"commerce_generic":true}'::jsonb,'active'),
('instrument.payment.paidy','payment_interface','Paidy',null,'ja-JP','{"commerce_generic":false}'::jsonb,'active'),
('instrument.payment.paypal','payment_interface','PayPal',null,'ja-JP','{"commerce_generic":false}'::jsonb,'active'),
('instrument.payment.carrier-billing','payment_interface','Carrier billing',null,'ja-JP','{"commerce_generic":true}'::jsonb,'active'),
('instrument.payment.pay-easy','payment_interface','Pay-easy',null,'ja-JP','{"commerce_generic":false}'::jsonb,'active'),
('instrument.payment.bitcoin','payment_interface','Bitcoin',null,'ja-JP','{"commerce_generic":false}'::jsonb,'active'),
('instrument.payment.shopping-loan','payment_interface','Shopping loan',null,'ja-JP','{"commerce_generic":true}'::jsonb,'active'),
('instrument.value.amazon-gift-card','stored_value_program','Amazon Gift Card',null,'ja-JP','{"merchant":"Amazon.co.jp"}'::jsonb,'active'),
('instrument.value.yahoo-shopping-voucher','stored_value_program','Yahoo! Shopping voucher',null,'ja-JP','{"merchant":"Yahoo! Shopping"}'::jsonb,'active'),
('instrument.value.biccamera-gift-card','stored_value_program','Bic Camera Gift Card',null,'ja-JP','{"merchant":"Bic Camera"}'::jsonb,'active'),
('instrument.payment.zozocard','payment_interface','ZOZOCARD',null,'ja-JP','{"commerce_dependency":true,"note":"Payment-product binding only; does not alter the canonical top-card catalogue."}'::jsonb,'active'),
('program.jp.amazonpoint','loyalty_program','Amazon Points',null,'ja-JP','{"value_jpy_per_point":1}'::jsonb,'active'),
('program.jp.zozopoint','loyalty_program','ZOZO Points',null,'ja-JP','{"value_jpy_per_point":1}'::jsonb,'active')
on conflict (entity_key) do nothing;

insert into app_private.trusted_sources (source_key,name,publisher,category,tier,publication_use,source_url,authority_scope,locale,geography,evidence_format,volatility,recommended_check_cadence,retrieval_method,requires_login,automation_status,terms_review_status,technical_feasibility,url_registered_on,content_verified_on,verification_status,notes,registry_payload) values
('commerce.amazon-jp.payment-guide','Amazon.co.jp non-card payment guide','Amazon Japan','commerce_payment_rules','T1_CANONICAL','canonical','https://www.aboutamazon.jp/news/guide/payment-methods-other-than-credit-cards-on-amazon-co-jp','["commerce.amazon.co.jp","payment_methods","point_stacking"]'::jsonb,'ja-JP','JP','html','high','weekly','manual_browser',false,'manual','not_reviewed','environment_dependent_or_mixed',date '2026-08-26',date '2026-08-26','content_verified','Official Amazon Japan guide.','{"surface_key":"commerce.amazon.co.jp"}'::jsonb),
('commerce.rakuten-ichiba.payment-help','Rakuten Ichiba payment methods help','Rakuten Group','commerce_payment_rules','T1_CANONICAL','canonical','https://ichiba.faq.rakuten.net/detail/000006488','["commerce.rakuten.ichiba.jp","payment_methods","seller_variance"]'::jsonb,'ja-JP','JP','html','high','weekly','manual_browser',false,'manual','not_reviewed','environment_dependent_or_mixed',date '2026-08-26',date '2026-08-26','content_verified','Official Rakuten Ichiba help.','{"surface_key":"commerce.rakuten.ichiba.jp"}'::jsonb),
('commerce.rakuten-ichiba.item-search-api','Rakuten Ichiba Item Search API','Rakuten Group','commerce_api','T1_CANONICAL','canonical','https://webservice.rakuten.co.jp/documentation/ichiba-item-search','["commerce.rakuten.ichiba.jp","shopCode","itemCode","creditCardFlag","pointRate"]'::jsonb,'ja-JP','JP','json','high','daily','official_api',false,'api_candidate','not_reviewed','partner_feed_candidate',date '2026-08-26',date '2026-08-26','content_verified','Official Rakuten Web Service documentation.','{"surface_key":"commerce.rakuten.ichiba.jp","resolver_candidate":true}'::jsonb),
('commerce.yahoo-shopping.payment-help','Yahoo! Shopping payment methods help','LY Corporation','commerce_payment_rules','T1_CANONICAL','canonical','https://support.yahoo-net.jp/PccShopping/s/article/H000011033','["commerce.yahoo.shopping.jp","payment_methods","product_variance","vpoint_redeem"]'::jsonb,'ja-JP','JP','html','high','weekly','manual_browser',false,'manual','not_reviewed','environment_dependent_or_mixed',date '2026-08-26',date '2026-08-26','content_verified','Official Yahoo! Shopping help.','{"surface_key":"commerce.yahoo.shopping.jp"}'::jsonb),
('commerce.yahoo-shopping.store-model','Yahoo! Shopping store-specific order model','LY Corporation','commerce_payment_rules','T1_CANONICAL','canonical','https://support.yahoo-net.jp/PccShopping/s/article/H000005915','["commerce.yahoo.shopping.jp","seller_variance","store_checkout"]'::jsonb,'ja-JP','JP','html','high','weekly','manual_browser',false,'manual','not_reviewed','environment_dependent_or_mixed',date '2026-08-26',date '2026-08-26','content_verified','Official Yahoo! Shopping help.','{"surface_key":"commerce.yahoo.shopping.jp"}'::jsonb),
('commerce.biccamera-web.payment-list','BicCamera.com payment methods','Bic Camera','commerce_payment_rules','T1_CANONICAL','canonical','https://www.biccamera.com/bc/c/info/payment/index.jsp','["commerce.biccamera.com","payment_methods"]'::jsonb,'ja-JP','JP','html','high','weekly','manual_browser',false,'manual','not_reviewed','environment_dependent_or_mixed',date '2026-08-26',date '2026-08-26','content_verified','Official BicCamera.com payment page.','{"surface_key":"commerce.biccamera.com"}'::jsonb),
('commerce.biccamera-web.point-guide','BicCamera.com Bic Point guide','Bic Camera','commerce_reward_rules','T1_CANONICAL','canonical','https://www.biccamera.com/bc/c/info/point/index.jsp','["commerce.biccamera.com","bic_point","base_rate"]'::jsonb,'ja-JP','JP','html','high','weekly','manual_browser',false,'manual','not_reviewed','environment_dependent_or_mixed',date '2026-08-26',date '2026-08-26','content_verified','Official Bic Point guide.','{"surface_key":"commerce.biccamera.com"}'::jsonb),
('commerce.zozotown.help','ZOZOTOWN payment help','ZOZO','commerce_payment_rules','T1_CANONICAL','canonical','https://zozo.jp/_help/default.html','["commerce.zozotown.jp","payment_methods"]'::jsonb,'ja-JP','JP','html','high','weekly','manual_browser',false,'manual','not_reviewed','environment_dependent_or_mixed',date '2026-08-26',date '2026-08-26','content_verified','Official ZOZOTOWN help.','{"surface_key":"commerce.zozotown.jp"}'::jsonb),
('commerce.zozotown.paypay','ZOZOTOWN PayPay rules','ZOZO','commerce_reward_rules','T1_CANONICAL','canonical','https://zozo.jp/paypay/','["commerce.zozotown.jp","paypay","split_tender","reward_basis"]'::jsonb,'ja-JP','JP','html','high','weekly','manual_browser',false,'manual','not_reviewed','environment_dependent_or_mixed',date '2026-08-26',date '2026-08-26','content_verified','Official ZOZOTOWN PayPay page.','{"surface_key":"commerce.zozotown.jp"}'::jsonb),
('commerce.zozotown.zozocard','ZOZOCARD reward rules','ZOZO','commerce_reward_rules','T1_CANONICAL','canonical','https://zozo.jp/_card/','["commerce.zozotown.jp","zozocard","zozo_point","reward_basis"]'::jsonb,'ja-JP','JP','html','high','weekly','manual_browser',false,'manual','not_reviewed','environment_dependent_or_mixed',date '2026-08-26',date '2026-08-26','content_verified','Official ZOZOCARD page.','{"surface_key":"commerce.zozotown.jp"}'::jsonb)
on conflict (source_key) do nothing;

insert into app_private.commerce_surfaces (surface_key,operator_entity_id,display_name,surface_kind,canonical_host,canonical_path_pattern,market_country,locale,currency,merchant_of_record_mode,payment_policy_mode,web_url,metadata,status)
select v.surface_key,e.id,v.display_name,v.surface_kind,v.canonical_host,v.canonical_path_pattern,'JP','ja-JP','JPY',v.mor_mode,v.payment_mode,v.web_url,v.metadata::jsonb,'active'
from (values
('commerce.amazon.co.jp','merchant.amazon-jp','Amazon.co.jp','marketplace','amazon.co.jp',null,'mixed','offer_dynamic','https://www.amazon.co.jp/','{"golden_site":true,"product_restrictions_possible":true}'),
('commerce.rakuten.ichiba.jp','merchant.rakuten-ichiba','Rakuten Ichiba','marketplace','www.rakuten.co.jp',null,'seller','seller_configurable','https://www.rakuten.co.jp/','{"golden_site":true,"official_item_api":true}'),
('commerce.yahoo.shopping.jp','merchant.yahoo-shopping','Yahoo! Shopping','marketplace','shopping.yahoo.co.jp',null,'seller','seller_configurable','https://shopping.yahoo.co.jp/','{"golden_site":true,"store_checkout":true}'),
('commerce.biccamera.com','merchant.biccamera','BicCamera.com','owned_store','www.biccamera.com','/bc/','platform','uniform','https://www.biccamera.com/','{"golden_site":true,"owned_retail":true}'),
('commerce.zozotown.jp','merchant.zozotown','ZOZOTOWN','owned_store','zozo.jp',null,'platform','offer_dynamic','https://zozo.jp/','{"golden_site":true,"split_tender":true}')
) as v(surface_key,merchant_key,display_name,surface_kind,canonical_host,canonical_path_pattern,mor_mode,payment_mode,web_url,metadata)
join app_private.entities e on e.entity_key=v.merchant_key
on conflict (surface_key) do nothing;

insert into app_private.commerce_surface_aliases (surface_id,alias_type,alias,market_country,is_primary)
select s.id,'host',v.alias,'JP',v.is_primary from (values
('commerce.amazon.co.jp','www.amazon.co.jp',true),('commerce.amazon.co.jp','amazon.co.jp',true),
('commerce.rakuten.ichiba.jp','www.rakuten.co.jp',true),('commerce.rakuten.ichiba.jp','item.rakuten.co.jp',false),
('commerce.yahoo.shopping.jp','shopping.yahoo.co.jp',true),('commerce.biccamera.com','www.biccamera.com',true),
('commerce.biccamera.com','biccamera.com',false),('commerce.zozotown.jp','zozo.jp',true),('commerce.zozotown.jp','www.zozo.jp',false)
) as v(surface_key,alias,is_primary)
join app_private.commerce_surfaces s on s.surface_key=v.surface_key
on conflict (surface_id,alias_type,alias) do nothing;

insert into app_private.online_commerce_catalogue (family_id,surface_id,display_name,category,priority,requires_payment_coverage,requires_loyalty_coverage,requires_optimization_coverage,requires_seller_resolution,stream_id,rationale,metadata,status)
select v.family_id,s.id,v.display_name,v.category,'P0',true,true,true,v.seller_resolution,v.stream_id,v.rationale,v.metadata::jsonb,'active'
from (values
('commerce-family.amazon-jp','commerce.amazon.co.jp','Amazon.co.jp','general_marketplace',false,'commerce.amazon-jp','Large marketplace; payment and item restrictions can vary by order context.','{"golden_site":true}'),
('commerce-family.rakuten-ichiba','commerce.rakuten.ichiba.jp','Rakuten Ichiba','general_marketplace',true,'commerce.rakuten-ichiba','Marketplace with shop-specific payment options and item/shop reward fields.','{"golden_site":true,"resolver":"shopCode+itemCode"}'),
('commerce-family.yahoo-shopping','commerce.yahoo.shopping.jp','Yahoo! Shopping','general_marketplace',true,'commerce.yahoo-shopping','Marketplace with store-specific checkout and product-specific payment restrictions.','{"golden_site":true,"resolver":"store+product"}'),
('commerce-family.biccamera-web','commerce.biccamera.com','BicCamera.com','electronics_retail',false,'commerce.biccamera-web','Owned retailer with broad wallet/payment support and Bic Point economics.','{"golden_site":true}'),
('commerce-family.zozotown','commerce.zozotown.jp','ZOZOTOWN','fashion_ecommerce',false,'commerce.zozotown','Owned fashion retailer with split-tender PayPay/card reward bases.','{"golden_site":true}')
) as v(family_id,surface_key,display_name,category,seller_resolution,stream_id,rationale,metadata)
join app_private.commerce_surfaces s on s.surface_key=v.surface_key
on conflict (family_id) do nothing;

insert into app_private.commerce_contexts (context_key,surface_id,context_type,display_name,selector,specificity_rank,metadata,status)
select 'commerce-context.' || replace(substr(s.surface_key,10),'.','-') || '.default',s.id,'surface_default',s.display_name || ' default','{}'::jsonb,0,'{"inheritance_root":true}'::jsonb,'active'
from app_private.commerce_surfaces s
where s.surface_key in ('commerce.amazon.co.jp','commerce.rakuten.ichiba.jp','commerce.yahoo.shopping.jp','commerce.biccamera.com','commerce.zozotown.jp')
on conflict (context_key) do nothing;


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
