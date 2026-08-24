begin;

insert into app_private.entities (entity_key, entity_type, display_name, legal_name, locale, metadata, status)
values
  ('merchant.matsukiyo','merchant','Matsumoto Kiyoshi','株式会社マツモトキヨシ','ja-JP',jsonb_build_object('category','drugstore','group','MatsukiyoCocokara','country','JP'),'active'),
  ('program.jp.matsukiyococokara','loyalty_program','マツキヨココカラポイント',null,'ja-JP',jsonb_build_object('merchant_key','merchant.matsukiyo','value_jpy_per_point',1,'base_rate_tax_exclusive_percent',1,'stage_multipliers',jsonb_build_array(1,2,3)),'active'),
  ('instrument.payment.unionpay','payment_interface','UnionPay card',null,'ja-JP',jsonb_build_object('category','card_network'),'active'),
  ('instrument.wallet.applepay','payment_interface','Apple Pay',null,'ja-JP',jsonb_build_object('category','mobile_wallet_interface'),'active'),
  ('instrument.wallet.quocardpay','qr_wallet','QUO Card Pay',null,'ja-JP',jsonb_build_object('category','barcode_wallet'),'active'),
  ('instrument.card.d','credit_card','d Card',null,'ja-JP',jsonb_build_object('family_id','card.d','issuer','NTT DOCOMO'),'active')
on conflict (entity_key) do update set
  display_name=excluded.display_name,
  legal_name=coalesce(excluded.legal_name,app_private.entities.legal_name),
  locale=excluded.locale,
  metadata=app_private.entities.metadata || excluded.metadata,
  status='active',
  updated_at=now();

with merchant as (
  select id from app_private.entities where entity_key='merchant.matsukiyo'
), locations(location_key,display_name,address,kid,launch_area,store_url,latitude,longitude,coordinate_source) as (
  values
    ('tokyo.shinjuku.matsukiyo.shinjuku-sanchome-part2','薬 マツモトキヨシ 新宿三丁目Part2店',jsonb_build_object('postal_code','160-0022','prefecture','東京都','ward','新宿区','street','新宿3-17-2','site_detail','ヒューリックビル新宿三丁目ビル','station','新宿三丁目駅'),'10001745','shinjuku','https://www.matsukiyocokara-online.com/map/?kid=10001745',null::numeric,null::numeric,'pending_provider_resolution'),
    ('tokyo.shibuya.matsukiyo.scramble-flag','薬マツモトキヨシ SHIBUYA SCRAMBLE FLAG',jsonb_build_object('postal_code','150-0042','prefecture','東京都','ward','渋谷区','street','宇田川町22-3','station','渋谷駅'),'10000378','shibuya','https://www.matsukiyocokara-online.com/map/?kid=10000378',null::numeric,null::numeric,'pending_provider_resolution'),
    ('tokyo.ikebukuro.matsukiyo.east-exit','薬 マツモトキヨシ 池袋東口店',jsonb_build_object('postal_code','171-0022','prefecture','東京都','ward','豊島区','street','南池袋1-27-5','station','池袋駅'),'10000317','ikebukuro','https://www.matsukiyocokara-online.com/map/?kid=10000317',35.7295653::numeric,139.7126747::numeric,'official_store_page_map_redirect'),
    ('tokyo.ginza.matsukiyo.yurakucho-2chome','薬 マツモトキヨシ 有楽町二丁目店',jsonb_build_object('postal_code','100-0006','prefecture','東京都','ward','千代田区','street','有楽町2-8-5','station','有楽町駅'),'10000500','ginza_yurakucho','https://www.matsukiyocokara-online.com/map/?kid=10000500',null::numeric,null::numeric,'pending_provider_resolution'),
    ('tokyo.akihabara.matsukiyo.akiba','薬 マツモトキヨシ アキバ店',jsonb_build_object('postal_code','101-0021','prefecture','東京都','ward','千代田区','street','外神田1-4-13','station','秋葉原駅'),'10001374','akihabara','https://www.matsukiyocokara-online.com/map/?kid=10001374',35.6985602::numeric,139.7710681::numeric,'official_store_page_map_redirect'),
    ('tokyo.marunouchi.matsukiyo.yaechika','薬 マツモトキヨシ ヤエチカ店',jsonb_build_object('postal_code','104-0028','prefecture','東京都','ward','中央区','street','八重洲2-1','site_detail','八重洲地下街中2号','station','東京駅'),'10001597','tokyo_marunouchi','https://www.matsukiyocokara-online.com/map/?kid=10001597',null::numeric,null::numeric,'pending_provider_resolution')
)
insert into app_private.merchant_locations (
  location_key,merchant_entity_id,display_name,address,latitude,longitude,
  external_place_ids,confidence,metadata
)
select l.location_key,m.id,l.display_name,l.address,l.latitude,l.longitude,
       jsonb_build_object('matsukiyococokara_kid',l.kid),
       'official_directory',
       jsonb_build_object('launch_area',l.launch_area,'category','drugstore','official_store_url',l.store_url,'coordinate_source',l.coordinate_source,'source_checked_at','2026-08-23T00:00:00Z')
