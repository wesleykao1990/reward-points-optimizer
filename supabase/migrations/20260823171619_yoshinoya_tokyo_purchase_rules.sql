begin;

insert into app_private.entities(entity_key,entity_type,display_name,locale,metadata,status)
values
 ('merchant.yoshinoya','merchant','Yoshinoya','ja-JP','{"category":"fast_food"}'::jsonb,'active'),
 ('instrument.yoshinoya.prepaid','stored_value_program','Yoshinoya Prepaid Card','ja-JP','{}'::jsonb,'active')
on conflict(entity_key) do update set display_name=excluded.display_name,metadata=app_private.entities.metadata||excluded.metadata,status='active',updated_at=now();

with m as (select id from app_private.entities where entity_key='merchant.yoshinoya'),
rows(location_key,display_name,address,store_code,area,source_url) as (values
 ('tokyo.shinjuku.yoshinoya.yasukuni','吉野家 新宿靖国通り店','{"postal_code":"160-0021","prefecture":"東京都","ward":"新宿区","street":"歌舞伎町1-6-3","country_code":"JP"}'::jsonb,'ysn_061489','shinjuku','https://stores.yoshinoya.com/yoshinoya/spot/detail?code=ysn_061489'),
 ('tokyo.shibuya.yoshinoya.dogenzaka','吉野家 渋谷道玄坂通店','{"postal_code":"150-0043","prefecture":"東京都","ward":"渋谷区","street":"道玄坂2-25-12","country_code":"JP"}'::jsonb,'ysn_061515','shibuya','https://stores.yoshinoya.com/yoshinoya/spot/detail?code=ysn_061515'),
 ('tokyo.ikebukuro.yoshinoya.north-exit','吉野家 池袋北口店','{"prefecture":"東京都","ward":"豊島区","site_detail":"池袋北口エリア","country_code":"JP"}'::jsonb,'ysn_041448','ikebukuro','https://stores.yoshinoya.com/yoshinoya/spot/detail?code=ysn_041448'),
 ('tokyo.akihabara.yoshinoya.akihabara','吉野家 秋葉原店','{"postal_code":"101-0023","prefecture":"東京都","ward":"千代田区","street":"神田松永町10-1","country_code":"JP"}'::jsonb,'ysn_041492','akihabara','https://stores.yoshinoya.com/yoshinoya/spot/detail?code=ysn_041492'),
 ('tokyo.ginza.yoshinoya.higashi-ginza','吉野家 東銀座店','{"postal_code":"104-0061","prefecture":"東京都","ward":"中央区","street":"銀座3-11-11","country_code":"JP"}'::jsonb,'ysn_041458','ginza','https://stores.yoshinoya.com/yoshinoya/spot/detail?code=ysn_041458')
)
insert into app_private.merchant_locations(location_key,merchant_entity_id,display_name,address,external_place_ids,confidence,metadata)
select r.location_key,m.id,r.display_name,r.address,jsonb_build_object('yoshinoya_store_code',r.store_code),'official_directory',jsonb_build_object('launch_area',r.area,'official_source_url',r.source_url)
from rows r cross join m
on conflict(location_key) do update set display_name=excluded.display_name,address=excluded.address,external_place_ids=app_private.merchant_locations.external_place_ids||excluded.external_place_ids,confidence='official_directory',metadata=app_private.merchant_locations.metadata||excluded.metadata,updated_at=now();

