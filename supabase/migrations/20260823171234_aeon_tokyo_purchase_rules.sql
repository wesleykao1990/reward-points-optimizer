begin;

insert into app_private.entities(entity_key,entity_type,display_name,locale,metadata,status)
values
 ('merchant.aeon-group','merchant','AEON / AEON Style','ja-JP','{"category":"general_merchandise_supermarket","reward_group":"aeon_target_stores"}'::jsonb,'active'),
 ('instrument.card.aeon','credit_card','AEON Card','ja-JP','{"network_family":"AEON mark cards","some_cards_excluded_from_waon_point":true}'::jsonb,'active')
on conflict(entity_key) do update set display_name=excluded.display_name,metadata=app_private.entities.metadata||excluded.metadata,status='active',updated_at=now();

with m as (select id from app_private.entities where entity_key='merchant.aeon-group'),
rows(location_key,display_name,address,area,source_url) as (values
 ('tokyo.meguro.aeon.himonya','イオンスタイル碑文谷','{"postal_code":"152-0003","prefecture":"東京都","ward":"目黒区","street":"碑文谷4-1-1","country_code":"JP"}'::jsonb,'meguro','https://www.minami.aeonretail.jp/pages/himonya'),
 ('tokyo.shinagawa.aeon.shinagawa-seaside','イオンスタイル品川シーサイド','{"postal_code":"140-0002","prefecture":"東京都","ward":"品川区","street":"東品川4-12-5","country_code":"JP"}'::jsonb,'shinagawa','https://www.minami.aeonretail.jp/pages/shinagawa'),
 ('tokyo.itabashi.aeon.itabashi','イオンスタイル板橋','{"postal_code":"175-0083","prefecture":"東京都","ward":"板橋区","street":"徳丸2-6-1","country_code":"JP"}'::jsonb,'itabashi','https://www.minami.aeonretail.jp/pages/itabashi'),
 ('tokyo.itabashi.aeon.maenocho','イオンスタイル板橋前野町','{"postal_code":"174-0063","prefecture":"東京都","ward":"板橋区","street":"前野町4-21-22","country_code":"JP"}'::jsonb,'itabashi','https://www.minami.aeonretail.jp/pages/itabashimaenocho'),
 ('tokyo.itabashi.aeon.nishidai','イオンスタイル西台','{"postal_code":"174-0046","prefecture":"東京都","ward":"板橋区","street":"蓮根3-8-12","country_code":"JP"}'::jsonb,'itabashi','https://www.minami.aeonretail.jp/pages/nishidai')
)
insert into app_private.merchant_locations(location_key,merchant_entity_id,display_name,address,external_place_ids,confidence,metadata)
select r.location_key,m.id,r.display_name,r.address,'{}'::jsonb,'official_directory',jsonb_build_object('launch_area',r.area,'official_source_url',r.source_url,'aeon_target_store_assumed_from_official_target_list',true)
from rows r cross join m
on conflict(location_key) do update set display_name=excluded.display_name,address=excluded.address,confidence='official_directory',metadata=app_private.merchant_locations.metadata||excluded.metadata,updated_at=now();

-- Official AEON target-store benefit applies to AEON-mark card, AEON Pay and WAON.
with m as (select id from app_private.entities where entity_key='merchant.aeon-group'),
methods(entity_key) as (values ('instrument.card.aeon'),('instrument.wallet.aeonpay'),('instrument.emoney.waon'))
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select 'maf_aeon_'||regexp_replace(methods.entity_key,'[^a-z0-9]+','_','g')||'_pay',m.id,e.id,'pay','yes','chain_default','official_store_page','aeon-anytime-double','https://www.aeon.co.jp/point/save/anytime/',now(),0.99,'{"basis":"official reward page explicitly describes payment at target AEON group stores"}'::jsonb,'active'
from m cross join methods join app_private.entities e on e.entity_key=methods.entity_key
on conflict(fact_key) do nothing;

with m as (select id from app_private.entities where entity_key='merchant.aeon-group'),
p as (select id from app_private.entities where entity_key='program.jp.waonpoint')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select * from (
 select 'maf_aeon_waonpoint_earn',m.id,p.id,'earn','yes','chain_default','official_store_page','aeon-anytime-double','https://www.aeon.co.jp/point/save/anytime/',now(),0.99,'{"target_store_scope":true}'::jsonb,'active' from m,p
 union all
 select 'maf_aeon_waonpoint_redeem',m.id,p.id,'redeem','yes','chain_default','official_store_page','aeonpay-feature','https://www.aeon.co.jp/service/lp/aeonpay/feature/',now(),0.99,'{"value_jpy_per_point":1,"target_store_scope":true}'::jsonb,'active' from m,p
) q
on conflict(fact_key) do nothing;

-- 2 WAON POINT per 200 JPY tax-inclusive for each eligible tender at target stores.
with m as (select id from app_private.entities where entity_key='merchant.aeon-group'),
p as (select id from app_private.entities where entity_key='program.jp.waonpoint'),
methods(entity_key) as (values ('instrument.card.aeon'),('instrument.wallet.aeonpay'),('instrument.emoney.waon'))
insert into app_private.merchant_tender_reward_facts(fact_key,merchant_entity_id,loyalty_program_entity_id,payment_instrument_entity_id,scope,rate_model,reward_units,spend_jpy,tax_basis,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status,component_kind,stacking_mode,choice_group,eligibility)
select 'mtr_aeon_double_'||regexp_replace(methods.entity_key,'[^a-z0-9]+','_','g'),m.id,p.id,e.id,'chain_default','points_per_spend',2,200,'tax_inclusive','floor','official_store_page','aeon-anytime-double','https://www.aeon.co.jp/point/save/anytime/',now(),0.99,'{"basic_rate":"1 WAON POINT per 200 JPY","target_rate":"2 WAON POINT per 200 JPY"}'::jsonb,'active','merchant_loyalty','additive',null,
 jsonb_build_object('target_aeon_group_store',true,'excluded_products_possible',true,'waon_point_paid_amount_excluded',true,'other_qr_excluded_from_double',true,'higher_multiplier_campaign_takes_priority',true)
from m,p,methods join app_private.entities e on e.entity_key=methods.entity_key
on conflict(fact_key) do nothing;

insert into app_private.merchant_enrichment_jobs(merchant_location_id,provider,enrichment_kind,priority,status,metadata)
select ml.id,'osm_overpass','coordinates',45,'pending',jsonb_build_object('reason','official AEON store seeded without guessed coordinates')
from app_private.merchant_locations ml join app_private.entities e on e.id=ml.merchant_entity_id
where e.entity_key='merchant.aeon-group'
on conflict(merchant_location_id,provider,enrichment_kind) do nothing;

commit;
