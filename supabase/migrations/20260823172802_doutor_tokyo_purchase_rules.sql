begin;

insert into app_private.entities(entity_key,entity_type,display_name,locale,metadata,status)
values
 ('merchant.doutor','merchant','Doutor Coffee Shop','ja-JP','{"category":"cafe"}'::jsonb,'active'),
 ('instrument.doutor.valuecard','stored_value_program','Doutor Value Card','ja-JP','{"network":"doutor_value_card"}'::jsonb,'active'),
 ('program.jp.doutor-value','loyalty_program','Doutor Value Points','ja-JP','{"value_jpy_per_point":1}'::jsonb,'active'),
 ('instrument.wallet.yuchopay','qr_wallet','Yucho Pay','ja-JP','{}'::jsonb,'active')
on conflict(entity_key) do update set display_name=excluded.display_name,metadata=app_private.entities.metadata||excluded.metadata,status='active',updated_at=now();

with m as (select id from app_private.entities where entity_key='merchant.doutor'),
rows(location_key,display_name,address,store_code,area,source_url) as (values
 ('tokyo.harajuku.doutor.harajuku','ドトールコーヒーショップ 原宿店','{"postal_code":"150-0001","prefecture":"東京都","ward":"渋谷区","street":"神宮前1-13-18","site_detail":"第2大英ビル","country_code":"JP"}'::jsonb,'1010451','harajuku','https://shop.doutor.co.jp/doutor/spot/detail?code=1010451'),
 ('tokyo.yoyogi.doutor.yoyogi','ドトールコーヒーショップ 代々木店','{"postal_code":"151-0053","prefecture":"東京都","ward":"渋谷区","street":"代々木1-36-7","site_detail":"代々木駅前ビル1F","country_code":"JP"}'::jsonb,'1010016','yoyogi','https://shop.doutor.co.jp/doutor/spot/detail?code=1010016'),
 ('tokyo.ikebukuro.doutor.mejiro-ekimae','ドトールコーヒーショップ 目白駅前店','{"postal_code":"171-0031","prefecture":"東京都","ward":"豊島区","street":"目白3-14-3","site_detail":"グロワルビル","country_code":"JP"}'::jsonb,'1010563','ikebukuro','https://shop.doutor.co.jp/doutor/spot/detail?code=1010563'),
 ('tokyo.marunouchi.doutor.tokyo-yaesu-central','ドトールコーヒーショップ 東京駅八重洲中央口店','{"postal_code":"100-0005","prefecture":"東京都","ward":"千代田区","street":"丸の内1-9-1","country_code":"JP"}'::jsonb,'1012508','marunouchi','https://shop.doutor.co.jp/doutor/spot/detail?code=1012508'),
 ('tokyo.ginza.doutor.yurakucho-ekimae','ドトールコーヒーショップ 有楽町駅前店','{"postal_code":"100-0005","prefecture":"東京都","ward":"千代田区","street":"丸の内3-6-11","country_code":"JP"}'::jsonb,'1012237','ginza','https://shop.doutor.co.jp/doutor/spot/detail?code=1012237'),
 ('tokyo.marunouchi.doutor.toei-otemachi','ドトールコーヒーショップ 都営大手町店','{"postal_code":"100-0005","prefecture":"東京都","ward":"千代田区","street":"丸の内1-3-1","site_detail":"都営地下鉄三田線大手町駅改札前 B1F","country_code":"JP"}'::jsonb,'1011194','marunouchi','https://shop.doutor.co.jp/doutor/spot/detail?code=1011194')
)
insert into app_private.merchant_locations(location_key,merchant_entity_id,display_name,address,external_place_ids,confidence,metadata)
select r.location_key,m.id,r.display_name,r.address,jsonb_build_object('doutor_store_code',r.store_code),'official_directory',jsonb_build_object('launch_area',r.area,'official_source_url',r.source_url)
from rows r cross join m
on conflict(location_key) do update set display_name=excluded.display_name,address=excluded.address,external_place_ids=app_private.merchant_locations.external_place_ids||excluded.external_place_ids,confidence='official_directory',metadata=app_private.merchant_locations.metadata||excluded.metadata,updated_at=now();

