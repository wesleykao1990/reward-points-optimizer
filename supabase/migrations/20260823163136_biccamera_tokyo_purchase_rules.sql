begin;

insert into app_private.entities (entity_key, entity_type, display_name, legal_name, locale, metadata, status)
values
  ('merchant.biccamera','merchant','Bic Camera','株式会社ビックカメラ','ja-JP',jsonb_build_object('category','electronics','country','JP'),'active'),
  ('program.jp.bicpoint','loyalty_program','Bic Point',null,'ja-JP',jsonb_build_object('merchant_key','merchant.biccamera','value_jpy_per_point',1,'expiry_model','rolling_last_use_2_years'),'active')
on conflict (entity_key) do update set
  display_name=excluded.display_name,
  legal_name=coalesce(excluded.legal_name,app_private.entities.legal_name),
  locale=excluded.locale,
  metadata=app_private.entities.metadata || excluded.metadata,
  status='active',
  updated_at=now();

with merchant as (
  select id from app_private.entities where entity_key='merchant.biccamera'
), locations(location_key,display_name,address,latitude,longitude,shop_code,launch_area,store_url,coordinate_source) as (
  values
    ('tokyo.shinjuku.biccamera.shinjuku-west','ビックカメラ新宿西口店',jsonb_build_object('postal_code','160-0023','prefecture','東京都','ward','新宿区','street','西新宿1-5-1','site_detail','新宿西口ハルク 2F～6F','station','新宿駅'),35.6925129::numeric,139.6985563::numeric,'016','shinjuku','https://www.biccamera.com/bc/i/shop/shoplist/shop016.jsp','official_store_page_map_link'),
    ('tokyo.shibuya.biccamera.shibuya-east','ビックカメラ渋谷東口店',jsonb_build_object('postal_code','150-0002','prefecture','東京都','ward','渋谷区','street','渋谷1-24-12','site_detail','本館（別館: 渋谷1-24-10）','station','渋谷駅'),35.6599174::numeric,139.7020684::numeric,'008','shibuya','https://www.biccamera.com/bc/i/shop/shoplist/shop008.jsp','official_store_page_map_center'),
    ('tokyo.ikebukuro.biccamera.main','ビックカメラ池袋本店',jsonb_build_object('postal_code','170-0013','prefecture','東京都','ward','豊島区','street','東池袋1-41-5','station','池袋駅'),null::numeric,null::numeric,'007','ikebukuro','https://www.biccamera.com/bc/i/shop/shoplist/shop007.jsp','pending_provider_resolution'),
    ('tokyo.ginza.biccamera.yurakucho','ビックカメラ有楽町店',jsonb_build_object('postal_code','100-0006','prefecture','東京都','ward','千代田区','street','有楽町1-11-1','station','有楽町駅'),35.6753814::numeric,139.7629088::numeric,'014','ginza_yurakucho','https://www.biccamera.com/bc/i/shop/shoplist/shop014.jsp','official_store_page_map_link'),
    ('tokyo.akihabara.biccamera.akiba','ビックカメラAKIBA',jsonb_build_object('postal_code','101-0021','prefecture','東京都','ward','千代田区','street','外神田4-1-1','station','秋葉原駅'),35.699826::numeric,139.7717547::numeric,'121','akihabara','https://www.biccamera.com/bc/i/shop/shoplist/shop121.jsp','official_store_page_map_link')
)
insert into app_private.merchant_locations (
  location_key,merchant_entity_id,display_name,address,latitude,longitude,
  external_place_ids,confidence,metadata
)
select l.location_key,m.id,l.display_name,l.address,l.latitude,l.longitude,
       jsonb_build_object('biccamera_shop_code',l.shop_code),
       'official_directory',
       jsonb_build_object('launch_area',l.launch_area,'category','electronics','official_store_url',l.store_url,'coordinate_source',l.coordinate_source,'source_checked_at','2026-08-23T00:00:00Z')
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
select ml.id,'openstreetmap','coordinates',90,'pending',jsonb_build_object('reason','official_store_page_map_link_exposes_cid_without_coordinates','official_store_url','https://www.biccamera.com/bc/i/shop/shoplist/shop007.jsp')
from app_private.merchant_locations ml
where ml.location_key='tokyo.ikebukuro.biccamera.main'
on conflict (merchant_location_id,provider,enrichment_kind) do update set
  priority=greatest(app_private.merchant_enrichment_jobs.priority,excluded.priority),
  status=case when app_private.merchant_enrichment_jobs.status='complete' then 'complete' else 'pending' end,
  metadata=app_private.merchant_enrichment_jobs.metadata || excluded.metadata,
  updated_at=now();

