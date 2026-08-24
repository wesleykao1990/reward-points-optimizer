begin;

insert into app_private.entities(entity_key,entity_type,display_name,locale,metadata,status)
values
 ('merchant.gusto','merchant','Gusto','ja-JP','{"category":"family_restaurant","group":"skylark"}'::jsonb,'active'),
 ('program.jp.skylark','loyalty_program','Skylark Points','ja-JP','{"value_jpy_per_point":1,"app_required":true}'::jsonb,'active')
on conflict(entity_key) do update set display_name=excluded.display_name,metadata=app_private.entities.metadata||excluded.metadata,status='active',updated_at=now();

with m as (select id from app_private.entities where entity_key='merchant.gusto'),
rows(location_key,display_name,address,store_id,area,source_url) as (values
 ('tokyo.shinjuku.gusto.nowa','ガスト 新宿ＮＯＷＡビル店','{"postal_code":"160-0022","prefecture":"東京都","ward":"新宿区","street":"新宿3-37-12","site_detail":"新宿NOWAビル7F","country_code":"JP"}'::jsonb,'017756','shinjuku','https://store-info.skylark.co.jp/gusto/map/017756/'),
 ('tokyo.shibuya.gusto.station','ガスト 渋谷駅前店','{"postal_code":"150-0043","prefecture":"東京都","ward":"渋谷区","street":"道玄坂2-3-1","site_detail":"渋谷駅前ビル7F","country_code":"JP"}'::jsonb,'018972','shibuya','https://store-info.skylark.co.jp/gusto/map/018972/'),
 ('tokyo.ikebukuro.gusto.sunshine-dori','ガスト 池袋サンシャイン通店','{"postal_code":"170-0013","prefecture":"東京都","ward":"豊島区","street":"東池袋1-20-6","site_detail":"プラザイン池袋ビル1F","country_code":"JP"}'::jsonb,'018923','ikebukuro','https://store-info.skylark.co.jp/gusto/map/018923/'),
 ('tokyo.akihabara.gusto.station','ガスト 秋葉原駅前店','{"postal_code":"101-0021","prefecture":"東京都","ward":"千代田区","street":"外神田1-18-18","site_detail":"秋葉原駅前プラザ4F","country_code":"JP"}'::jsonb,'017715','akihabara','https://store-info.skylark.co.jp/gusto/map/017715/'),
 ('tokyo.ginza.gusto.inz','ガスト 銀座インズ店','{"postal_code":"104-0061","prefecture":"東京都","ward":"中央区","street":"銀座西3-1","site_detail":"銀座インズ1 2F","country_code":"JP"}'::jsonb,'018966','ginza','https://store-info.skylark.co.jp/gusto/map/018966/')
)
insert into app_private.merchant_locations(location_key,merchant_entity_id,display_name,address,external_place_ids,confidence,metadata)
select r.location_key,m.id,r.display_name,r.address,jsonb_build_object('skylark_store_id',r.store_id),'official_directory',jsonb_build_object('launch_area',r.area,'official_source_url',r.source_url)
from rows r cross join m
on conflict(location_key) do update set display_name=excluded.display_name,address=excluded.address,external_place_ids=app_private.merchant_locations.external_place_ids||excluded.external_place_ids,confidence='official_directory',metadata=app_private.merchant_locations.metadata||excluded.metadata,updated_at=now();

-- Exact selected store pages explicitly list cards and these electronic-money families.
with methods(entity_key) as (values ('instrument.payment.credit_card_general'),('instrument.emoney.id'),('instrument.emoney.quicpay'),('instrument.emoney.rakuten_edy'),('instrument.emoney.transit_ic'),('instrument.emoney.waon')),
stores(location_key,source_url) as (values
 ('tokyo.shinjuku.gusto.nowa','https://store-info.skylark.co.jp/gusto/map/017756/'),
 ('tokyo.shibuya.gusto.station','https://store-info.skylark.co.jp/gusto/map/018972/'),
 ('tokyo.ikebukuro.gusto.sunshine-dori','https://store-info.skylark.co.jp/gusto/map/018923/'),
 ('tokyo.akihabara.gusto.station','https://store-info.skylark.co.jp/gusto/map/017715/'),
 ('tokyo.ginza.gusto.inz','https://store-info.skylark.co.jp/gusto/map/018966/')
), m as (select id from app_private.entities where entity_key='merchant.gusto')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,merchant_location_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select 'maf_gusto_'||regexp_replace(s.location_key,'[^a-z0-9]+','_','g')||'_'||regexp_replace(methods.entity_key,'[^a-z0-9]+','_','g'),m.id,ml.id,e.id,'pay','yes','branch','official_store_page','gusto-store-payment',s.source_url,now(),0.99,'{"store_page_explicit":true,"barcode_payment_details_not_promoted_without_explicit_text":true}'::jsonb,'active'
from stores s cross join methods cross join m
join app_private.merchant_locations ml on ml.location_key=s.location_key
join app_private.entities e on e.entity_key=methods.entity_key
on conflict(fact_key) do nothing;

