begin;

insert into app_private.entities (entity_key,entity_type,display_name,legal_name,locale,metadata,status)
values
  ('merchant.welcia','merchant','Welcia','ウエルシア薬局株式会社','ja-JP',jsonb_build_object('category','drugstore','country','JP'),'active'),
  ('program.jp.waonpoint','loyalty_program','WAON POINT',null,'ja-JP',jsonb_build_object('value_jpy_per_point',1,'base_rate_tax_exclusive_percent',1),'active'),
  ('instrument.wallet.yuchopay','qr_wallet','ゆうちょPay',null,'ja-JP',jsonb_build_object('category','qr_wallet'),'active'),
  ('instrument.wallet.bankpay','qr_wallet','Bank Pay',null,'ja-JP',jsonb_build_object('category','qr_wallet'),'active')
on conflict (entity_key) do update set
  display_name=excluded.display_name,
  legal_name=coalesce(excluded.legal_name,app_private.entities.legal_name),
  locale=excluded.locale,
  metadata=app_private.entities.metadata || excluded.metadata,
  status='active',updated_at=now();

with merchant as (select id from app_private.entities where entity_key='merchant.welcia'),
locations(location_key,display_name,address,store_code,launch_area,store_url) as (
  values
    ('tokyo.shinjuku.welcia.oguard','ウエルシアO-GUARD新宿店',jsonb_build_object('postal_code','160-0023','prefecture','東京都','ward','新宿区','street','西新宿7-10-1','station','新宿駅・新宿西口駅'),'5145D','shinjuku','https://store.welcia.co.jp/welcia/spot/detail?code=5145D'),
    ('tokyo.shibuya.welcia.daikanyama-dice','ウエルシア代官山ディセ店',jsonb_build_object('postal_code','150-0034','prefecture','東京都','ward','渋谷区','street','代官山町17-6','site_detail','代官山アドレス・ディセ1階','station','代官山駅'),'2169D','shibuya','https://store.welcia.co.jp/welcia/spot/detail?code=2169D'),
    ('tokyo.ikebukuro.welcia.ikebukuro-west','ウエルシア池袋西店',jsonb_build_object('postal_code','171-0014','prefecture','東京都','ward','豊島区','street','池袋2-67-1','site_detail','1F','station','池袋駅'),'5193D','ikebukuro','https://store.welcia.co.jp/welcia/spot/detail?code=5193D')
)
insert into app_private.merchant_locations (
  location_key,merchant_entity_id,display_name,address,external_place_ids,confidence,metadata
)
select l.location_key,m.id,l.display_name,l.address,
       jsonb_build_object('welcia_store_code',l.store_code),'official_directory',
       jsonb_build_object('launch_area',l.launch_area,'category','drugstore','official_store_url',l.store_url,'coordinate_source','pending_provider_resolution','source_checked_at','2026-08-23T00:00:00Z')
from locations l cross join merchant m
on conflict (location_key) do update set
  display_name=excluded.display_name,address=excluded.address,
  external_place_ids=app_private.merchant_locations.external_place_ids||excluded.external_place_ids,
  confidence='official_directory',metadata=app_private.merchant_locations.metadata||excluded.metadata,updated_at=now();

insert into app_private.merchant_enrichment_jobs (merchant_location_id,provider,enrichment_kind,priority,status,metadata)
select ml.id,'openstreetmap','coordinates',85,'pending',jsonb_build_object('reason','official store address known; precise coordinate pending provider resolution','official_store_url',ml.metadata->>'official_store_url')
from app_private.merchant_locations ml
join app_private.entities e on e.id=ml.merchant_entity_id and e.entity_key='merchant.welcia'
where ml.latitude is null or ml.longitude is null
on conflict (merchant_location_id,provider,enrichment_kind) do update set
 priority=greatest(app_private.merchant_enrichment_jobs.priority,excluded.priority),
 status=case when app_private.merchant_enrichment_jobs.status='complete' then 'complete' else 'pending' end,
 metadata=app_private.merchant_enrichment_jobs.metadata||excluded.metadata,updated_at=now();

-- Point participation is chain-level. Current Welcia materials define WAON POINT
-- basic points as 1 per JPY100 tax-exclusive and V Point as 1 per JPY200 tax-exclusive.
with merchant as (select id from app_private.entities where entity_key='merchant.welcia'),
loyalty(fact_key,program_key,action,source_ref,source_url,note) as (
 values
 ('maf_welcia_waonpoint_earn','program.jp.waonpoint','earn','welcia:waonpoint','https://www.welcia-yakkyoku.co.jp/content/fixed/4620/top_pdf/release20260105.pdf','WAON POINT basic earning is 1 point per JPY100 tax-exclusive at standard Welcia group target stores; exclusions apply.'),
 ('maf_welcia_vpoint_earn','program.jp.vpoint','earn','welcia:vpoint','https://www.welcia-yakkyoku.co.jp/content/fixed/837/top_pdf/release240913.pdf','V Point ordinary earning is 1 point per JPY200 tax-exclusive at Welcia group target stores.'),
 ('maf_welcia_vpoint_redeem','program.jp.vpoint','redeem','welcia:vpoint','https://www.welcia-yakkyoku.co.jp/content/fixed/837/top_pdf/release240913.pdf','V Point can be used at Welcia group stores at 1 point = JPY1.')
)
insert into app_private.merchant_acceptance_facts (
 fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,
 source_kind,source_ref,source_url,source_checked_at,confidence,derivation,provenance,status
)
select l.fact_key,m.id,p.id,l.action,'yes','chain_default','official_store_page',l.source_ref,l.source_url,
 '2026-08-23T00:00:00Z'::timestamptz,0.97,'direct',
 jsonb_build_object('note',l.note,'tax_basis','tax_exclusive','excluded_products_possible',true),'active'