with merchant as (
  select id from app_private.entities where entity_key='merchant.biccamera'
), acceptance(fact_key,instrument_key,state,note) as (
  values
    ('maf_bic_credit_card','instrument.payment.credit_card_general','yes','Official Bic page lists credit cards; ordinary cards generally receive 8% Bic Point on 10% items.'),
    ('maf_bic_transit_ic','instrument.emoney.transit_ic','yes','Official Bic page lists Suica/PASMO and other nationwide transit IC.'),
    ('maf_bic_waon','instrument.emoney.waon','yes','Official Bic page lists WAON.'),
    ('maf_bic_nanaco','instrument.jp.nanaco','yes','Official Bic page lists nanaco; outlet Yokohama Vivre is the stated exception.'),
    ('maf_bic_rakuten_edy','instrument.emoney.rakuten_edy','yes','Official Bic page lists Rakuten Edy.'),
    ('maf_bic_id','instrument.emoney.id','yes','Official Bic page lists iD.'),
    ('maf_bic_quicpay','instrument.emoney.quicpay','yes','Official Bic page lists QUICPay.'),
    ('maf_bic_pitapa','instrument.emoney.pitapa','no','Official Bic page explicitly says PiTaPa shopping is unavailable.'),
    ('maf_bic_paypay','instrument.wallet.paypay','yes','Official Bic page lists PayPay.'),
    ('maf_bic_dbarai','instrument.wallet.dbarai','yes','Official Bic page lists d払い.'),
    ('maf_bic_aupay','instrument.wallet.aupay','yes','Official Bic page lists au PAY.'),
    ('maf_bic_rakutenpay','instrument.wallet.rakutenpay','yes','Official Bic page lists Rakuten Pay.'),
    ('maf_bic_jcoinpay','instrument.wallet.jcoinpay','yes','Official Bic page lists J-Coin Pay.'),
    ('maf_bic_merpay','instrument.wallet.merpay','yes','Official Bic page lists merpay.'),
    ('maf_bic_aeonpay','instrument.wallet.aeonpay','yes','Official Bic page lists AEON Pay.'),
    ('maf_bic_alipay','instrument.wallet.alipay','yes','Official Bic page lists Alipay+.'),
    ('maf_bic_wechatpay','instrument.wallet.wechatpay','yes','Official Bic page lists WeChat Pay.')
)
insert into app_private.merchant_acceptance_facts (
  fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,
  source_kind,source_ref,source_url,source_checked_at,confidence,derivation,provenance,status
)
select a.fact_key,m.id,i.id,'pay',a.state,'chain_default',
       'official_store_page','biccamera:payment_methods',
       'https://www.biccamera.com/bc/c/super/okaimono/oshiharai/oshiharai/',
       '2026-08-23T00:00:00Z'::timestamptz,0.98,'direct',
       jsonb_build_object('note',a.note,'scope_note','Chain default; sparse store exceptions should override at branch scope.'),'active'
from acceptance a
cross join merchant m
join app_private.entities i on i.entity_key=a.instrument_key
on conflict (fact_key) do update set
  acceptance_state=excluded.acceptance_state,
  source_url=excluded.source_url,
  source_checked_at=excluded.source_checked_at,
  confidence=excluded.confidence,
  provenance=app_private.merchant_acceptance_facts.provenance || excluded.provenance,
  status='active';

