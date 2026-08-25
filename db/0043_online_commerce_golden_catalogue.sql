-- Golden online-commerce identities, official sources, surfaces, and default contexts.
begin;

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

commit;
