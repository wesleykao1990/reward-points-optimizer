begin;

insert into app_private.entities(entity_key,entity_type,display_name,locale,metadata,status)
values ('merchant.kurasushi','merchant','Kura Sushi','ja-JP','{"category":"conveyor_belt_sushi"}'::jsonb,'active')
on conflict(entity_key) do update set display_name=excluded.display_name,metadata=app_private.entities.metadata||excluded.metadata,status='active',updated_at=now();

with m as (select id from app_private.entities where entity_key='merchant.kurasushi'),
rows(location_key,display_name,address,store_id,area,source_url) as (values
 ('tokyo.shibuya.kurasushi.shibuya-ekimae','くら寿司 渋谷駅前店','{"postal_code":"150-0042","prefecture":"東京都","ward":"渋谷区","street":"宇田川町23-3","site_detail":"渋谷第一勧銀共同ビル7F","country_code":"JP"}'::jsonb,'557','shibuya','https://shop.kurasushi.co.jp/detail/557'),
 ('tokyo.shibuya.kurasushi.harajuku','くら寿司 グローバル旗艦店 原宿','{"postal_code":"150-0001","prefecture":"東京都","ward":"渋谷区","street":"神宮前4-31-10","site_detail":"ワイ・エム・スクウェア原宿4F","country_code":"JP"}'::jsonb,'583','harajuku','https://shop.kurasushi.co.jp/detail/583'),
 ('tokyo.ikebukuro.kurasushi.east-exit','くら寿司 池袋東口店','{"postal_code":"171-0022","prefecture":"東京都","ward":"豊島区","street":"南池袋1-19-5","site_detail":"Gビル南池袋01 B1F","country_code":"JP"}'::jsonb,'403','ikebukuro','https://shop.kurasushi.co.jp/detail/403'),
 ('tokyo.shinjuku.kurasushi.nishi-shinjuku','くら寿司 西新宿店','{"postal_code":"160-0023","prefecture":"東京都","ward":"新宿区","street":"西新宿7-1-7","site_detail":"新宿ダイカンプラザA館2F","country_code":"JP"}'::jsonb,'558','shinjuku','https://shop.kurasushi.co.jp/detail/558'),
 ('tokyo.ginza.kurasushi.global','くら寿司 グローバル旗艦店 銀座','{"postal_code":"104-0061","prefecture":"東京都","ward":"中央区","street":"銀座3-2-1","site_detail":"マロニエゲート銀座2 7F","country_code":"JP"}'::jsonb,'641','ginza','https://shop.kurasushi.co.jp/detail/641')
)
insert into app_private.merchant_locations(location_key,merchant_entity_id,display_name,address,external_place_ids,confidence,metadata)
select r.location_key,m.id,r.display_name,r.address,jsonb_build_object('kurasushi_store_id',r.store_id),'official_directory',jsonb_build_object('launch_area',r.area,'official_source_url',r.source_url)
from rows r cross join m
on conflict(location_key) do update set display_name=excluded.display_name,address=excluded.address,external_place_ids=app_private.merchant_locations.external_place_ids||excluded.external_place_ids,confidence='official_directory',metadata=app_private.merchant_locations.metadata||excluded.metadata,updated_at=now();

-- Current Kura store pages explicitly enumerate these mainstream payment methods.
with methods(entity_key) as (values
 ('instrument.payment.credit_card_general'),('instrument.wallet.rakutenpay'),('instrument.wallet.paypay'),('instrument.wallet.dbarai'),('instrument.wallet.alipay'),('instrument.wallet.wechatpay'),('instrument.wallet.quocardpay'),('instrument.wallet.aeonpay'),('instrument.wallet.aupay'),('instrument.wallet.famipay'),('instrument.wallet.merpay')
), stores(location_key,source_url) as (values
 ('tokyo.shibuya.kurasushi.shibuya-ekimae','https://shop.kurasushi.co.jp/detail/557'),
 ('tokyo.shibuya.kurasushi.harajuku','https://shop.kurasushi.co.jp/detail/583'),
 ('tokyo.ikebukuro.kurasushi.east-exit','https://shop.kurasushi.co.jp/detail/403'),
 ('tokyo.shinjuku.kurasushi.nishi-shinjuku','https://shop.kurasushi.co.jp/detail/558'),
 ('tokyo.ginza.kurasushi.global','https://shop.kurasushi.co.jp/detail/641')
), m as (select id from app_private.entities where entity_key='merchant.kurasushi')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,merchant_location_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select 'maf_kura_'||regexp_replace(s.location_key,'[^a-z0-9]+','_','g')||'_'||regexp_replace(methods.entity_key,'[^a-z0-9]+','_','g'),m.id,ml.id,e.id,'pay','yes','branch','official_store_page','kurasushi-store-payment',s.source_url,now(),0.99,
 jsonb_build_object('store_page_explicit',true,'payment_list_is_subset_of_full_explicit_store_list',true),'active'
from stores s cross join methods cross join m
join app_private.merchant_locations ml on ml.location_key=s.location_key
join app_private.entities e on e.entity_key=methods.entity_key
on conflict(fact_key) do nothing;

with m as (select id from app_private.entities where entity_key='merchant.kurasushi'),
p as (select id from app_private.entities where entity_key='program.jp.rakutenpoint'),
actions(action) as (values ('earn'),('redeem'))
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select 'maf_kura_rakutenpoint_'||actions.action,m.id,p.id,actions.action,'yes','chain_default','official_store_page','kurasushi-rakuten-point','https://www.kurasushi.co.jp/topic/',now(),0.99,'{"nationwide_kurasushi":true}'::jsonb,'active'
from m,p,actions
on conflict(fact_key) do nothing;

with m as (select id from app_private.entities where entity_key='merchant.kurasushi'),
p as (select id from app_private.entities where entity_key='program.jp.rakutenpoint')
insert into app_private.merchant_tender_reward_facts(fact_key,merchant_entity_id,loyalty_program_entity_id,scope,rate_model,reward_units,spend_jpy,tax_basis,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status,component_kind,stacking_mode,choice_group,eligibility)
select 'mtr_kura_rakutenpoint_base',m.id,p.id,'chain_default','points_per_spend',1,200,'tax_exclusive','floor','official_store_page','kurasushi-rakuten-normal-rate','https://www.kurasushi.co.jp/author/006507.html',now(),0.99,'{"normal_rate_confirmed_by_official_campaign_release":true}'::jsonb,'active','merchant_loyalty','additive',null,'{"rakuten_point_card_presentation_required":true,"minimum_eligible_spend_jpy":200}'::jsonb
from m,p
on conflict(fact_key) do nothing;

insert into app_private.merchant_enrichment_jobs(merchant_location_id,provider,enrichment_kind,priority,status,metadata)
select ml.id,'osm_overpass','coordinates',55,'pending',jsonb_build_object('reason','official Kura Sushi location seeded without guessed coordinates')
from app_private.merchant_locations ml join app_private.entities e on e.id=ml.merchant_entity_id
where e.entity_key='merchant.kurasushi'
on conflict(merchant_location_id,provider,enrichment_kind) do nothing;

commit;
