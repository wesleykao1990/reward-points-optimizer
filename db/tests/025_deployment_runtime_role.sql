\set ON_ERROR_STOP on

begin;

do $test$
declare
    v_role record;
begin
    select * into strict v_role from pg_roles where rolname = 'jro_runtime';
    if v_role.rolcanlogin
       or v_role.rolsuper
       or v_role.rolcreatedb
       or v_role.rolcreaterole
       or v_role.rolreplication
       or v_role.rolinherit then
        raise exception 'deployment runtime role has unsafe role attributes';
    end if;

    if not has_schema_privilege('jro_runtime', 'app_api', 'USAGE')
       or not has_schema_privilege('jro_runtime', 'app_private', 'USAGE')
       or not has_table_privilege(
           'jro_runtime',
           'app_api.p0_unverified_experimental_catalogue',
           'SELECT'
       )
       or not has_table_privilege(
           'jro_runtime',
           'app_private.provisional_rule_candidates',
           'SELECT'
       ) then
        raise exception 'deployment runtime read grants are incomplete';
    end if;

    if has_table_privilege(
           'jro_runtime',
           'app_private.provisional_rule_candidates',
           'INSERT,UPDATE,DELETE,TRUNCATE'
       )
       or has_table_privilege(
           'jro_runtime',
           'app_private.reward_rule_versions',
           'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
       )
       or has_table_privilege(
           'jro_runtime',
           'user_data.user_profiles',
           'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
       ) then
        raise exception 'deployment runtime acquired direct write or unrelated read access';
    end if;

    if not has_function_privilege(
           'jro_runtime',
           'app_private.record_provisional_correction(jsonb,text)',
           'EXECUTE'
       )
       or not has_function_privilege(
           'jro_runtime',
           'app_private.record_p0_implementation_fact_correction_by_id(uuid,text,text)',
           'EXECUTE'
       )
       or has_function_privilege(
           'jro_runtime',
           'app_private.persist_provisional_rule_candidate(text,text,jsonb)',
           'EXECUTE'
       ) then
        raise exception 'deployment runtime function boundary is unsafe';
    end if;
end;
$test$;

set local role jro_runtime;

select count(*) from app_api.p0_unverified_experimental_catalogue;
select count(*) from app_private.p0_active_implementation_fact_rows_at(
    '2026-08-22T00:00:00Z'::timestamptz
);
select count(*) from app_private.p0_implementation_fact_influence_graph_rows(
    '2026-08-22T00:00:00Z'::timestamptz
);
select count(*) from app_api.p0_nanaco_credit_charge_experimental_route_at(
    '2026-08-22T00:00:00Z'::timestamptz
);

reset role;

rollback;
