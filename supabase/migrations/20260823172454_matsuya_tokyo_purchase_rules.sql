begin;

insert into app_private.entities(entity_key,entity_type,display_name,locale,metadata,status)
values
 ('merchant.matsuya','merchant','Matsuya','ja-JP','{"category":"fast_food","group":"matsuya_foods"}'::jsonb,'active'),
 ('program.jp.matsuya-point','loyalty_program','Matsuya Points','ja-JP','{"value_jpy_per_point":1,"expiry":"1 year from last eligible service use or qualifying point acquisition"}'::jsonb,'active')
on conflict(entity_key) do update set display_name=excluded.display_name,metadata=app_private.entities.metadata||excluded.metadata,status='active',updated_at=now();

with m as (select id from app_private.entities where entity_key='merchant.matsuya'),
rows(location_key,display_name,address,place_id,area,identity_source) as (values
 ('tokyo.shinjuku.matsuya.shinjuku-3chome','松屋 新宿3丁目店','{"prefecture":"東京都","ward":"新宿区","street":"新宿3-11-11","site_detail":"ダイアン新宿ビル","country_code":"JP"}'::jsonb,null::text,'shinjuku','official_matsuben_directory'),
 ('tokyo.shinjuku.matsuya.oguard','松屋 新宿大ガード店','{"prefecture":"東京都","ward":"新宿区","street":"西新宿1-2-1","site_detail":"ファイブKビル1F","country_code":"JP"}'::jsonb,null::text,'shinjuku','official_matsuben_directory'),
 ('tokyo.shibuya.matsuya.dogenzakaue','松屋 渋谷道玄坂上店','{"postal_code":"150-0043","prefecture":"東京都","ward":"渋谷区","street":"道玄坂1-18-8","site_detail":"渋谷道玄坂プラザ仁科屋ビル","country_code":"JP"}'::jsonb,'ChIJz-3wCFaLGGARjwP3AxCKnk0','shibuya','official_plus_place_provider'),
 ('tokyo.ikebukuro.matsuya.minami','松屋 南池袋店','{"postal_code":"171-0022","prefecture":"東京都","ward":"豊島区","street":"南池袋1-18-23","site_detail":"ルックハイツ池袋B棟","country_code":"JP"}'::jsonb,'ChIJb7OQH2iNGGARhPheUAEwS1M','ikebukuro','place_provider'),
 ('tokyo.akihabara.matsuya.akihabara','松屋 秋葉原店','{"postal_code":"101-0023","prefecture":"東京都","ward":"千代田区","street":"神田松永町1","site_detail":"秋葉原ファーストビル1F","country_code":"JP"}'::jsonb,'ChIJ6dwt1KeOGGAR0PWiJWW9Tx0','akihabara','official_plus_place_provider')
)
insert into app_private.merchant_locations(location_key,merchant_entity_id,display_name,address,external_place_ids,confidence,metadata)
select r.location_key,m.id,r.display_name,r.address,
       case when r.place_id is null then '{}'::jsonb else jsonb_build_object('google_place_id',r.place_id) end,
       case when r.identity_source like 'official%' then 'official_directory' else 'third_party' end,
       jsonb_build_object('launch_area',r.area,'identity_source',r.identity_source,'official_directory','https://bento.matsuyafoods.co.jp/matsuben-net/shop')
from rows r cross join m
on conflict(location_key) do update set display_name=excluded.display_name,address=excluded.address,external_place_ids=app_private.merchant_locations.external_place_ids||excluded.external_place_ids,confidence=excluded.confidence,metadata=app_private.merchant_locations.metadata||excluded.metadata,updated_at=now();

-- Official Matsuya in-store QR page establishes QR-code payment support, with exceptions for some non-kiosk/self-register stores.
with m as (select id from app_private.entities where entity_key='merchant.matsuya'),
qr as (select id from app_private.entities where entity_key='instrument.wallet.barcode_generic')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select 'maf_matsuya_qr_pay',m.id,qr.id,'pay','yes','chain_default','official_store_page','matsuya-qr-payment','https://www.matsuyafoods.co.jp/qr_payment/',now(),0.96,
       '{"channel":"in_store","exceptions":"some stores without ticket machine/self-register may not support some QR payments","smart_code_supported":true}'::jsonb,'active'
from m,qr
on conflict(fact_key) do nothing;

-- Current official rank schedule. Matsuya Points are channel-specific and must not be exposed as an in-store presentation point card.
with m as (select id from app_private.entities where entity_key='merchant.matsuya'),
p as (select id from app_private.entities where entity_key='program.jp.matsuya-point'),
rules(rank_name,min_spend,max_spend,mobile_rate,matsuben_rate) as (values
 ('bronze',0,1499,1::numeric,6::numeric),
 ('silver',1500,2999,3::numeric,10::numeric),
 ('gold',3000,4499,4::numeric,11::numeric),
 ('platinum',4500,9999,5::numeric,12::numeric),
 ('diamond',10000,null::integer,7::numeric,15::numeric)
)
insert into app_private.merchant_tender_reward_facts(fact_key,merchant_entity_id,loyalty_program_entity_id,scope,rate_model,rate_percent,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status,component_kind,stacking_mode,choice_group,eligibility,tax_basis,channel)
select 'mtr_matsuya_mobile_'||rank_name,m.id,p.id,'chain_default','points_percent',mobile_rate,'floor','official_store_page','matsuya-point-ranks','https://bento.matsuyafoods.co.jp/matsuben-net/app/point.html',now(),0.99,
       jsonb_build_object('rank',rank_name,'official_2026_schedule',true),'active','merchant_loyalty','exclusive_choice','matsuya_mobile_order_rank',
       jsonb_build_object('rank',rank_name,'monthly_spend_min_jpy',min_spend,'monthly_spend_max_jpy',max_spend,'eligible_amount_excludes_points_used',true,'service','matsuya_mobile_order'),'unknown','mobile_order'
from m,p,rules
union all
select 'mtr_matsuya_matsuben_'||rank_name,m.id,p.id,'chain_default','points_percent',matsuben_rate,'floor','official_store_page','matsuya-point-ranks','https://bento.matsuyafoods.co.jp/matsuben-net/app/point.html',now(),0.99,
       jsonb_build_object('rank',rank_name,'official_2026_schedule',true),'active','merchant_loyalty','exclusive_choice','matsuya_matsuben_rank',
       jsonb_build_object('rank',rank_name,'monthly_spend_min_jpy',min_spend,'monthly_spend_max_jpy',max_spend,'eligible_amount_excludes_points_used',true,'service','matsuben'),'unknown','matsuben'
from m,p,rules
on conflict(fact_key) do nothing;

insert into app_private.merchant_enrichment_jobs(merchant_location_id,provider,enrichment_kind,priority,status,metadata)
select ml.id,'official_matsuben_directory','external_id',55,'pending',jsonb_build_object('reason','resolve stable official Matsuya store id and exact in-store payment capabilities')
from app_private.merchant_locations ml join app_private.entities e on e.id=ml.merchant_entity_id
where e.entity_key='merchant.matsuya'
on conflict(merchant_location_id,provider,enrichment_kind) do nothing;

commit;