from loyalty l cross join merchant m join app_private.entities p on p.entity_key=l.program_key
on conflict (fact_key) do update set source_url=excluded.source_url,source_checked_at=excluded.source_checked_at,
 confidence=excluded.confidence,provenance=app_private.merchant_acceptance_facts.provenance||excluded.provenance,status='active';

-- Exact official store pages for these three stores list the same broad tender set.
with merchant as (select id from app_private.entities where entity_key='merchant.welcia'),
locations as (
 select ml.id,ml.location_key,ml.metadata->>'official_store_url' as source_url
 from app_private.merchant_locations ml cross join merchant m
 where ml.merchant_entity_id=m.id and ml.location_key like 'tokyo.%.welcia.%'
), payments(instrument_key) as (
 values
 ('instrument.payment.credit_card_general'),
 ('instrument.emoney.waon'),
 ('instrument.emoney.rakuten_edy'),
 ('instrument.payment.unionpay'),
 ('instrument.emoney.transit_ic'),
 ('instrument.emoney.quicpay'),
 ('instrument.wallet.alipay'),
 ('instrument.wallet.dbarai'),
 ('instrument.wallet.wechatpay'),
 ('instrument.wallet.paypay'),
 ('instrument.wallet.aupay'),
 ('instrument.wallet.rakutenpay'),
 ('instrument.wallet.yuchopay'),
 ('instrument.wallet.merpay'),
 ('instrument.wallet.jcoinpay'),
 ('instrument.wallet.famipay'),
 ('instrument.wallet.bankpay'),
 ('instrument.wallet.smartcode'),
 ('instrument.wallet.quocardpay'),
 ('instrument.wallet.aeonpay')
)
insert into app_private.merchant_acceptance_facts (
 fact_key,merchant_entity_id,merchant_location_id,instrument_entity_id,action,acceptance_state,scope,
 source_kind,source_ref,source_url,source_checked_at,confidence,derivation,provenance,status
)
select 'maf_welcia_'||substr(md5(l.location_key||'|'||p.instrument_key),1,24),m.id,l.id,i.id,'pay','yes','branch',
 'official_store_page','welcia:'||l.location_key,l.source_url,'2026-08-23T00:00:00Z'::timestamptz,0.99,'direct',
 jsonb_build_object('note','Payment method explicitly listed on this official Welcia store page.','branch_only_source',true),'active'
from locations l cross join merchant m cross join payments p join app_private.entities i on i.entity_key=p.instrument_key
on conflict (fact_key) do update set acceptance_state='yes',source_url=excluded.source_url,source_checked_at=excluded.source_checked_at,
 confidence=excluded.confidence,provenance=app_private.merchant_acceptance_facts.provenance||excluded.provenance,status='active';

-- Tender-independent point presentation components. These can be additive to
-- card/wallet rewards and, for registered Welcia members, are designed to coexist.
with merchant as (select id from app_private.entities where entity_key='merchant.welcia'),
waonp as (select id from app_private.entities where entity_key='program.jp.waonpoint'),
vp as (select id from app_private.entities where entity_key='program.jp.vpoint')
insert into app_private.merchant_tender_reward_facts (
 fact_key,merchant_entity_id,loyalty_program_entity_id,payment_instrument_entity_id,scope,rate_model,
 rate_percent,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status
)
select 'mtr_welcia_waonpoint_base',m.id,w.id,null::uuid,'chain_default','points_percent',1,'floor','official_store_page',
 'welcia:waonpoint','https://www.welcia-yakkyoku.co.jp/content/fixed/4620/top_pdf/release20260105.pdf',
 '2026-08-23T00:00:00Z'::timestamptz,0.98,
 jsonb_build_object('tax_basis','tax_exclusive','points_per_jpy_100',1,'excluded_products_possible',true,'presentation_component',true),'active'
from merchant m cross join waonp w
union all
select 'mtr_welcia_vpoint_base',m.id,v.id,null::uuid,'chain_default','points_percent',0.5,'floor','official_store_page',
 'welcia:vpoint','https://www.welcia-yakkyoku.co.jp/content/fixed/837/top_pdf/release240913.pdf',
 '2026-08-23T00:00:00Z'::timestamptz,0.97,
 jsonb_build_object('tax_basis','tax_exclusive','points_per_jpy_200',1,'excluded_products_possible',true,'presentation_component',true),'active'
from merchant m cross join vp v
on conflict (fact_key) do update set rate_percent=excluded.rate_percent,source_checked_at=excluded.source_checked_at,
 confidence=excluded.confidence,provenance=app_private.merchant_tender_reward_facts.provenance||excluded.provenance,status='active';

commit;
