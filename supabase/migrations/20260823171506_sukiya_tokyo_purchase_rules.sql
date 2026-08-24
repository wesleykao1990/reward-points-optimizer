begin;

insert into app_private.entities(entity_key,entity_type,display_name,locale,metadata,status)
values ('merchant.sukiya','merchant','Sukiya','ja-JP','{"category":"fast_food","group":"zensho"}'::jsonb,'active')
on conflict(entity_key) do update set display_name=excluded.display_name,metadata=app_private.entities.metadata||excluded.metadata,status='active',updated_at=now();

with m as (select id from app_private.entities where entity_key='merchant.sukiya'),
rows(location_key,display_name,address,store_id,area,source_url) as (values
 ('tokyo.shinjuku.sukiya.southeast-exit','すき家 新宿東南口店','{"postal_code":"160-0022","prefecture":"東京都","ward":"新宿区","street":"新宿3-32-2","country_code":"JP"}'::jsonb,'232','shinjuku','https://maps.sukiya.jp/jp/detail/232.html'),
 ('tokyo.shibuya.sukiya.harajuku-meijidori','すき家 原宿明治通り店','{"postal_code":"150-0001","prefecture":"東京都","ward":"渋谷区","street":"神宮前3-23-3","country_code":"JP"}'::jsonb,'1576','shibuya','https://maps.sukiya.jp/jp/detail/1576.html'),
 ('tokyo.akihabara.sukiya.akiba-tashirodori','すき家 アキバ田代通り店','{"postal_code":"101-0021","prefecture":"東京都","ward":"千代田区","street":"外神田4-5-8","country_code":"JP"}'::jsonb,'1482','akihabara','https://maps.sukiya.jp/jp/detail/1482.html'),
 ('tokyo.koto.sukiya.kiba','すき家 木場店','{"postal_code":"135-0042","prefecture":"東京都","ward":"江東区","street":"木場5-11-19","country_code":"JP"}'::jsonb,'1045','koto','https://maps.sukiya.jp/jp/detail/1045.html'),
 ('tokyo.shinagawa.sukiya.omori-bellport','すき家 大森ベルポート店','{"postal_code":"140-0013","prefecture":"東京都","ward":"品川区","street":"南大井6-26-3","site_detail":"大森ベルポートD館1F","country_code":"JP"}'::jsonb,'1910','shinagawa','https://maps.sukiya.jp/jp/detail/1910.html')
)
insert into app_private.merchant_locations(location_key,merchant_entity_id,display_name,address,external_place_ids,confidence,metadata)
select r.location_key,m.id,r.display_name,r.address,jsonb_build_object('sukiya_store_id',r.store_id),'official_directory',jsonb_build_object('launch_area',r.area,'official_source_url',r.source_url)
from rows r cross join m
on conflict(location_key) do update set display_name=excluded.display_name,address=excluded.address,external_place_ids=app_private.merchant_locations.external_place_ids||excluded.external_place_ids,confidence='official_directory',metadata=app_private.merchant_locations.metadata||excluded.metadata,updated_at=now();

-- Exact store pages confirm these common payment methods for the five seeded stores.
with methods(entity_key) as (values
 ('instrument.payment.credit_card_general'),('instrument.emoney.transit_ic'),('instrument.emoney.rakuten_edy'),('instrument.emoney.id'),('instrument.emoney.quicpay'),
 ('instrument.wallet.paypay'),('instrument.wallet.merpay'),('instrument.wallet.aupay'),('instrument.wallet.dbarai'),('instrument.wallet.rakutenpay'),('instrument.wallet.jcoinpay'),('instrument.wallet.aeonpay')
), stores(location_key,source_url) as (values
 ('tokyo.shinjuku.sukiya.southeast-exit','https://maps.sukiya.jp/jp/detail/232.html'),
 ('tokyo.shibuya.sukiya.harajuku-meijidori','https://maps.sukiya.jp/jp/detail/1576.html'),
 ('tokyo.akihabara.sukiya.akiba-tashirodori','https://maps.sukiya.jp/jp/detail/1482.html'),
 ('tokyo.koto.sukiya.kiba','https://maps.sukiya.jp/jp/detail/1045.html'),
 ('tokyo.shinagawa.sukiya.omori-bellport','https://maps.sukiya.jp/jp/detail/1910.html')
), m as (select id from app_private.entities where entity_key='merchant.sukiya')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,merchant_location_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select 'maf_sukiya_'||regexp_replace(s.location_key,'[^a-z0-9]+','_','g')||'_'||regexp_replace(methods.entity_key,'[^a-z0-9]+','_','g'),m.id,ml.id,e.id,'pay','yes','branch','official_store_page','sukiya-store-payment',s.source_url,now(),0.99,'{"store_page_explicit":true}'::jsonb,'active'
from stores s cross join methods cross join m
join app_private.merchant_locations ml on ml.location_key=s.location_key
join app_private.entities e on e.entity_key=methods.entity_key
on conflict(fact_key) do nothing;