from locations l cross join merchant m
on conflict (location_key) do update set
  display_name=excluded.display_name,
  address=excluded.address,
  latitude=coalesce(excluded.latitude,app_private.merchant_locations.latitude),
  longitude=coalesce(excluded.longitude,app_private.merchant_locations.longitude),
  external_place_ids=app_private.merchant_locations.external_place_ids || excluded.external_place_ids,
  confidence='official_directory',
  metadata=app_private.merchant_locations.metadata || excluded.metadata,
  updated_at=now();

insert into app_private.merchant_enrichment_jobs (merchant_location_id,provider,enrichment_kind,priority,status,metadata)
select ml.id,'openstreetmap','coordinates',85,'pending',jsonb_build_object('reason','official store address known; precise coordinate pending provider resolution','official_store_url',ml.metadata->>'official_store_url')
from app_private.merchant_locations ml
join app_private.entities e on e.id=ml.merchant_entity_id and e.entity_key='merchant.matsukiyo'
where ml.latitude is null or ml.longitude is null
on conflict (merchant_location_id,provider,enrichment_kind) do update set
  priority=greatest(app_private.merchant_enrichment_jobs.priority,excluded.priority),
  status=case when app_private.merchant_enrichment_jobs.status='complete' then 'complete' else 'pending' end,
  metadata=app_private.merchant_enrichment_jobs.metadata || excluded.metadata,
  updated_at=now();

with merchant as (
  select id from app_private.entities where entity_key='merchant.matsukiyo'
), loyalty(fact_key,program_key,action,source_ref,source_url,note) as (
  values
    ('maf_matsukiyo_ownpoint_earn','program.jp.matsukiyococokara','earn','matsukiyococokara:pointcard','https://www.matsukiyocokara-online.com/point/pointcard/','Base own-point earning is 1 point per JPY100 tax-exclusive; stage multipliers can raise this to 2x or 3x.'),
    ('maf_matsukiyo_ownpoint_redeem','program.jp.matsukiyococokara','redeem','matsukiyococokara:pointcard','https://www.matsukiyocokara-online.com/point/pointcard/','200 own points can be used as JPY200 discount; point-paid portion does not earn own points.'),
    ('maf_matsukiyo_dpoint_earn','program.jp.dpoint','earn','matsukiyococokara:dpoint','https://www.matsukiyocokara-online.com/point/dpoint','d Point earns 1 point per JPY100 tax-exclusive and may be presented together with the MatsukiyoCocokara point card.'),
    ('maf_matsukiyo_dpoint_redeem','program.jp.dpoint','redeem','matsukiyococokara:dpoint','https://www.matsukiyocokara-online.com/point/dpoint','d Point can be used at 1 point = JPY1; some products/services are excluded.')
)
insert into app_private.merchant_acceptance_facts (
  fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,
  source_kind,source_ref,source_url,source_checked_at,confidence,derivation,provenance,status
)
select l.fact_key,m.id,p.id,l.action,'yes','chain_default','official_store_page',l.source_ref,l.source_url,
       '2026-08-23T00:00:00Z'::timestamptz,0.99,'direct',
       jsonb_build_object('note',l.note,'stacking',case when l.program_key='program.jp.dpoint' then jsonb_build_array('program.jp.matsukiyococokara') else '[]'::jsonb end),'active'
from loyalty l cross join merchant m
join app_private.entities p on p.entity_key=l.program_key
on conflict (fact_key) do update set
  source_url=excluded.source_url,
  source_checked_at=excluded.source_checked_at,
  confidence=excluded.confidence,
  provenance=app_private.merchant_acceptance_facts.provenance || excluded.provenance,
  status='active';