with methods(entity_key) as (values
 ('instrument.doutor.valuecard'),('instrument.wallet.paypay'),('instrument.wallet.dbarai'),('instrument.wallet.rakutenpay'),('instrument.wallet.aupay'),('instrument.wallet.aeonpay'),('instrument.wallet.merpay'),('instrument.wallet.quocardpay'),('instrument.wallet.yuchopay'),('instrument.wallet.alipay'),('instrument.wallet.wechatpay'),('instrument.emoney.transit_ic'),('instrument.emoney.id'),('instrument.emoney.quicpay'),('instrument.payment.credit_card_general')
), stores(location_key,source_url) as (values
 ('tokyo.harajuku.doutor.harajuku','https://shop.doutor.co.jp/doutor/spot/detail?code=1010451'),
 ('tokyo.yoyogi.doutor.yoyogi','https://shop.doutor.co.jp/doutor/spot/detail?code=1010016'),
 ('tokyo.ikebukuro.doutor.mejiro-ekimae','https://shop.doutor.co.jp/doutor/spot/detail?code=1010563'),
 ('tokyo.marunouchi.doutor.tokyo-yaesu-central','https://shop.doutor.co.jp/doutor/spot/detail?code=1012508'),
 ('tokyo.ginza.doutor.yurakucho-ekimae','https://shop.doutor.co.jp/doutor/spot/detail?code=1012237'),
 ('tokyo.marunouchi.doutor.toei-otemachi','https://shop.doutor.co.jp/doutor/spot/detail?code=1011194')
), m as (select id from app_private.entities where entity_key='merchant.doutor')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,merchant_location_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select 'maf_doutor_'||regexp_replace(s.location_key,'[^a-z0-9]+','_','g')||'_'||regexp_replace(methods.entity_key,'[^a-z0-9]+','_','g'),m.id,ml.id,e.id,'pay','yes','branch','official_store_page','doutor-store-payment',s.source_url,now(),0.99,'{"store_page_explicit":true}'::jsonb,'active'
from stores s cross join methods cross join m
join app_private.merchant_locations ml on ml.location_key=s.location_key
join app_private.entities e on e.entity_key=methods.entity_key
on conflict(fact_key) do nothing;

with programs(entity_key) as (values ('program.jp.dpoint'),('program.jp.vpoint'),('program.jp.ponta'),('program.jp.waonpoint')),
actions(action) as (values ('earn'),('redeem')),
stores(location_key,source_url) as (values
 ('tokyo.harajuku.doutor.harajuku','https://shop.doutor.co.jp/doutor/spot/detail?code=1010451'),
 ('tokyo.yoyogi.doutor.yoyogi','https://shop.doutor.co.jp/doutor/spot/detail?code=1010016'),
 ('tokyo.ikebukuro.doutor.mejiro-ekimae','https://shop.doutor.co.jp/doutor/spot/detail?code=1010563'),
 ('tokyo.marunouchi.doutor.tokyo-yaesu-central','https://shop.doutor.co.jp/doutor/spot/detail?code=1012508'),
 ('tokyo.ginza.doutor.yurakucho-ekimae','https://shop.doutor.co.jp/doutor/spot/detail?code=1012237'),
 ('tokyo.marunouchi.doutor.toei-otemachi','https://shop.doutor.co.jp/doutor/spot/detail?code=1011194')
), m as (select id from app_private.entities where entity_key='merchant.doutor')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,merchant_location_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select 'maf_doutor_'||regexp_replace(s.location_key,'[^a-z0-9]+','_','g')||'_'||regexp_replace(programs.entity_key,'[^a-z0-9]+','_','g')||'_'||actions.action,m.id,ml.id,p.id,actions.action,'yes','branch','official_store_page','doutor-store-points',s.source_url,now(),0.99,'{"store_page_explicit":true,"vpoint_mobile_card_only":true}'::jsonb,'active'
from stores s cross join programs cross join actions cross join m
join app_private.merchant_locations ml on ml.location_key=s.location_key
join app_private.entities p on p.entity_key=programs.entity_key
on conflict(fact_key) do nothing;

with m as (select id from app_private.entities where entity_key='merchant.doutor'),
vp as (select id from app_private.entities where entity_key='program.jp.doutor-value'),
vc as (select id from app_private.entities where entity_key='instrument.doutor.valuecard')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select * from (
 select 'maf_doutor_valuepoint_earn',m.id,vp.id,'earn','yes','chain_default','official_store_page','doutor-value-card','https://www.doutor.co.jp/dvc/',now(),0.99,'{"requires_value_card_payment":true}'::jsonb,'active' from m,vp
 union all
 select 'maf_doutor_valuepoint_redeem',m.id,vp.id,'redeem','yes','chain_default','official_store_page','doutor-value-card','https://www.doutor.co.jp/dvc/',now(),0.99,'{"value_jpy_per_point":1}'::jsonb,'active' from m,vp
) q on conflict(fact_key) do nothing;

