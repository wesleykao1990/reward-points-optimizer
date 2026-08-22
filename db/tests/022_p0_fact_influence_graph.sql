\set ON_ERROR_STOP on

begin;

do $test$
declare
    v_fact_id uuid;
    v_before integer;
    v_after integer;
    v_corrected boolean;
    v_order text;
    v_payload jsonb;
begin
    select count(*) into v_before
      from app_private.p0_implementation_fact_influence_graph_rows(
          '2026-08-22T00:00:00+09:00'::timestamptz
      );
    if v_before <> 364 then
        raise exception 'P0 influence graph did not retain all 364 facts: %', v_before;
    end if;
    if (select count(distinct graph_order)
          from app_private.p0_implementation_fact_influence_graph_rows(
              '2026-08-22T00:00:00+09:00'::timestamptz
          )) <> 364
    then
        raise exception 'P0 influence graph identity/order is not deterministic and unique';
    end if;
    if not exists (
        select 1
          from app_private.p0_implementation_fact_influence_graph_rows(
              '2026-09-01T00:00:00+09:00'::timestamptz
          )
         where active_at = false
    ) then
        raise exception 'P0 influence graph did not retain inactive effective-time history';
    end if;
    if (select count(*)
          from app_private.p0_implementation_fact_influence_graph_rows(
              '2026-08-22T00:00:00+09:00'::timestamptz
          )
         where parent_claim_id in (
             'claim.point.nanaco.earn.shopping-immediate.004',
             'claim.point.nanaco.earn.credit-charge.003'
         )
           and active_at = true) <> 2
    then
        raise exception 'P0 influence graph treated explicit null bounds as inactive';
    end if;
    if not exists (
        select 1
          from app_private.p0_implementation_fact_influence_graph_rows(
              '2026-08-22T00:00:00+09:00'::timestamptz
          ) as graph
         where graph.fact_payload is not distinct from (
             select fact.fact_payload
               from app_private.p0_implementation_facts as fact
              where fact.fact_id = graph.fact_id
         )
           and graph.value is not distinct from (
             select fact.value
               from app_private.p0_implementation_facts as fact
              where fact.fact_id = graph.fact_id
         )
    ) then
        raise exception 'P0 influence graph did not preserve exact server-side JSON material';
    end if;

    select fact_id into strict v_fact_id
      from app_private.p0_implementation_facts
     order by implementation_hash, parent_claim_id, fact_version
     limit 1;
    select graph_order, fact_payload into strict v_order, v_payload
      from app_private.p0_implementation_fact_influence_graph_rows(
          '2026-08-22T00:00:00+09:00'::timestamptz
      )
     where fact_id = v_fact_id;
    if v_order is null or v_payload is null then
        raise exception 'P0 influence graph omitted deterministic identity or payload';
    end if;

    perform app_private.record_p0_implementation_fact_correction_by_id(
        v_fact_id,
        'graph_test_correction_001',
        'graph correction preservation test'
    );
    select count(*) into v_after
      from app_private.p0_implementation_fact_influence_graph_rows(
          '2026-08-22T00:00:00+09:00'::timestamptz
      );
    select corrected into strict v_corrected
      from app_private.p0_implementation_fact_influence_graph_rows(
          '2026-08-22T00:00:00+09:00'::timestamptz
      )
     where fact_id = v_fact_id;
    if v_after <> 364 or v_corrected is not true then
        raise exception 'P0 influence graph dropped or failed to flag corrected history';
    end if;

    if has_function_privilege(
           'public',
           'app_private.p0_implementation_fact_influence_graph_rows(timestamptz)',
           'execute'
       )
    then
        raise exception 'P0 influence graph function exposed PUBLIC execute privilege';
    end if;
end
$test$;

rollback;