with merchant as (
  select id from app_private.entities where entity_key='merchant.biccamera'
), loyalty(fact_key,program_key,action,source_ref,source_url,note) as (
  values
    ('maf_bic_bicpoint_earn','program.jp.bicpoint','earn','biccamera:bicpoint','https://www.biccamera.com/bc/c/super/point/bic_point/','Bic Point earns in stores; base rate is normally 10% but varies by tender/item.'),
    ('maf_bic_bicpoint_redeem','program.jp.bicpoint','redeem','biccamera:bicpoint','https://www.biccamera.com/bc/c/super/point/bic_point/','Bic Point can be used at Bic Camera group stores at 1 point = 1 yen.'),
    ('maf_bic_rakutenpoint_earn','program.jp.rakutenpoint','earn','biccamera:rakutenpoint','https://www.biccamera.com/bc/c/super/point/select/rakuten.jsp','Rakuten Point can be earned in stores; earning cannot be combined with Bic Point earning.'),
    ('maf_bic_rakutenpoint_redeem','program.jp.rakutenpoint','redeem','biccamera:rakutenpoint','https://www.biccamera.com/bc/c/super/point/select/rakuten.jsp','Rakuten Point can be spent in stores; 30,000 points per transaction maximum.'),
    ('maf_bic_dpoint_earn','program.jp.dpoint','earn','biccamera:dpoint','https://www.biccamera.com/bc/c/super/point/select/dpoint.jsp','d Point can be earned in stores; earning cannot be combined with Bic Point earning.'),
    ('maf_bic_dpoint_redeem','program.jp.dpoint','redeem','biccamera:dpoint','https://www.biccamera.com/bc/c/super/point/select/dpoint.jsp','d Point can be spent in stores.'),
    ('maf_bic_ponta_earn','program.jp.ponta','earn','biccamera:ponta','https://www.biccamera.com/bc/c/super/point/select/ponta.jsp','Ponta can be earned in stores; choosing Ponta earning means Bic Point does not accrue.'),
    ('maf_bic_ponta_redeem','program.jp.ponta','redeem','biccamera:ponta','https://www.biccamera.com/bc/c/super/point/select/ponta.jsp','Ponta can be spent in stores; digital Ponta usage is capped at 2,999 points per transaction.')
)
insert into app_private.merchant_acceptance_facts (
  fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,
  source_kind,source_ref,source_url,source_checked_at,confidence,derivation,provenance,status
)
select l.fact_key,m.id,p.id,l.action,'yes','chain_default',
       'official_store_page',l.source_ref,l.source_url,
       '2026-08-23T00:00:00Z'::timestamptz,0.98,'direct',
       jsonb_build_object('note',l.note,'in_store_only',true),'active'
from loyalty l
cross join merchant m
join app_private.entities p on p.entity_key=l.program_key
on conflict (fact_key) do update set
  source_url=excluded.source_url,
  source_checked_at=excluded.source_checked_at,
  confidence=excluded.confidence,
  provenance=app_private.merchant_acceptance_facts.provenance || excluded.provenance,
  status='active';

with merchant as (
  select id from app_private.entities where entity_key='merchant.biccamera'
), bicpoint as (
  select id from app_private.entities where entity_key='program.jp.bicpoint'
), rates(fact_key,instrument_key,rate_percent,note) as (
  values
    ('mtr_bic_bicpoint_credit_card','instrument.payment.credit_card_general',8::numeric,'Ordinary credit cards receive 8% Bic Point on an item whose cash base is 10%; Bic group co-branded cards are a separate higher-rate case not represented by the generic card instrument.'),
    ('mtr_bic_bicpoint_transit_ic','instrument.emoney.transit_ic',10::numeric,'Transit IC is in the electronic-money group shown with the cash-equivalent basic 10% Bic Point rate.'),
    ('mtr_bic_bicpoint_waon','instrument.emoney.waon',10::numeric,'WAON is in the electronic-money group shown with the basic 10% Bic Point rate.'),
    ('mtr_bic_bicpoint_nanaco','instrument.jp.nanaco',10::numeric,'nanaco is in the electronic-money group shown with the basic 10% Bic Point rate; outlet Yokohama Vivre is the stated acceptance exception.'),
    ('mtr_bic_bicpoint_rakuten_edy','instrument.emoney.rakuten_edy',10::numeric,'Rakuten Edy is in the electronic-money group shown with the basic 10% Bic Point rate.'),
    ('mtr_bic_bicpoint_id','instrument.emoney.id',8::numeric,'Bic states iD lowers the point rate by 2 percentage points, e.g. 10% item becomes 8%.'),
    ('mtr_bic_bicpoint_quicpay','instrument.emoney.quicpay',8::numeric,'QUICPay is displayed in the 8% section.'),
    ('mtr_bic_bicpoint_paypay','instrument.wallet.paypay',8::numeric,'Barcode/QR mobile payments are shown as basic 8% Bic Point.'),
    ('mtr_bic_bicpoint_dbarai','instrument.wallet.dbarai',8::numeric,'Barcode/QR mobile payments are shown as basic 8% Bic Point.'),
    ('mtr_bic_bicpoint_aupay','instrument.wallet.aupay',8::numeric,'Barcode/QR mobile payments are shown as basic 8% Bic Point.'),
    ('mtr_bic_bicpoint_rakutenpay','instrument.wallet.rakutenpay',8::numeric,'Barcode/QR mobile payments are shown as basic 8% Bic Point.'),
    ('mtr_bic_bicpoint_jcoinpay','instrument.wallet.jcoinpay',8::numeric,'Barcode/QR mobile payments are shown as basic 8% Bic Point.'),
    ('mtr_bic_bicpoint_merpay','instrument.wallet.merpay',8::numeric,'Barcode/QR mobile payments are shown as basic 8% Bic Point.'),
    ('mtr_bic_bicpoint_aeonpay','instrument.wallet.aeonpay',8::numeric,'Barcode/QR mobile payments are shown as basic 8% Bic Point.'),
    ('mtr_bic_bicpoint_alipay','instrument.wallet.alipay',8::numeric,'Barcode/QR mobile payments are shown as basic 8% Bic Point.'),
    ('mtr_bic_bicpoint_wechatpay','instrument.wallet.wechatpay',8::numeric,'Barcode/QR mobile payments are shown as basic 8% Bic Point.')
)
insert into app_private.merchant_tender_reward_facts (
  fact_key,merchant_entity_id,loyalty_program_entity_id,payment_instrument_entity_id,
  scope,rate_model,rate_percent,rounding_mode,source_kind,source_ref,source_url,
  source_checked_at,confidence,provenance,status
)
select r.fact_key,m.id,b.id,i.id,'chain_default','points_percent',r.rate_percent,'unknown',
       'official_store_page','biccamera:payment_methods',
       'https://www.biccamera.com/bc/c/super/okaimono/oshiharai/oshiharai/',
       '2026-08-23T00:00:00Z'::timestamptz,0.98,
       jsonb_build_object('note',r.note,'rate_basis','basic Bic Point rate for items otherwise eligible for the stated base rate','product_rate_variation_possible',true),'active'
