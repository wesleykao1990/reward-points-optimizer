\set ON_ERROR_STOP on

begin;

do $exchange_route_completeness$
declare
    v_route_ids text[];
begin
    select array_agg(value #>> '{transfer,route_id}' order by value #>> '{transfer,route_id}')
      into v_route_ids
      from app_private.p0_route_graph_facts_at(
          timestamptz '2026-08-25T21:40:00+09:00'
      )
     where research_artifact_id = 'p0-exchange-route-completeness.research.v0.1'
       and implementation_version = 'p0-exchange-route-completeness.implementation.v0.9'
       and claim_type = 'transfer_rule';

    if v_route_ids is distinct from array[
        'ana-to-jr-kyupo-full-tier',
        'ana-to-jr-kyupo-reduced-tier',
        'bic-to-jr-kyupo',
        'jal-to-jr-kyupo-high-tier',
        'jal-to-jr-kyupo-low-tier',
        'jal-to-ponta-high-tier',
        'jal-to-ponta-low-tier',
        'jr-kyupo-to-ana',
        'jr-kyupo-to-bic',
        'jr-kyupo-to-jal',
        'jr-kyupo-to-v',
        'moppy-to-ana',
        'moppy-to-d',
        'moppy-to-nanaco',
        'moppy-to-paypay-minimum',
        'moppy-to-ponta-minimum',
        'moppy-to-rakuten',
        'moppy-to-v',
        'moppy-to-waon',
        'recruit-to-d',
        'saison-permanent-to-jr-kyupo',
        'waon-to-jr-kyupo'
    ]::text[] then
        raise exception 'v0.9 route inventory drifted: %', v_route_ids;
    end if;

    if not exists (
        select 1
          from app_private.p0_route_graph_facts_at(
              timestamptz '2026-08-25T21:40:00+09:00'
          )
         where claim_id = 'claim.route.moppy.ponta.minimum.001'
           and value #> '{transfer,allowed_source_amounts}' = '[300]'::jsonb
           and value #>> '{transfer,fee_source_units}' = '15'
    ) or not exists (
        select 1
          from app_private.p0_route_graph_facts_at(
              timestamptz '2026-08-25T21:40:00+09:00'
          )
         where claim_id = 'claim.route.moppy.paypay.minimum.001'
           and value #> '{transfer,allowed_source_amounts}' = '[500]'::jsonb
           and value #>> '{transfer,fee_source_units}' = '50'
    ) then
        raise exception 'Moppy bounded minimum-fee routes are absent or drifted';
    end if;

    if not exists (
        select 1
          from app_private.p0_route_graph_facts_at(
              timestamptz '2026-08-25T21:40:00+09:00'
          )
         where claim_id = 'claim.route.moppy.ana.001'
           and value #>> '{transfer,source_units}' = '1750'
           and value #>> '{transfer,destination_units}' = '500'
           and value #>> '{transfer,fee_source_units}' = '0'
           and value #>> '{transfer,processing_time_days_min}' = '1'
           and value #>> '{transfer,processing_time_days_max}' = '3'
    ) then
        raise exception 'Moppy to ANA exact route is absent or drifted';
    end if;

    if not exists (
        select 1
          from app_private.p0_route_graph_facts_at(
              timestamptz '2026-08-25T21:40:00+09:00'
          )
         where claim_id = 'claim.route.recruit.d.001'
           and value #>> '{transfer,source_units}' = '1'
           and value #>> '{transfer,destination_units}' = '1'
           and value #>> '{transfer,minimum_source_units}' = '1'
    ) then
        raise exception 'Recruit to d route tuple is absent or drifted';
    end if;

    if not exists (
        select 1
          from app_private.p0_route_graph_facts_at(
              timestamptz '2026-08-25T21:40:00+09:00'
          )
         where claim_id = 'claim.route.jal.ponta.low-tier.001'
           and value #>> '{transfer,maximum_source_units_per_request}' = '9000'
    ) then
        raise exception 'JAL to Ponta low-tier upper bound is absent';
    end if;

    if not exists (
        select 1
          from app_private.p0_route_graph_facts_at(
              timestamptz '2026-08-25T21:40:00+09:00'
          )
         where claim_id = 'claim.route.moppy.waon.001'
           and value #> '{transfer,allowed_source_amounts}' =
               '[500, 1000, 3000, 5000, 10000]'::jsonb
           and value #>> '{transfer,fee_schedule,numerator}' = '2'
           and value #>> '{transfer,fee_schedule,denominator}' = '100'
    ) then
        raise exception 'Moppy to WAON exact exchange menu is absent or drifted';
    end if;

    if not exists (
        select 1
          from app_private.p0_route_graph_facts_at(
              timestamptz '2026-08-25T21:40:00+09:00'
          )
         where claim_id = 'claim.route.ana.jr-kyupo.full-tier.001'
           and value #>> '{transfer,maximum_period}' = 'fiscal_year_april'
           and value #>> '{transfer,period_usage_key}' =
               'period.ana-partner-fiscal-year'
           and value #>> '{transfer,period_usage_max_source_units_exclusive}' =
               '20000'
    ) then
        raise exception 'ANA fiscal-year full-rate tier is absent or drifted';
    end if;
end
$exchange_route_completeness$;

rollback;