with merchant as (
  select id from app_private.entities where entity_key='merchant.matsukiyo'
), locations as (
  select ml.id,ml.location_key,ml.metadata->>'official_store_url' as source_url
  from app_private.merchant_locations ml cross join merchant m
  where ml.merchant_entity_id=m.id
    and ml.location_key like 'tokyo.%.matsukiyo.%'
), payments(instrument_key) as (
  values
    ('instrument.payment.credit_card_general'),
    ('instrument.emoney.rakuten_edy'),
    ('instrument.emoney.id'),
    ('instrument.emoney.quicpay'),
    ('instrument.wallet.applepay'),
    ('instrument.emoney.transit_ic'),
    ('instrument.payment.unionpay'),
    ('instrument.wallet.alipay'),
    ('instrument.wallet.wechatpay'),
    ('instrument.wallet.dbarai'),
    ('instrument.wallet.aupay'),
    ('instrument.emoney.waon'),
    ('instrument.wallet.paypay'),
    ('instrument.wallet.merpay'),
    ('instrument.wallet.rakutenpay'),
    ('instrument.wallet.quocardpay')
)
insert into app_private.merchant_acceptance_facts (
  fact_key,merchant_entity_id,merchant_location_id,instrument_entity_id,action,
  acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,
  confidence,derivation,provenance,status
)
select
  'maf_matsukiyo_' || substr(md5(l.location_key || '|' || p.instrument_key),1,24),
  m.id,l.id,i.id,'pay','yes','branch','official_store_page',
  'matsukiyococokara:' || l.location_key,l.source_url,
  '2026-08-23T00:00:00Z'::timestamptz,0.98,'direct',
  jsonb_build_object('note','Payment method explicitly listed on this official store page.','branch_confirmation_source',true),'active'
from locations l cross join merchant m cross join payments p
join app_private.entities i on i.entity_key=p.instrument_key
on conflict (fact_key) do update set
  acceptance_state='yes',
  source_url=excluded.source_url,
  source_checked_at=excluded.source_checked_at,
  confidence=excluded.confidence,
  provenance=app_private.merchant_acceptance_facts.provenance || excluded.provenance,
  status='active';

with merchant as (
  select id from app_private.entities where entity_key='merchant.matsukiyo'
), locations as (
  select ml.id,ml.location_key,ml.metadata->>'official_store_url' as source_url
  from app_private.merchant_locations ml cross join merchant m
  where ml.merchant_entity_id=m.id and ml.location_key like 'tokyo.%.matsukiyo.%'
), dcard as (select id from app_private.entities where entity_key='instrument.card.d')
insert into app_private.merchant_acceptance_facts (
  fact_key,merchant_entity_id,merchant_location_id,instrument_entity_id,action,
  acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,
  confidence,derivation,provenance,status
)
select 'maf_matsukiyo_dcard_'||substr(md5(l.location_key),1,24),m.id,l.id,d.id,'pay','yes','branch',
       'official_store_page','matsukiyococokara:dcard-special:'||l.location_key,l.source_url,
       '2026-08-23T00:00:00Z'::timestamptz,0.98,'direct',
       jsonb_build_object('note','Official store page marks d Card special-store support for credit card/iD. Economic bonus is intentionally not collapsed into this acceptance fact.'),'active'
from locations l cross join merchant m cross join dcard d
on conflict (fact_key) do update set
  source_url=excluded.source_url,source_checked_at=excluded.source_checked_at,
  confidence=excluded.confidence,provenance=app_private.merchant_acceptance_facts.provenance||excluded.provenance,status='active';

with merchant as (select id from app_private.entities where entity_key='merchant.matsukiyo'),
     ownp as (select id from app_private.entities where entity_key='program.jp.matsukiyococokara'),
     dp as (select id from app_private.entities where entity_key='program.jp.dpoint')
insert into app_private.merchant_tender_reward_facts (
  fact_key,merchant_entity_id,loyalty_program_entity_id,payment_instrument_entity_id,
  scope,rate_model,rate_percent,rounding_mode,source_kind,source_ref,source_url,
  source_checked_at,confidence,provenance,status
)
select 'mtr_matsukiyo_ownpoint_base',m.id,o.id,null::uuid,'chain_default','points_percent',1,'floor',
       'official_store_page','matsukiyococokara:pointcard','https://www.matsukiyocokara-online.com/point/pointcard/',
       '2026-08-23T00:00:00Z'::timestamptz,0.99,
       jsonb_build_object('tax_basis','tax_exclusive','points_per_jpy_100',1,'stage_multiplier_possible',true,'stackable_with',jsonb_build_array('program.jp.dpoint')),'active'
from merchant m cross join ownp o
union all
select 'mtr_matsukiyo_dpoint_base',m.id,d.id,null::uuid,'chain_default','points_percent',1,'floor',
       'official_store_page','matsukiyococokara:dpoint','https://www.matsukiyococokara-online.com/point/dpoint',
       '2026-08-23T00:00:00Z'::timestamptz,0.99,
       jsonb_build_object('tax_basis','tax_exclusive','points_per_jpy_100',1,'stackable_with',jsonb_build_array('program.jp.matsukiyococokara')),'active'
from merchant m cross join dp d
on conflict (fact_key) do update set
  rate_percent=excluded.rate_percent,source_checked_at=excluded.source_checked_at,
  confidence=excluded.confidence,provenance=app_private.merchant_tender_reward_facts.provenance||excluded.provenance,status='active';

commit;
