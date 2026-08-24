begin;

insert into app_private.entities(entity_key,entity_type,display_name,locale,metadata,status)
values
 ('merchant.donquijote','merchant','Don Quijote','ja-JP','{"category":"discount_store"}'::jsonb,'active'),
 ('instrument.majica.money','stored_value_program','majica Money','ja-JP','{"network":"majica"}'::jsonb,'active'),
 ('program.jp.majica','loyalty_program','majica Points','ja-JP','{"value_jpy_per_point":1,"expiry_basis":"last_point_grant"}'::jsonb,'active'),
 ('instrument.card.majica-ucs','credit_card','UCS / majica registered card','ja-JP','{"issuer_family":"UCS","majica_link_required_for_majica_points":true}'::jsonb,'active')
on conflict(entity_key) do update set display_name=excluded.display_name,metadata=app_private.entities.metadata||excluded.metadata,status='active',updated_at=now();

with m as (select id from app_private.entities where entity_key='merchant.donquijote'),
rows(location_key,display_name,address,shop_id,area,source_url) as (values
 ('tokyo.shinjuku.donki.southeast-exit','ドン・キホーテ新宿東南口店','{"postal_code":"160-0022","prefecture":"東京都","ward":"新宿区","street":"新宿3-36-16","country_code":"JP"}'::jsonb,'449','shinjuku','https://www.donki.com/store/shop_detail.php?shop_id=449'),
 ('tokyo.shibuya.donki.mega-main','MEGAドン・キホーテ渋谷本店','{"postal_code":"150-0042","prefecture":"東京都","ward":"渋谷区","street":"宇田川町28-6","country_code":"JP"}'::jsonb,'442','shibuya','https://www.donki.com/store/shop_detail.php?shop_id=442'),
 ('tokyo.ikebukuro.donki.east-exit','ドン・キホーテ池袋東口駅前店','{"postal_code":"171-0022","prefecture":"東京都","ward":"豊島区","street":"南池袋1-22-5","country_code":"JP"}'::jsonb,'255','ikebukuro','https://www.donki.com/store/shop_detail.php?shop_id=255'),
 ('tokyo.akihabara.donki.akihabara','ドン・キホーテ秋葉原店','{"postal_code":"101-0021","prefecture":"東京都","ward":"千代田区","street":"外神田4-3-3","country_code":"JP"}'::jsonb,'98','akihabara','https://www.donki.com/store/shop_detail.php?shop_id=98'),
 ('tokyo.ginza.donki.ginza-honkan','ドン・キホーテ銀座本館','{"postal_code":"104-0061","prefecture":"東京都","ward":"中央区","street":"銀座8-10","site_detail":"銀座ナイン3号館","country_code":"JP"}'::jsonb,'92','ginza','https://www.donki.com/store/shop_detail.php?shop_id=92')
)
insert into app_private.merchant_locations(location_key,merchant_entity_id,display_name,address,external_place_ids,confidence,metadata)
select r.location_key,m.id,r.display_name,r.address,jsonb_build_object('donki_shop_id',r.shop_id),'official_directory',jsonb_build_object('launch_area',r.area,'official_source_url',r.source_url,'open_24h',true)
from rows r cross join m
on conflict(location_key) do update set display_name=excluded.display_name,address=excluded.address,external_place_ids=app_private.merchant_locations.external_place_ids||excluded.external_place_ids,confidence='official_directory',metadata=app_private.merchant_locations.metadata||excluded.metadata,updated_at=now();

with m as (select id from app_private.entities where entity_key='merchant.donquijote'),
maj as (select id from app_private.entities where entity_key='instrument.majica.money'),
p as (select id from app_private.entities where entity_key='program.jp.majica'),
cc as (select id from app_private.entities where entity_key='instrument.payment.credit_card_general')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select * from (
 select 'maf_donki_majica_pay',m.id,maj.id,'pay','yes','chain_default','official_store_page','donki-payment-faq','https://qa.ppih.co.jp/faq/show/9775?site_domain=donki',now(),0.99,'{"branch_exceptions_possible":true}'::jsonb,'active' from m,maj
 union all
 select 'maf_donki_credit_card_pay',m.id,cc.id,'pay','yes','chain_default','official_store_page','donki-payment-faq','https://qa.ppih.co.jp/faq/show/9775?site_domain=donki',now(),0.95,'{"brands":["Visa","Mastercard","JCB","American Express","Diners Club","Discover"],"branch_exceptions_possible":true}'::jsonb,'active' from m,cc
 union all
 select 'maf_donki_majica_earn',m.id,p.id,'earn','yes','chain_default','official_store_page','majica-points','https://www.majica-net.com/guide/point/',now(),0.99,'{"membership_registration_required":true}'::jsonb,'active' from m,p
 union all
 select 'maf_donki_majica_redeem',m.id,p.id,'redeem','yes','chain_default','official_store_page','majica-redeem','https://www.majica-net.com/guide/payment/',now(),0.99,'{"value_jpy_per_point":1}'::jsonb,'active' from m,p
) q
on conflict(fact_key) do nothing;

-- 0.5% with majica money; 1.5% with registered UCS/majica-linked card at domestic Don Quijote group registers.
with m as (select id from app_private.entities where entity_key='merchant.donquijote'),
p as (select id from app_private.entities where entity_key='program.jp.majica'),
maj as (select id from app_private.entities where entity_key='instrument.majica.money'),
ucs as (select id from app_private.entities where entity_key='instrument.card.majica-ucs')
insert into app_private.merchant_tender_reward_facts(fact_key,merchant_entity_id,loyalty_program_entity_id,payment_instrument_entity_id,scope,rate_model,reward_units,spend_jpy,tax_basis,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status,component_kind,stacking_mode,choice_group,eligibility)
select * from (
 select 'mtr_donki_majica_money_base',m.id,p.id,maj.id,'chain_default','points_per_spend',1::numeric,200,'unknown','floor','official_store_page','majica-points','https://www.majica-net.com/guide/point/',now(),0.99,'{"display_rate_percent":0.5}'::jsonb,'active','merchant_loyalty','additive',null,'{"requires_majica_member_registration":true,"rank_can_increase_rate":true}'::jsonb from m,p,maj
 union all
 select 'mtr_donki_ucs_registered_base',m.id,p.id,ucs.id,'chain_default','points_per_spend',3::numeric,200,'unknown','floor','official_store_page','majica-points','https://www.majica-net.com/guide/point/',now(),0.99,'{"display_rate_percent":1.5}'::jsonb,'active','payment_bonus','additive',null,'{"requires_ucs_card_registered_in_majica_app":true,"direct_register_payment":true,"excludes_quicpay_applepay_googlepay":true}'::jsonb from m,p,ucs
) q
on conflict(fact_key) do nothing;

insert into app_private.merchant_enrichment_jobs(merchant_location_id,provider,enrichment_kind,priority,status,metadata)
select ml.id,'osm_overpass','coordinates',60,'pending',jsonb_build_object('reason','official Don Quijote store seeded without guessed coordinates')
from app_private.merchant_locations ml join app_private.entities e on e.id=ml.merchant_entity_id
where e.entity_key='merchant.donquijote'
on conflict(merchant_location_id,provider,enrichment_kind) do nothing;

commit;