from rates r cross join merchant m cross join bicpoint b
join app_private.entities i on i.entity_key=r.instrument_key
on conflict (fact_key) do update set
  rate_percent=excluded.rate_percent,
  source_checked_at=excluded.source_checked_at,
  provenance=app_private.merchant_tender_reward_facts.provenance || excluded.provenance,
  status='active';

with merchant as (
  select id from app_private.entities where entity_key='merchant.biccamera'
), bicpoint as (
  select id from app_private.entities where entity_key='program.jp.bicpoint'
), derived(fact_key,program_key,source_ref,source_url,note) as (
  values
    ('mtr_bic_rakutenpoint_half_bic','program.jp.rakutenpoint','biccamera:rakutenpoint','https://www.biccamera.com/bc/c/super/point/select/rakuten.jsp','Rakuten Point award rate is half the Bic Point award rate for the purchase, rounded up; Rakuten Point earning cannot be combined with Bic Point earning.'),
    ('mtr_bic_dpoint_half_bic','program.jp.dpoint','biccamera:dpoint','https://www.biccamera.com/bc/c/super/point/select/dpoint.jsp','d Point award rate is half the Bic Point award rate for the purchase, rounded up; d Point earning cannot be combined with Bic Point earning.')
)
insert into app_private.merchant_tender_reward_facts (
  fact_key,merchant_entity_id,loyalty_program_entity_id,scope,rate_model,
  reference_program_entity_id,reference_fraction,rounding_mode,
  source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status
)
select d.fact_key,m.id,p.id,'chain_default','fraction_of_reference',b.id,0.5,'ceil',
       'official_store_page',d.source_ref,d.source_url,
       '2026-08-23T00:00:00Z'::timestamptz,0.98,
       jsonb_build_object('note',d.note,'reference_rate_inherits_tender_context',true,'mutually_exclusive_earn_with',jsonb_build_array('program.jp.bicpoint')),'active'
from derived d cross join merchant m cross join bicpoint b
join app_private.entities p on p.entity_key=d.program_key
on conflict (fact_key) do update set
  reference_fraction=excluded.reference_fraction,
  rounding_mode=excluded.rounding_mode,
  source_checked_at=excluded.source_checked_at,
  provenance=app_private.merchant_tender_reward_facts.provenance || excluded.provenance,
  status='active';

commit;
