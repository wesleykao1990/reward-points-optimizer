begin;

insert into app_private.entities(entity_key,entity_type,display_name,locale,metadata,status)
values
 ('merchant.starbucks','merchant','Starbucks Coffee Japan','ja-JP','{"category":"cafe"}'::jsonb,'active'),
 ('instrument.starbucks.card','stored_value_program','Starbucks Card','ja-JP','{"registered_required_for_stars":true}'::jsonb,'active'),
 ('program.jp.starbucks-stars','loyalty_program','Starbucks Rewards Stars','ja-JP','{"native_unit":"Star"}'::jsonb,'active')
on conflict(entity_key) do update set display_name=excluded.display_name, metadata=app_private.entities.metadata||excluded.metadata, status='active', updated_at=now();

with merchant as (select id from app_private.entities where entity_key='merchant.starbucks'),
rows(location_key,display_name,address,store_id,launch_area,source_url,cashless_only) as (values
 ('tokyo.shinjuku.starbucks.shinjuku-3chome','スターバックス コーヒー 新宿３丁目店','{"postal_code":"160-0022","prefecture":"東京都","ward":"新宿区","street":"新宿3-11-6","site_detail":"エクレ新宿 1F","country_code":"JP"}'::jsonb,'12','shinjuku','https://store.starbucks.co.jp/detail-12/',false),
 ('tokyo.shibuya.starbucks.shibuya-tsutaya-1f','スターバックス コーヒー SHIBUYA TSUTAYA 1F店','{"postal_code":"150-0042","prefecture":"東京都","ward":"渋谷区","street":"宇田川町21-6","site_detail":"QFRONT 1F","country_code":"JP"}'::jsonb,'2311','shibuya','https://store.starbucks.co.jp/detail-2311/',true),
 ('tokyo.ikebukuro.starbucks.ikebukuro-meijidori','スターバックス コーヒー 池袋明治通り店','{"postal_code":"171-0022","prefecture":"東京都","ward":"豊島区","street":"南池袋1-18-17","site_detail":"I&Kビル 1F","country_code":"JP"}'::jsonb,'38','ikebukuro','https://store.starbucks.co.jp/detail-38/',false),
 ('tokyo.akihabara.starbucks.akihabara-ekimae','スターバックス コーヒー 秋葉原駅前店','{"postal_code":"101-0025","prefecture":"東京都","ward":"千代田区","street":"神田佐久間町1-6-5","site_detail":"AKIBA・TOLIM","country_code":"JP"}'::jsonb,'820','akihabara','https://store.starbucks.co.jp/detail-820/',false),
 ('tokyo.marunouchi.starbucks.yaechika','スターバックス コーヒー ヤエチカ店','{"postal_code":"104-0028","prefecture":"東京都","ward":"中央区","street":"八重洲2-1","site_detail":"八重洲地下街 中3号","country_code":"JP"}'::jsonb,'3','marunouchi','https://store.starbucks.co.jp/detail-3/',false),
 ('tokyo.ginza.starbucks.echikafit-ginza','スターバックス コーヒー エチカフィット銀座店','{"postal_code":"104-0061","prefecture":"東京都","ward":"中央区","street":"銀座4-1-2","site_detail":"東京メトロ銀座駅構内","country_code":"JP"}'::jsonb,'1840','ginza','https://store.starbucks.co.jp/detail-1840/',false)
)
insert into app_private.merchant_locations(location_key,merchant_entity_id,display_name,address,external_place_ids,confidence,metadata)
select r.location_key,m.id,r.display_name,r.address,jsonb_build_object('starbucks_store_id',r.store_id),'official_directory',jsonb_build_object('launch_area',r.launch_area,'official_source_url',r.source_url,'cashless_only',r.cashless_only)
from rows r cross join merchant m
on conflict(location_key) do update set display_name=excluded.display_name,address=excluded.address,external_place_ids=app_private.merchant_locations.external_place_ids||excluded.external_place_ids,confidence='official_directory',metadata=app_private.merchant_locations.metadata||excluded.metadata,updated_at=now();

