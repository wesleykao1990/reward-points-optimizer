begin;

insert into app_private.entities(entity_key,entity_type,display_name,locale,metadata,status)
values ('merchant.itoyokado','merchant','Ito-Yokado','ja-JP','{"category":"general_merchandise_supermarket"}'::jsonb,'active')
on conflict(entity_key) do update set display_name=excluded.display_name,metadata=app_private.entities.metadata||excluded.metadata,status='active',updated_at=now();

update app_private.entities set display_name='Seven Card Plus',updated_at=now() where entity_key='instrument.jp.seven-card-plus';
update app_private.entities set display_name='nanaco Points',metadata=metadata||'{"value_jpy_per_point":1}'::jsonb,updated_at=now() where entity_key='program.jp.nanaco';

with m as (select id from app_private.entities where entity_key='merchant.itoyokado'),
rows(location_key,display_name,address,store_id,area,source_url) as (values
 ('tokyo.koto.itoyokado.kiba','イトーヨーカドー 木場店','{"postal_code":"135-0042","prefecture":"東京都","ward":"江東区","street":"木場1-5-30","country_code":"JP"}'::jsonb,'549','koto','https://stores.itoyokado.co.jp/detail/549/'),
 ('tokyo.shinagawa.itoyokado.oimachi','イトーヨーカドー 大井町店','{"postal_code":"140-0014","prefecture":"東京都","ward":"品川区","street":"大井1-3-6","country_code":"JP"}'::jsonb,'538','shinagawa','https://stores.itoyokado.co.jp/detail/538/'),
 ('tokyo.ota.itoyokado.omori','イトーヨーカドー 大森店','{"postal_code":"143-0016","prefecture":"東京都","ward":"大田区","street":"大森北2-13-1","country_code":"JP"}'::jsonb,'562','ota','https://stores.itoyokado.co.jp/detail/562/'),
 ('tokyo.kita.itoyokado.akabane','イトーヨーカドー 赤羽店','{"postal_code":"115-0055","prefecture":"東京都","ward":"北区","street":"赤羽西1-7-1","country_code":"JP"}'::jsonb,'535','akabane','https://stores.itoyokado.co.jp/detail/535/'),
 ('tokyo.sumida.itoyokado.hikifune','イトーヨーカドー 曳舟店','{"postal_code":"131-0046","prefecture":"東京都","ward":"墨田区","street":"京島1-2-1","country_code":"JP"}'::jsonb,'577','sumida','https://stores.itoyokado.co.jp/detail/577/'),
 ('tokyo.koto.itoyokado.ario-kitasuna','イトーヨーカドー アリオ北砂店','{"postal_code":"136-0073","prefecture":"東京都","ward":"江東区","street":"北砂2-17-1","country_code":"JP"}'::jsonb,'574','koto','https://stores.itoyokado.co.jp/detail/574/')
)
insert into app_private.merchant_locations(location_key,merchant_entity_id,display_name,address,external_place_ids,confidence,metadata)
select r.location_key,m.id,r.display_name,r.address,jsonb_build_object('itoyokado_store_id',r.store_id),'official_directory',jsonb_build_object('launch_area',r.area,'official_source_url',r.source_url)
from rows r cross join m
on conflict(location_key) do update set display_name=excluded.display_name,address=excluded.address,external_place_ids=app_private.merchant_locations.external_place_ids||excluded.external_place_ids,confidence='official_directory',metadata=app_private.merchant_locations.metadata||excluded.metadata,updated_at=now();

with m as (select id from app_private.entities where entity_key='merchant.itoyokado'),
nanaco as (select id from app_private.entities where entity_key='instrument.jp.nanaco'),
card as (select id from app_private.entities where entity_key='instrument.jp.seven-card-plus')
insert into app_private.merchant_acceptance_facts(fact_key,merchant_entity_id,instrument_entity_id,action,acceptance_state,scope,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status)
select * from (
 select 'maf_itoyokado_nanaco_pay',m.id,nanaco.id,'pay','yes','chain_default','official_store_page','nanaco-alliance','https://www.nanaco-net.jp/alliance/',now(),0.99,'{"official_alliance_lists_itoyokado":true,"some_store_exceptions_possible":true}'::jsonb,'active' from m,nanaco
 union all
 select 'maf_itoyokado_seven_card_plus_pay',m.id,card.id,'pay','yes','chain_default','official_store_page','nanaco-creditcard','https://www.nanaco-net.jp/how-to/save_point/creditcard.html',now(),0.99,'{"seven_and_i_target_store":true}'::jsonb,'active' from m,card
) q
on conflict(fact_key) do nothing;

-- Seven Card Plus earns 2 nanaco points per 200 JPY incl. tax at Ito-Yokado target stores.
with m as (select id from app_private.entities where entity_key='merchant.itoyokado'),
p as (select id from app_private.entities where entity_key='program.jp.nanaco'),
card as (select id from app_private.entities where entity_key='instrument.jp.seven-card-plus')
insert into app_private.merchant_tender_reward_facts(fact_key,merchant_entity_id,loyalty_program_entity_id,payment_instrument_entity_id,scope,rate_model,reward_units,spend_jpy,tax_basis,rounding_mode,source_kind,source_ref,source_url,source_checked_at,confidence,provenance,status,component_kind,stacking_mode,choice_group,eligibility)
select 'mtr_itoyokado_seven_card_plus',m.id,p.id,card.id,'chain_default','points_per_spend',2,200,'tax_inclusive','floor','official_store_page','nanaco-creditcard','https://www.nanaco-net.jp/how-to/save_point/creditcard.html',now(),0.99,'{"seven_and_i_target_rate":true}'::jsonb,'active','payment_bonus','additive',null,'{"some_stores_salesfloors_products_may_be_excluded":true}'::jsonb
from m,p,card
on conflict(fact_key) do nothing;

insert into app_private.merchant_enrichment_jobs(merchant_location_id,provider,enrichment_kind,priority,status,metadata)
select ml.id,'osm_overpass','coordinates',45,'pending',jsonb_build_object('reason','official Ito-Yokado store seeded without guessed coordinates')
from app_private.merchant_locations ml join app_private.entities e on e.id=ml.merchant_entity_id
where e.entity_key='merchant.itoyokado'
on conflict(merchant_location_id,provider,enrichment_kind) do nothing;

commit;