-- Each selected store explicitly lists V, Rakuten, d and Ponta; they cannot be combined in one transaction.
with programs(entity_key) as (values ('program.jp.vpoint'),('program.jp.rakutenpoint'),('program.jp.dpoint'),('program.jp.ponta')),
stores(location_key,source_url) as (values
 ('tokyo.shinjuku.sukiya.southeast-exit','https://maps.sukiya.jp/jp/detail/232.html'),
 ('tokyo.shibuya.sukiya.harajuku-meijidori','https://maps.sukiya.jp/jp/detail/1576.html'),
 ('tokyo.akihabara.sukiya.akiba-tashirodori','https://maps.sukiya.jp/jp/detail/1482.html'),
 ('tokyo.koto.sukiya.kiba','https://maps.sukiya.jp/jp/detail/1045.html'),
 ('tokyo.shinagawa.sukiya.omori-bellport','https://maps.sukiya.jp/jp/detail/1910.html')
), actions(action) as (values ('earn'),('redeem')),
m as (select id from app_private.entities where entity_key='merchant.sukiya')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,merchant_location_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select 'maf_sukiya_'||regexp_replace(s.location_key,'[^a-z0-9]+','_','g')||'_'||regexp_replace(programs.entity_key,'[^a-z0-9]+','_','g')||'_'||actions.action,m.id,ml.id,p.id,actions.action,'yes','branch','official_store_page','sukiya-store-points',s.source_url,now(),0.99,'{"store_page_explicit":true}'::jsonb,'active'
from stores s cross join programs cross join actions cross join m
join app_private.merchant_locations ml on ml.location_key=s.location_key
join app_private.entities p on p.entity_key=programs.entity_key
on conflict(fact_key) do nothing;

-- Common-point economics: 1 point / 200 JPY incl tax, one program per checkout.
with programs(entity_key) as (values ('program.jp.vpoint'),('program.jp.rakutenpoint'),('program.jp.dpoint'),('program.jp.ponta')),
m as (select id from app_private.entities where entity_key='merchant.sukiya')
insert into app_private.merchant_tender_reward_facts(fact_key,merchant_entity_id,loyalty_program_entity_id,scope,rate_model,reward_units,spend_jpy,tax_basis,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status,component_kind,stacking_mode,choice_group,eligibility)
select 'mtr_sukiya_'||regexp_replace(programs.entity_key,'[^a-z0-9]+','_','g'),m.id,p.id,'chain_default','points_per_spend',1,200,'tax_inclusive','floor','official_store_page','zensho-common-points','https://point.zensho.co.jp/',now(),0.99,'{"value_jpy_per_point":1}'::jsonb,'active','merchant_loyalty','exclusive_choice','sukiya_common_point_card','{"delivery_excluded":true,"some_program_store_exceptions_possible":true}'::jsonb
from programs cross join m join app_private.entities p on p.entity_key=programs.entity_key
on conflict(fact_key) do nothing;

insert into app_private.merchant_enrichment_jobs(merchant_location_id,provider,enrichment_kind,priority,status,metadata)
select ml.id,'osm_overpass','coordinates',55,'pending',jsonb_build_object('reason','official Sukiya location seeded without guessed coordinates')
from app_private.merchant_locations ml join app_private.entities e on e.id=ml.merchant_entity_id
where e.entity_key='merchant.sukiya'
on conflict(merchant_location_id,provider,enrichment_kind) do nothing;

commit;
