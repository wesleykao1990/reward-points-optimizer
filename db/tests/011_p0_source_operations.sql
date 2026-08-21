\set ON_ERROR_STOP on
begin;

do $$
declare
    v_plan app_private.p0_source_plan_versions%rowtype;
    v_options text[];
begin
    select * into strict v_plan from app_private.p0_source_plan_versions;
    if v_plan.plan_sha256 is distinct from 'sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003'
       or v_plan.version is distinct from 'p0-source-role-plan.v0.1'
       or v_plan.source_commit is distinct from '53169b92619a4e2deba3560470227600d2eae37e'
       or v_plan.source_sha256 is distinct from 'sha256:4a85de81eb5a5fcfcd31b9605ef536fca7e161d465065b8c683e3c74d69b35a4'
       or v_plan.family_count <> 44
       or v_plan.stream_count <> 19
       or v_plan.required_role_count <> 301
       or v_plan.sealed_at is null
    then
        raise exception 'P0 source plan identity/counts are not exact';
    end if;

    if (select count(*) from app_private.p0_source_families) <> 44
       or (select count(distinct stream_id) from app_private.p0_source_families) <> 19
       or (select count(*) from app_private.p0_source_role_requirements) <> 301
       or (select count(*) from app_private.p0_source_role_operational_state) <> 301
    then
        raise exception 'P0 family/stream/role expansion counts are not exact';
    end if;

    if (select count(*) from app_private.p0_source_families where baseline_planning_status = 'covered') <> 34
       or (select count(*) from app_private.p0_source_families where baseline_planning_status = 'partial') <> 8
       or (select count(*) from app_private.p0_source_families where baseline_planning_status = 'missing') <> 2
    then
        raise exception 'P0 baseline planning status counts are not exact';
    end if;

    if (select count(*) from app_private.p0_source_family_readiness) <> 44
       or (select count(*) from app_private.p0_source_family_readiness where ready) <> 0
       or (select count(*) from app_private.p0_source_role_readiness where ready) <> 0
       or (select count(*) from app_private.p0_source_role_readiness where experimental_eligible) <> 1
    then
        raise exception 'P0 readiness must start at zero with one separate experimental role';
    end if;

    if not exists (
        select 1
          from app_private.p0_source_role_readiness
         where family_id = 'merchant.7eleven'
           and source_role_id = 'accepted_payment_methods'
           and experimental_eligible
           and not ready
           and blockers = '["producer_not_authorized","permission_not_approved","technical_path_unknown","liveness_not_healthy","canonical_evidence_missing","impact_not_mapped"]'::jsonb
    ) then
        raise exception 'Seven-Eleven rehearsal role is not explicitly experimental and blocked';
    end if;

    if not exists (
        select 1
          from app_private.p0_source_family_readiness
         where family_id = 'card.rakuten'
           and baseline_planning_status = 'covered'
           and not ready
           and ready_role_count = 0
    ) then
        raise exception 'planning covered was incorrectly treated as family support';
    end if;

    if (select count(*) from app_private.p0_source_families where category = 'credit_card_issuer') <> 7
       or exists (select 1 from app_private.p0_source_families where family_id like 'card.rakuten.%')
    then
        raise exception 'source-family plan was broadened into selectable card SKUs';
    end if;

    select reloptions into v_options
      from pg_class
     where oid = 'app_private.p0_source_role_readiness'::regclass;
    if not (array['security_invoker=true','security_barrier=true']::text[] <@ coalesce(v_options, '{}'::text[])) then
        raise exception 'P0 role readiness view must be invoker and security barrier';
    end if;
    select reloptions into v_options
      from pg_class
     where oid = 'app_private.p0_source_family_readiness'::regclass;
    if not (array['security_invoker=true','security_barrier=true']::text[] <@ coalesce(v_options, '{}'::text[])) then
        raise exception 'P0 family readiness view must be invoker and security barrier';
    end if;
end;
$$;

do $$
begin
    if has_table_privilege('public', 'app_private.p0_source_plan_versions', 'select')
       or has_table_privilege('public', 'app_private.p0_source_families', 'select')
       or has_table_privilege('public', 'app_private.p0_source_role_requirements', 'select')
       or has_table_privilege('public', 'app_private.p0_source_role_operational_state', 'select')
       or has_table_privilege('public', 'app_private.p0_source_role_readiness', 'select')
       or has_table_privilege('public', 'app_private.p0_source_family_readiness', 'select')
       or has_function_privilege(
           'public',
           'app_private.reject_p0_source_operations_mutation()',
           'execute'
       )
       or has_function_privilege(
           'public',
           'app_private.seal_p0_source_operations_plan()',
           'execute'
       )
       or has_function_privilege(
           'public',
           'app_private.reject_p0_source_operations_insert_after_seal()',
           'execute'
       )
       or has_function_privilege(
           'public',
           'app_private.reject_p0_source_operations_truncate()',
           'execute'
       )
    then
        raise exception 'PUBLIC can access the private P0 source-operations boundary';
    end if;
