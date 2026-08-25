-- Regression coverage for the additive online-commerce model and five golden sites.

do $$
begin
  if (select count(*) from app_private.commerce_surfaces where status='active' and metadata @> '{"golden_site":true}'::jsonb) <> 5 then
    raise exception 'expected exactly five active golden commerce surfaces';
  end if;

  if (select count(*) from app_private.online_commerce_catalogue where status='active' and priority='P0') < 5 then
    raise exception 'expected the five golden sites in the P0 online commerce catalogue';
  end if;

  if not exists (
    select 1 from app_api.resolve_commerce_url('https://www.amazon.co.jp/dp/B000000000?tag=test')
    where surface_key='commerce.amazon.co.jp'
  ) then
    raise exception 'Amazon Japan URL did not resolve';
  end if;

  if exists (select 1 from app_api.resolve_commerce_url('https://www.amazon.com/dp/B000000000')) then
    raise exception 'amazon.com must not resolve to Amazon Japan';
  end if;

  if not exists (
    select 1 from app_api.resolve_commerce_url('https://item.rakuten.co.jp/example/item/')
    where surface_key='commerce.rakuten.ichiba.jp' and requires_seller_resolution
  ) then
    raise exception 'Rakuten item URL must resolve and require seller resolution';
  end if;

  if not exists (
    select 1 from app_api.resolve_commerce_url('https://shopping.yahoo.co.jp/products/example')
    where surface_key='commerce.yahoo.shopping.jp' and requires_seller_resolution
  ) then
    raise exception 'Yahoo Shopping must require seller resolution';
  end if;

  if not exists (
    select 1
    from app_private.current_commerce_acceptance_facts f
    join app_private.commerce_surfaces s on s.id=f.surface_id
    join app_private.entities e on e.id=f.instrument_entity_id
    where s.surface_key='commerce.yahoo.shopping.jp'
      and e.entity_key='program.jp.vpoint'
      and f.action='redeem'
      and f.acceptance_state='no'
      and f.applicability @> '{"explicit_official_exclusion":true}'::jsonb
  ) then
    raise exception 'Yahoo Shopping explicit V Point redemption exclusion is missing';
  end if;

  if not exists (
    select 1
    from app_private.current_commerce_reward_facts f
    join app_private.commerce_surfaces s on s.id=f.surface_id
    where s.surface_key='commerce.rakuten.ichiba.jp'
      and f.fact_key='crf_rakuten_base_1pct'
      and f.rankability='rankable'
      and f.value_model @> '{"type":"rate_percent","rate_percent":1}'::jsonb
  ) then
    raise exception 'Rakuten base reward model is missing';
  end if;

  if not exists (
    select 1
    from app_private.current_commerce_reward_facts f
    join app_private.commerce_surfaces s on s.id=f.surface_id
    where s.surface_key='commerce.zozotown.jp'
      and f.fact_key='crf_zozo_zozocard_5pct'
      and f.amount_basis='post_discount_tax_exclusive'
      and f.value_model @> '{"type":"rate_percent","rate_percent":5}'::jsonb
  ) then
    raise exception 'ZOZOCARD 5 percent split-basis model is missing';
  end if;

  if (select reward_fact_count from app_api.online_commerce_coverage where surface_key='commerce.yahoo.shopping.jp') <> 0 then
    raise exception 'Yahoo reward economics must remain unranked until separately sourced';
  end if;

  if not has_function_privilege('jro_runtime','app_api.resolve_commerce_url(text)','EXECUTE') then
    raise exception 'runtime role lacks commerce URL resolver access';
  end if;

  if not has_function_privilege('jro_runtime','app_api.commerce_purchase_context(text)','EXECUTE') then
    raise exception 'runtime role lacks commerce purchase context access';
  end if;
end
$$;
