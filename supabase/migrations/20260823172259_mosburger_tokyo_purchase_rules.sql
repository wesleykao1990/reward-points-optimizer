begin;

insert into app_private.entities(entity_key,entity_type,display_name,locale,metadata,status)
values
 ('merchant.mosburger','merchant','MOS Burger','ja-JP','{"category":"fast_food"}'::jsonb,'active'),
 ('instrument.mos.card','stored_value_program','MOS Card','ja-JP','{"mobile_card_supported":true}'::jsonb,'active'),
 ('program.jp.mospoint','loyalty_program','MOS Points','ja-JP','{"value_jpy_per_point":1,"rank_dependent_earning":true}'::jsonb,'active')
on conflict(entity_key) do update set display_name=excluded.display_name,metadata=app_private.entities.metadata||excluded.metadata,status='active',updated_at=now();

with m as (select id from app_private.entities where entity_key='merchant.mosburger'),
rows(location_key,display_name,address,google_place_id,area) as (values
 ('tokyo.shinjuku.mosburger.west-gate','モスバーガー 新宿西口店','{"postal_code":"160-0023","prefecture":"東京都","ward":"新宿区","street":"西新宿7-1-8","country_code":"JP"}'::jsonb,'ChIJKdESUJGNGGAReuO_-gbd6jY','shinjuku'),
 ('tokyo.shibuya.mosburger.dogenzaka','モスバーガー 渋谷道玄坂店','{"postal_code":"150-0043","prefecture":"東京都","ward":"渋谷区","street":"道玄坂2-29-8","country_code":"JP"}'::jsonb,'ChIJkYi8xKmMGGARWJ-A3arSpNw','shibuya'),
 ('tokyo.ikebukuro.mosburger.east','モスバーガー 池袋東店','{"postal_code":"170-0013","prefecture":"東京都","ward":"豊島区","street":"東池袋1-32-5","country_code":"JP"}'::jsonb,'ChIJYSpRjmaNGGAR6B0wFLwN8gQ','ikebukuro'),
 ('tokyo.akihabara.mosburger.suehirocho','モスバーガー 秋葉原末広町店','{"postal_code":"101-0021","prefecture":"東京都","ward":"千代田区","street":"外神田3-16-14","country_code":"JP"}'::jsonb,'ChIJ95eMcx6MGGAR3PwUvZxuJSQ','akihabara'),
 ('tokyo.ginza.mosburger.nishi-ginza','モスバーガー 西銀座店','{"postal_code":"104-0061","prefecture":"東京都","ward":"中央区","street":"銀座4-1","country_code":"JP"}'::jsonb,'ChIJpxlNouWLGGARLgpSxiRKrDE','ginza')
)
insert into app_private.merchant_locations(location_key,merchant_entity_id,display_name,address,external_place_ids,confidence,metadata)
select r.location_key,m.id,r.display_name,r.address,jsonb_build_object('google_place_id',r.google_place_id),'third_party',jsonb_build_object('launch_area',r.area,'identity_source','place_provider','official_locator_available','https://www.mos.jp/shop/')
from rows r cross join m
on conflict(location_key) do update set display_name=excluded.display_name,address=excluded.address,external_place_ids=app_private.merchant_locations.external_place_ids||excluded.external_place_ids,confidence='third_party',metadata=app_private.merchant_locations.metadata||excluded.metadata,updated_at=now();