end;
$$;

do $$
declare
    v_denied boolean := false;
begin
    execute 'create role p0_source_ops_test nosuperuser noinherit';
    execute 'grant usage on schema app_private to p0_source_ops_test';
    execute 'set local role p0_source_ops_test';
    begin
        perform count(*) from app_private.p0_source_family_readiness;
    exception when insufficient_privilege then
        v_denied := true;
    end;
    if not v_denied then
        raise exception 'nonsuper role unexpectedly read P0 source readiness';
    end if;
    execute 'reset role';
    execute 'revoke usage on schema app_private from p0_source_ops_test';
    execute 'drop role p0_source_ops_test';
end;
$$;

do $$
begin
    begin
        update app_private.p0_source_plan_versions
           set sealed_at = clock_timestamp();
        raise exception 'P0 plan reseal was accepted';
    exception when sqlstate '55000' then null;
    end;
    begin
        update app_private.p0_source_families
           set baseline_planning_status = 'missing'
         where family_id = 'card.rakuten';
        raise exception 'P0 family snapshot update was accepted';
    exception when sqlstate '55000' then null;
    end;
    begin
        delete from app_private.p0_source_role_operational_state
         where family_id = 'merchant.7eleven'
           and source_role_id = 'accepted_payment_methods';
        raise exception 'P0 operational snapshot delete was accepted';
    exception when sqlstate '55000' then null;
    end;
    begin
        insert into app_private.p0_source_families (
            plan_sha256,
            family_id,
            category,
            provider_or_scope,
            priority,
            baseline_planning_status,
            stream_id,
            recommended_cadence_seconds
        ) values (
            'sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003',
            'merchant.unreviewed-extra',
            'merchant',
            'Unreviewed extra family',
            'P0',
            'missing',
            'merchant.jp-convenience',
            86400
        );
        raise exception 'post-seal P0 family insert was accepted';
    exception when sqlstate '55000' then null;
    end;
    begin
        insert into app_private.p0_source_role_requirements (
            plan_sha256,
            family_id,
            source_role_id
        ) values (
            'sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003',
            'merchant.7eleven',
            'unreviewed_extra_role'
        );
        raise exception 'post-seal P0 role insert was accepted';
    exception when sqlstate '55000' then null;
    end;
    begin
        insert into app_private.p0_source_role_operational_state (
            plan_sha256,
            family_id,
            source_role_id,
            producer_status,
            permission_status,
            technical_status,
            liveness_status,
            evidence_status,
            impact_status,
            experimental_eligible
        ) values (
            'sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003',
            'merchant.7eleven',
            'accepted_payment_methods',
            'authorized',
            'approved_automated',
            'plain_http',
            'healthy',
            'canonical_current',
            'mapped',
            false
        );
        raise exception 'post-seal P0 operational-state insert was accepted';
    exception when sqlstate '55000' then null;
    end;
    begin
        truncate app_private.p0_source_role_operational_state;
        raise exception 'P0 operational snapshot truncate was accepted';
    exception when sqlstate '55000' then null;
    end;
    if (select count(*) from app_private.p0_source_role_operational_state) <> 301 then
        raise exception 'P0 immutability probe changed durable state';
    end if;
    if (select count(*) from app_private.p0_source_families) <> 44
       or (select count(*) from app_private.p0_source_role_requirements) <> 301
    then
        raise exception 'P0 post-seal insert probe changed durable state';
    end if;
end;
$$;

do $$
begin
    if exists (
        select 1
          from app_private.reward_rule_versions as version
          join app_private.reward_rules as rule on rule.id = version.rule_id
         where rule.rule_key = 'rr_jp_cvs_002_b_accept_credit_card'
           and version.review_status = 'approved'
    )
       or exists (
           select 1
             from app_private.rule_publication_requests as request
             join app_private.reward_rules as rule on rule.id = request.rule_id
            where rule.rule_key = 'rr_jp_cvs_002_b_accept_credit_card'
       )
    then
        raise exception 'P0 planning seed altered canonical rule/publication state';
    end if;
    if (select count(*) from app_api.active_experimental_provisional_rules
         where candidate_hash =
           'sha256:f931acf332c5432cca86af671798fe321353d11e49490d61e45b4df458e250bb') <> 1 then
        raise exception 'P0 planning seed altered the provisional candidate lane';
    end if;
end;
$$;

rollback;
