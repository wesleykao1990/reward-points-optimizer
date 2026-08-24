begin;

insert into app_private.entities(entity_key,entity_type,display_name,locale,metadata,status)
values
 ('merchant.yodobashi','merchant','Yodobashi Camera','ja-JP','{"category":"electronics"}'::jsonb,'active'),
 ('program.jp.yodobashi-goldpoint','loyalty_program','Yodobashi Gold Point','ja-JP','{"value_jpy_per_point":1,"base_rate_varies_by_product_and_payment":true}'::jsonb,'active'),
 ('instrument.card.yodobashi-goldpoint-plus','credit_card','Gold Point Card Plus','ja-JP','{"issuer":"Gold Point Marketing"}'::jsonb,'active')
on conflict(entity_key) do update set display_name=excluded.display_name, metadata=app_private.entities.metadata||excluded.metadata, status='active', updated_at=now();

with m as (select id from app_private.entities where entity_key='merchant.yodobashi'),
rows(location_key,display_name,address,area) as (values
 ('tokyo.shinjuku.yodobashi.west-main','ヨドバシカメラ 新宿西口本店','{"postal_code":"160-0023","prefecture":"東京都","ward":"新宿区","street":"西新宿1-11-1","country_code":"JP"}'::jsonb,'shinjuku'),
 ('tokyo.shinjuku.yodobashi.east','ヨドバシカメラ マルチメディア新宿東口','{"postal_code":"160-0022","prefecture":"東京都","ward":"新宿区","street":"新宿3-26-7","country_code":"JP"}'::jsonb,'shinjuku'),
 ('tokyo.akihabara.yodobashi.akiba','ヨドバシカメラ マルチメディアAkiba','{"postal_code":"101-0028","prefecture":"東京都","ward":"千代田区","street":"神田花岡町1-1","country_code":"JP"}'::jsonb,'akihabara'),
 ('tokyo.ueno.yodobashi.multimedia','ヨドバシカメラ マルチメディア上野','{"postal_code":"110-0005","prefecture":"東京都","ward":"台東区","street":"上野4-10-10","country_code":"JP"}'::jsonb,'ueno'),
 ('tokyo.kichijoji.yodobashi.multimedia','ヨドバシカメラ マルチメディア吉祥寺','{"postal_code":"180-0004","prefecture":"東京都","city":"武蔵野市","street":"吉祥寺本町1-19-1","country_code":"JP"}'::jsonb,'kichijoji'),
 ('tokyo.kinshicho.yodobashi.multimedia','ヨドバシカメラ マルチメディア錦糸町','{"postal_code":"130-8580","prefecture":"東京都","ward":"墨田区","street":"江東橋3-14-5","site_detail":"テルミナ1F-3F","country_code":"JP"}'::jsonb,'kinshicho')
)
insert into app_private.merchant_locations(location_key,merchant_entity_id,display_name,address,external_place_ids,confidence,metadata)
select r.location_key,m.id,r.display_name,r.address,'{}'::jsonb,'official_directory',jsonb_build_object('launch_area',r.area,'official_source_url','https://www.yodobashi.com/ec/store/list/')
from rows r cross join m
on conflict(location_key) do update set display_name=excluded.display_name,address=excluded.address,confidence='official_directory',metadata=app_private.merchant_locations.metadata||excluded.metadata,updated_at=now();

with m as (select id from app_private.entities where entity_key='merchant.yodobashi'),
p as (select id from app_private.entities where entity_key='program.jp.yodobashi-goldpoint'),
c as (select id from app_private.entities where entity_key='instrument.card.yodobashi-goldpoint-plus')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select * from (
 select 'maf_yodobashi_goldpoint_earn',m.id,p.id,'earn','yes','chain_default','official_store_page','yodobashi-goldpoint','https://www.yodobashi.com/',now(),0.98,'{"rate_varies_by_product_and_payment":true}'::jsonb,'active' from m,p
 union all
 select 'maf_yodobashi_goldpoint_redeem',m.id,p.id,'redeem','yes','chain_default','official_store_page','yodobashi-goldpoint-app','https://www.yodobashi.com/ec/support/member/pointservice/gold/about/iphone/',now(),0.98,'{}'::jsonb,'active' from m,p
 union all
 select 'maf_yodobashi_goldpoint_plus_pay',m.id,c.id,'pay','yes','chain_default','official_store_page','yodobashi-plus-3pct','https://www.yodobashi.com/ec/news/2000091700/index.html?kind=0002&store=0011',now(),0.99,'{"group_scope":"Yodobashi group"}'::jsonb,'active' from m,c
) q
on conflict(fact_key) do nothing;

with m as (select id from app_private.entities where entity_key='merchant.yodobashi'),
p as (select id from app_private.entities where entity_key='program.jp.yodobashi-goldpoint'),
c as (select id from app_private.entities where entity_key='instrument.card.yodobashi-goldpoint-plus')
insert into app_private.merchant_tender_reward_facts(fact_key,merchant_entity_id,loyalty_program_entity_id,payment_instrument_entity_id,scope,rate_model,rate_percent,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status,component_kind,stacking_mode,choice_group,eligibility,tax_basis)
select 'mtr_yodobashi_goldpoint_plus_bonus',m.id,p.id,c.id,'chain_default','points_percent',3,'unknown','official_store_page','yodobashi-plus-3pct','https://www.yodobashi.com/ec/news/2000091700/index.html?kind=0002&store=0011',now(),0.99,'{"description":"1% credit payment + 2% special points, in addition to cash-equivalent regular points"}'::jsonb,'active','payment_bonus','additive',null,'{"requires_web_statement_check_registration":true,"base_merchant_rate_variable":true}'::jsonb,'tax_inclusive'
from m,p,c
on conflict(fact_key) do nothing;

insert into app_private.merchant_enrichment_jobs(merchant_location_id,provider,enrichment_kind,priority,status,metadata)
select ml.id,'osm_overpass','coordinates',55,'pending',jsonb_build_object('reason','official Yodobashi store seeded without guessed coordinates')
from app_private.merchant_locations ml join app_private.entities e on e.id=ml.merchant_entity_id
where e.entity_key='merchant.yodobashi'
on conflict(merchant_location_id,provider,enrichment_kind) do nothing;

commit;