with methods(entity_key) as (values
 ('instrument.yoshinoya.prepaid'),('instrument.payment.credit_card_general'),('instrument.emoney.transit_ic'),('instrument.emoney.waon'),('instrument.jp.nanaco'),('instrument.emoney.quicpay'),('instrument.emoney.rakuten_edy'),('instrument.emoney.id'),
 ('instrument.wallet.paypay'),('instrument.wallet.merpay'),('instrument.wallet.alipay'),('instrument.wallet.rakutenpay'),('instrument.wallet.dbarai'),('instrument.wallet.wechatpay'),('instrument.wallet.quocardpay'),('instrument.wallet.aupay'),('instrument.wallet.aeonpay')
), stores(location_key,source_url) as (values
 ('tokyo.shinjuku.yoshinoya.yasukuni','https://stores.yoshinoya.com/yoshinoya/spot/detail?code=ysn_061489'),
 ('tokyo.shibuya.yoshinoya.dogenzaka','https://stores.yoshinoya.com/yoshinoya/spot/detail?code=ysn_061515'),
 ('tokyo.ikebukuro.yoshinoya.north-exit','https://stores.yoshinoya.com/yoshinoya/spot/detail?code=ysn_041448'),
 ('tokyo.akihabara.yoshinoya.akihabara','https://stores.yoshinoya.com/yoshinoya/spot/detail?code=ysn_041492'),
 ('tokyo.ginza.yoshinoya.higashi-ginza','https://stores.yoshinoya.com/yoshinoya/spot/detail?code=ysn_041458')
), m as (select id from app_private.entities where entity_key='merchant.yoshinoya')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,merchant_location_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select 'maf_yoshinoya_'||regexp_replace(s.location_key,'[^a-z0-9]+','_','g')||'_'||regexp_replace(methods.entity_key,'[^a-z0-9]+','_','g'),m.id,ml.id,e.id,'pay','yes','branch','official_store_page','yoshinoya-store-payment',s.source_url,now(),0.99,'{"store_page_explicit":true}'::jsonb,'active'
from stores s cross join methods cross join m
join app_private.merchant_locations ml on ml.location_key=s.location_key
join app_private.entities e on e.entity_key=methods.entity_key
on conflict(fact_key) do nothing;

with programs(entity_key,source_url) as (values
 ('program.jp.vpoint','https://www.yoshinoya.com/service/v-point/'),
 ('program.jp.rakutenpoint','https://www.yoshinoya.com/service/rakuten/')
), actions(action) as (values ('earn'),('redeem')),
m as (select id from app_private.entities where entity_key='merchant.yoshinoya')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select 'maf_yoshinoya_'||regexp_replace(programs.entity_key,'[^a-z0-9]+','_','g')||'_'||actions.action,m.id,p.id,actions.action,'yes','chain_default','official_store_page','yoshinoya-common-points',programs.source_url,now(),0.99,'{"value_jpy_per_point":1}'::jsonb,'active'
from programs cross join actions cross join m join app_private.entities p on p.entity_key=programs.entity_key
on conflict(fact_key) do nothing;

with programs(entity_key,source_url) as (values
 ('program.jp.vpoint','https://www.yoshinoya.com/service/v-point/'),
 ('program.jp.rakutenpoint','https://www.yoshinoya.com/service/rakuten/')
), m as (select id from app_private.entities where entity_key='merchant.yoshinoya')
insert into app_private.merchant_tender_reward_facts(fact_key,merchant_entity_id,loyalty_program_entity_id,scope,rate_model,reward_units,spend_jpy,tax_basis,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status,component_kind,stacking_mode,choice_group,eligibility)
select 'mtr_yoshinoya_'||regexp_replace(programs.entity_key,'[^a-z0-9]+','_','g'),m.id,p.id,'chain_default','points_per_spend',1,200,'tax_exclusive','floor','official_store_page','yoshinoya-common-points',programs.source_url,now(),0.99,
 jsonb_build_object('official_rate',true,'coexistence_rule','not_explicitly_documented','optimizer_guard','treat common point cards as exclusive until evidence says otherwise'),'active','merchant_loyalty','exclusive_choice','yoshinoya_common_point_card','{"basis":"discounted_tax_exclusive_amount"}'::jsonb
from programs cross join m join app_private.entities p on p.entity_key=programs.entity_key
on conflict(fact_key) do nothing;

insert into app_private.merchant_enrichment_jobs(merchant_location_id,provider,enrichment_kind,priority,status,metadata)
select ml.id,'osm_overpass','coordinates',55,'pending',jsonb_build_object('reason','official Yoshinoya store seeded without guessed coordinates')
from app_private.merchant_locations ml join app_private.entities e on e.id=ml.merchant_entity_id
where e.entity_key='merchant.yoshinoya'
on conflict(merchant_location_id,provider,enrichment_kind) do nothing;

commit;