-- Starbucks Card is the chain-native tender; Stars accrue only on registered-card payment.
with m as (select id from app_private.entities where entity_key='merchant.starbucks'),
card as (select id from app_private.entities where entity_key='instrument.starbucks.card'),
stars as (select id from app_private.entities where entity_key='program.jp.starbucks-stars')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select * from (
 select 'maf_starbucks_card_pay',m.id,card.id,'pay','yes','chain_default','official_store_page','starbucks-card','https://www.starbucks.co.jp/card/',now(),0.99,'{"basis":"official Starbucks Card page"}'::jsonb,'active' from m,card
 union all
 select 'maf_starbucks_stars_earn',m.id,stars.id,'earn','yes','chain_default','official_store_page','starbucks-rewards','https://www.starbucks.co.jp/rewards/',now(),0.99,'{"requires_registered_starbucks_card":true}'::jsonb,'active' from m,stars
) q
on conflict(fact_key) do nothing;

-- Store pages explicitly enumerate mobile/e-money methods; omitted methods remain unknown, not false.
with method_map(instrument_key) as (values
 ('instrument.emoney.transit_ic'),('instrument.wallet.paypay'),('instrument.wallet.dbarai'),('instrument.wallet.rakutenpay'),('instrument.wallet.aupay'),('instrument.wallet.alipay'),('instrument.wallet.wechatpay')
), stores(location_key,source_url,has_transit,has_wechat) as (values
 ('tokyo.shinjuku.starbucks.shinjuku-3chome','https://store.starbucks.co.jp/detail-12/',true,true),
 ('tokyo.shibuya.starbucks.shibuya-tsutaya-1f','https://store.starbucks.co.jp/detail-2311/',true,true),
 ('tokyo.ikebukuro.starbucks.ikebukuro-meijidori','https://store.starbucks.co.jp/detail-38/',true,false),
 ('tokyo.akihabara.starbucks.akihabara-ekimae','https://store.starbucks.co.jp/detail-820/',true,true),
 ('tokyo.marunouchi.starbucks.yaechika','https://store.starbucks.co.jp/detail-3/',true,true),
 ('tokyo.ginza.starbucks.echikafit-ginza','https://store.starbucks.co.jp/detail-1840/',false,true)
), resolved as (
 select s.location_key,s.source_url,mm.instrument_key
 from stores s cross join method_map mm
 where (mm.instrument_key<>'instrument.emoney.transit_ic' or s.has_transit)
   and (mm.instrument_key<>'instrument.wallet.wechatpay' or s.has_wechat)
), m as (select id from app_private.entities where entity_key='merchant.starbucks')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,merchant_location_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select 'maf_starbucks_'||regexp_replace(r.location_key,'[^a-z0-9]+','_','g')||'_'||regexp_replace(r.instrument_key,'[^a-z0-9]+','_','g'),
       m.id,ml.id,ie.id,'pay','yes','branch','official_store_page','starbucks-store-mobile-payments',r.source_url,now(),0.99,jsonb_build_object('store_page_explicit',true),'active'
from resolved r cross join m
join app_private.merchant_locations ml on ml.location_key=r.location_key
join app_private.entities ie on ie.entity_key=r.instrument_key
on conflict(fact_key) do nothing;

-- Native Starbucks Rewards formula: registered Starbucks Card payments earn 1 Star per 60 JPY incl. tax.
with m as (select id from app_private.entities where entity_key='merchant.starbucks'),
stars as (select id from app_private.entities where entity_key='program.jp.starbucks-stars'),
card as (select id from app_private.entities where entity_key='instrument.starbucks.card')
insert into app_private.merchant_tender_reward_facts(fact_key,merchant_entity_id,loyalty_program_entity_id,payment_instrument_entity_id,scope,rate_model,reward_units,spend_jpy,tax_basis,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status,component_kind,stacking_mode,choice_group,eligibility)
select 'mtr_starbucks_stars_registered_card',m.id,stars.id,card.id,'chain_default','points_per_spend',1,60,'tax_inclusive','floor','official_store_page','starbucks-rewards-card','https://www.starbucks.co.jp/card/',now(),0.99,'{"native_unit":"Star"}'::jsonb,'active','merchant_loyalty','additive',null,'{"requires_registered_starbucks_card":true}'::jsonb
from m,stars,card
on conflict(fact_key) do nothing;

insert into app_private.merchant_enrichment_jobs(merchant_location_id,provider,enrichment_kind,priority,status,metadata)
select ml.id,'osm_overpass','coordinates',60,'pending',jsonb_build_object('reason','official Starbucks location seeded without guessed coordinates')
from app_private.merchant_locations ml
join app_private.entities e on e.id=ml.merchant_entity_id
where e.entity_key='merchant.starbucks'
on conflict(merchant_location_id,provider,enrichment_kind) do nothing;

commit;