-- Gusto supports Skylark Points plus one common point program; redemption is one program at a time.
with programs(entity_key) as (values ('program.jp.skylark'),('program.jp.rakutenpoint'),('program.jp.vpoint'),('program.jp.dpoint')),
actions(action) as (values ('earn'),('redeem')),
m as (select id from app_private.entities where entity_key='merchant.gusto')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select 'maf_gusto_'||regexp_replace(programs.entity_key,'[^a-z0-9]+','_','g')||'_'||actions.action,m.id,p.id,actions.action,'yes','chain_default','official_store_page','skylark-points','https://www.skylark.co.jp/skpoint/campaign/',now(),0.99,'{"gusto_in_supported_brand_list":true,"some_store_exceptions_possible":true}'::jsonb,'active'
from programs cross join actions cross join m join app_private.entities p on p.entity_key=programs.entity_key
on conflict(fact_key) do nothing;

with m as (select id from app_private.entities where entity_key='merchant.gusto'),
p as (select id from app_private.entities where entity_key='program.jp.skylark')
insert into app_private.merchant_tender_reward_facts(fact_key,merchant_entity_id,loyalty_program_entity_id,scope,rate_model,reward_units,spend_jpy,tax_basis,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status,component_kind,stacking_mode,choice_group,eligibility)
select 'mtr_gusto_skylark',m.id,p.id,'chain_default','points_per_spend',1,200,'tax_inclusive','floor','official_store_page','skylark-points','https://www.skylark.co.jp/skpoint/campaign/',now(),0.99,'{"value_jpy_per_point":1}'::jsonb,'active','merchant_loyalty','additive',null,'{"app_barcode_or_logged_in_table_payment_required":true,"stacks_with_exactly_one_common_point":true,"point_paid_amounts_excluded":true}'::jsonb
from m,p on conflict(fact_key) do nothing;

-- One of Rakuten/V/d can stack with the Skylark house point.
with programs(entity_key,tax_basis,source_url) as (values
 ('program.jp.rakutenpoint','tax_inclusive','https://www.skylark.co.jp/skpoint/campaign/'),
 ('program.jp.dpoint','tax_inclusive','https://www.skylark.co.jp/skpoint/campaign/'),
 ('program.jp.vpoint','tax_exclusive','https://www.skylark.co.jp/skpoint/campaign/')
), m as (select id from app_private.entities where entity_key='merchant.gusto')
insert into app_private.merchant_tender_reward_facts(fact_key,merchant_entity_id,loyalty_program_entity_id,scope,rate_model,reward_units,spend_jpy,tax_basis,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status,component_kind,stacking_mode,choice_group,eligibility)
select 'mtr_gusto_'||regexp_replace(programs.entity_key,'[^a-z0-9]+','_','g'),m.id,p.id,'chain_default','points_per_spend',1,200,programs.tax_basis,'floor','official_store_page','skylark-common-points',programs.source_url,now(),0.96,'{"official_skylark_double-presentation_rule":true}'::jsonb,'active','merchant_loyalty','exclusive_choice','gusto_common_point_card','{"stacks_with_skylark_points":true,"only_one_common_point_program":true}'::jsonb
from programs cross join m join app_private.entities p on p.entity_key=programs.entity_key
on conflict(fact_key) do nothing;

insert into app_private.merchant_enrichment_jobs(merchant_location_id,provider,enrichment_kind,priority,status,metadata)
select ml.id,'osm_overpass','coordinates',50,'pending',jsonb_build_object('reason','official Gusto location seeded without guessed coordinates')
from app_private.merchant_locations ml join app_private.entities e on e.id=ml.merchant_entity_id
where e.entity_key='merchant.gusto'
on conflict(merchant_location_id,provider,enrichment_kind) do nothing;

commit;