-- Base Value Card purchase earn: 1 Value Point per 100 JPY. Conservatively exclusive with common point presentation until coexistence evidence is explicit.
with m as (select id from app_private.entities where entity_key='merchant.doutor'),vp as (select id from app_private.entities where entity_key='program.jp.doutor-value'),vc as (select id from app_private.entities where entity_key='instrument.doutor.valuecard')
insert into app_private.merchant_tender_reward_facts(fact_key,merchant_entity_id,loyalty_program_entity_id,payment_instrument_entity_id,scope,rate_model,reward_units,spend_jpy,tax_basis,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status,component_kind,stacking_mode,choice_group,eligibility,channel)
select 'mtr_doutor_valuecard_base',m.id,vp.id,vc.id,'chain_default','points_per_spend',1,100,'tax_inclusive','floor','official_store_page','doutor-value-card','https://www.doutor.co.jp/dvc/',now(),0.99,'{"purchase_rate":true,"charge_bonus_separate":true}'::jsonb,'active','merchant_loyalty','exclusive_choice','doutor_loyalty_choice','{"requires_value_card_payment":true,"common_point_stacking_conservatively_disabled":true}'::jsonb,'in_store'
from m,vp,vc on conflict(fact_key) do nothing;

-- d/V/Ponta/WAON: 1 point per 200 JPY incl tax. Current payment page confirms all four; d has a current direct rate page, the other three retain the officially introduced rate and current availability.
with programs(entity_key,source_url,source_note) as (values
 ('program.jp.dpoint','https://www.doutor.co.jp/dcs/service/d-point.html','current_direct_rate'),
 ('program.jp.vpoint','https://www.doutor.co.jp/news/newsrelease/detail/20230703133534.html','T-point successor now displayed as V Point on current store/payment pages'),
 ('program.jp.ponta','https://www.doutor.co.jp/news/newsrelease/detail/20230703133534.html','official introduced rate + current store availability'),
 ('program.jp.waonpoint','https://www.doutor.co.jp/news/newsrelease/detail/20230703133534.html','official introduced rate + current store availability')
),m as (select id from app_private.entities where entity_key='merchant.doutor')
insert into app_private.merchant_tender_reward_facts(fact_key,merchant_entity_id,loyalty_program_entity_id,scope,rate_model,reward_units,spend_jpy,tax_basis,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status,component_kind,stacking_mode,choice_group,eligibility,channel)
select 'mtr_doutor_'||regexp_replace(programs.entity_key,'[^a-z0-9]+','_','g'),m.id,p.id,'chain_default','points_per_spend',1,200,'tax_inclusive','floor','official_store_page','doutor-common-points',programs.source_url,now(),case when programs.entity_key='program.jp.dpoint' then 0.99 else 0.96 end,jsonb_build_object('source_note',programs.source_note),'active','merchant_loyalty','exclusive_choice','doutor_loyalty_choice',jsonb_build_object('one_common_point_program_at_checkout',true,'value_card_stacking_conservatively_disabled',true),'in_store'
from programs cross join m join app_private.entities p on p.entity_key=programs.entity_key
on conflict(fact_key) do nothing;

-- Current August 2026 campaign: 5% Value Points on cumulative Value Card spend, cap 150 points.
with m as (select id from app_private.entities where entity_key='merchant.doutor'),vp as (select id from app_private.entities where entity_key='program.jp.doutor-value'),vc as (select id from app_private.entities where entity_key='instrument.doutor.valuecard')
insert into app_private.merchant_tender_reward_facts(fact_key,merchant_entity_id,loyalty_program_entity_id,payment_instrument_entity_id,scope,rate_model,rate_percent,tax_basis,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,valid_from,valid_to,provenance,status,component_kind,stacking_mode,choice_group,eligibility,channel)
select 'mtr_doutor_valuecard_aug2026_campaign',m.id,vp.id,vc.id,'chain_default','points_percent',5,'unknown','unknown','official_store_page','doutor-2026summer','https://www.doutor.co.jp/news/newsrelease/detail/20260729153158.html',now(),0.99,'2026-08-01T00:00:00+09'::timestamptz,'2026-09-01T00:00:00+09'::timestamptz,'{"campaign_current_on_2026-08-23":true}'::jsonb,'active','campaign_bonus','additive',null,'{"cumulative_period":"2026-08-01/2026-08-31","max_reward_units":150,"point_redemption_excluded":true,"card_charge_excluded":true,"target_value_card_stores_only":true}'::jsonb,'in_store'
from m,vp,vc on conflict(fact_key) do nothing;

commit;