with m as (select id from app_private.entities where entity_key='merchant.mosburger'),
card as (select id from app_private.entities where entity_key='instrument.mos.card'),
dp as (select id from app_private.entities where entity_key='program.jp.dpoint'),
mp as (select id from app_private.entities where entity_key='program.jp.mospoint')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select * from (
 select 'maf_mos_card_pay',m.id,card.id,'pay','yes','chain_default','official_store_page','mos-card','https://faq.mos.jp/%E3%83%A2%E3%82%B9%E3%82%AB%E3%83%BC%E3%83%89%E3%81%AE%E5%88%A9%E7%94%A8%E3%81%AF%E3%81%A7%E3%81%8D%E3%81%BE%E3%81%99%E3%81%8B-',now(),0.99,'{"in_store_supported":true,"network_order_supported":true}'::jsonb,'active' from m,card
 union all
 select 'maf_mos_dpoint_earn',m.id,dp.id,'earn','yes','chain_default','official_store_page','mos-dpoint-rate','https://faq.mos.jp/1%E5%9B%9E%E3%81%AE%E8%B3%BC%E5%85%A5%E3%81%A7%E4%BD%95%E3%83%9D%E3%82%A4%E3%83%B3%E3%83%88%E9%80%B2%E5%91%88%E3%81%95%E3%82%8C%E3%81%BE%E3%81%99%E3%81%8B-',now(),0.99,'{"some_special_store_exceptions_possible":true}'::jsonb,'active' from m,dp
 union all
 select 'maf_mos_dpoint_redeem',m.id,dp.id,'redeem','yes','chain_default','official_store_page','mos-dpoint-use','https://faq.mos.jp/%EF%BD%84%E3%83%9D%E3%82%A4%E3%83%B3%E3%83%88%E3%82%AF%E3%83%A9%E3%83%96%E3%82%B5%E3%82%A4%E3%83%88%E3%81%A7%EF%BD%84%E3%83%9D%E3%82%A4%E3%83%B3%E3%83%88%E3%81%AE%E5%88%A9%E7%94%A8%E8%80%85%E7%99%BB%E9%8C%B2%E3%81%AF%E3%81%BE%E3%81%A0%E8%A1%8C%E3%81%A3%E3%81%A6%E3%81%84%E3%81%AA%E3%81%84%E3%81%AE%E3%81%A7%E3%81%99%E3%81%8C-%EF%BD%84%E3%83%9D%E3%82%A4%E3%83%B3%E3%83%88%E3%81%AF%E4%BD%BF%E3%81%88%E3%81%BE%E3%81%99%E3%81%8B-',now(),0.99,'{"dpoint_user_registration_required_to_redeem":true}'::jsonb,'active' from m,dp
 union all
 select 'maf_mos_mospoint_redeem',m.id,mp.id,'redeem','yes','chain_default','official_store_page','mos-point-use','https://faq.mos.jp/mos%E3%83%9D%E3%82%A4%E3%83%B3%E3%83%88%E3%81%AF%E5%88%A9%E7%94%A8%E3%81%A7%E3%81%8D%E3%81%BE%E3%81%99%E3%81%8B-',now(),0.99,'{"network_order_explicit":true,"in_store_redemption_not_asserted":true}'::jsonb,'active' from m,mp
) q
on conflict(fact_key) do nothing;

with m as (select id from app_private.entities where entity_key='merchant.mosburger'),
dp as (select id from app_private.entities where entity_key='program.jp.dpoint')
insert into app_private.merchant_tender_reward_facts(fact_key,merchant_entity_id,loyalty_program_entity_id,scope,rate_model,reward_units,spend_jpy,tax_basis,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status,component_kind,stacking_mode,choice_group,eligibility)
select 'mtr_mos_dpoint_base',m.id,dp.id,'chain_default','points_per_spend',1,100,'tax_inclusive','floor','official_store_page','mos-dpoint-rate','https://faq.mos.jp/1%E5%9B%9E%E3%81%AE%E8%B3%BC%E5%85%A5%E3%81%A7%E4%BD%95%E3%83%9D%E3%82%A4%E3%83%B3%E3%83%88%E9%80%B2%E5%91%88%E3%81%95%E3%82%8C%E3%81%BE%E3%81%99%E3%81%8B-',now(),0.99,'{"normal_rate":true}'::jsonb,'active','merchant_loyalty','additive',null,'{"mos_card_web_charge_excluded":true,"coupon_or_subsidy_reduces_eligible_spend":true}'::jsonb
from m,dp
on conflict(fact_key) do nothing;

insert into app_private.merchant_enrichment_jobs(merchant_location_id,provider,enrichment_kind,priority,status,metadata)
select ml.id,'official_mos_locator','external_id',65,'pending',jsonb_build_object('reason','resolve stable official MOS store id and confirm branch payment capabilities')
from app_private.merchant_locations ml join app_private.entities e on e.id=ml.merchant_entity_id
where e.entity_key='merchant.mosburger'
on conflict(merchant_location_id,provider,enrichment_kind) do nothing;

commit;
