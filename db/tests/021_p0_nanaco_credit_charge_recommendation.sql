begin;

do $test$
declare
    v_candidate jsonb;
    v_rejected boolean := false;
begin
    if (select count(*) from app_private.p0_nanaco_credit_charge_route_bindings) <> 1
       or (select count(*) from app_api.p0_nanaco_credit_charge_experimental_route) <> 1
       or (select count(*) from app_api.p0_nanaco_credit_charge_experimental_route_at(
               '2026-08-20T05:38:59+09:00'::timestamptz)) <> 0
       or (select count(*) from app_api.p0_nanaco_credit_charge_experimental_route_at(
               '2026-08-20T05:39:00+09:00'::timestamptz)) <> 1
    then
        raise exception 'Nanaco credit-charge route/window projection is incorrect';
    end if;

    select candidate_payload into strict v_candidate
      from app_api.p0_nanaco_credit_charge_experimental_route;

    if v_candidate->'rule'->'scope'->'operation_types' is distinct from
           '["stored_value_top_up"]'::jsonb
       or v_candidate->'rule'->'scope'->'operation_types' =
           '["merchant_purchase"]'::jsonb
       or v_candidate->'rule'->'calculation'->>'spend_jpy' is distinct from '200'
       or v_candidate->'rule'->'calculation'->>'reward_units' is distinct from '1'
       or v_candidate->'rule'->'provenance'->'human_verified' is distinct from 'false'::jsonb
       or v_candidate->'rule'->>'status' is distinct from 'under_review'
       or v_candidate->'rule'->'provenance'->'evidence_ids' is distinct from
          '["ev_m3_sevencard_nanaco_charge_20260820","ev_m3_nanaco_sevencard_earning_20260820"]'::jsonb
    then
        raise exception 'Nanaco credit-charge route lost its exact economic/provenance binding';
    end if;

    if (select count(*) from app_private.reward_rules) <> 6
       or (select count(*) from app_private.reward_rule_versions) <> 6
       or (select count(*) from app_private.evidence_records) <> 6
    then
        raise exception 'Experimental credit-charge seed changed canonical row counts';
    end if;

    begin
        perform app_private.persist_p0_nanaco_credit_charge_candidate(
            'sha256:3f40d8082021af23704564a0e0be870241d91490124c6912faff31beb19ce914',
            'sha256:62785ad9ee107ddeced93f54696a24b0f38eb4873b1339f7ff351d29fa57e92b',
            jsonb_set(v_candidate, '{rule,calculation,spend_jpy}', '201'::jsonb)
        );
    exception when sqlstate '22023' then
        v_rejected := true;
    end;
    if not v_rejected then
        raise exception 'Tampered Nanaco credit-charge economics were accepted';
    end if;

    v_rejected := false;
    begin
        update app_private.p0_nanaco_credit_charge_route_bindings
           set route_id = route_id;
    exception when sqlstate '55000' then
        v_rejected := true;
    end;
    if not v_rejected then
        raise exception 'Nanaco credit-charge route binding was mutable';
    end if;

    if has_table_privilege('public',
           'app_api.p0_nanaco_credit_charge_experimental_route', 'select')
       or has_function_privilege('public',
           'app_private.persist_p0_nanaco_credit_charge_candidate(text,text,jsonb)',
           'execute')
       or has_function_privilege('public',
           'app_api.p0_nanaco_credit_charge_experimental_route_at(timestamptz)',
           'execute')
    then
        raise exception 'Nanaco credit-charge route exposed PUBLIC privileges';
    end if;
end
$test$;

rollback;
