\set ON_ERROR_STOP on

begin;

do $test$
declare
    v_snapshot jsonb;
    v_tampered jsonb;
    v_malformed jsonb;
    v_unknown jsonb;
    v_generic jsonb;
    v_out record;
    v_fact_id uuid;
    v_other_fact_id uuid;
    v_before_snapshots integer;
    v_before_facts integer;
    v_before_corrections integer;
    v_before_candidates integer;
    v_before_rules integer;
    v_before_versions integer;
    v_before_evidence integer;
    v_sqlstate text;
    v_options text[];
    v_is_definer boolean;
    v_config text[];
    v_claim_id text := 'claim.point.d.earn.mobile-basic.001';
    v_other_claim text := 'claim.point.d.earn.mobile-card-tiers.002';
begin
    select count(*) into v_before_snapshots
      from app_private.p0_implementation_snapshots;
    select count(*) into v_before_facts
      from app_private.p0_implementation_facts;
    select count(*) into v_before_corrections
      from app_private.p0_implementation_fact_corrections;
    select count(*) into v_before_candidates
      from app_private.provisional_rule_candidates;
    select count(*) into v_before_rules from app_private.reward_rules;
    select count(*) into v_before_versions from app_private.reward_rule_versions;
    select count(*) into v_before_evidence from app_private.evidence_records;

    if v_before_snapshots <> 4
       or v_before_facts <> 364
       or v_before_corrections <> 0
       or (select count(*) from app_api.p0_active_implementation_facts) <> 364
    then
        raise exception 'P0 implementation seeds did not persist exactly 4 snapshots and 364 facts';
    end if;
    if (select count(*) from app_private.p0_implementation_facts where candidate_id is not null) <> 0
       or (select count(*) from app_private.p0_implementation_snapshots where derived_rule_count <> 0) <> 0
    then
        raise exception 'zero-derived snapshot unexpectedly created candidate links';
    end if;
    if exists (
        select 1
          from (values
              ('p0-point-rules-a.implementation.v0.1', 87),
              ('p0-point-rules-b.implementation.v0.4', 111),
              ('p0-wallet-card-rules.implementation.v0.5', 103),
              ('p0-merchant-transit-regulatory-rules.implementation.v0.6', 63)
          ) as expected(implementation_version, fact_count)
         where (select count(*) from app_private.p0_implementation_snapshots s
                 where s.implementation_version = expected.implementation_version) <> 1
            or (select count(*) from app_private.p0_implementation_facts f
                 where f.implementation_version = expected.implementation_version) <> expected.fact_count
    ) then
        raise exception 'P0 implementation snapshot conservation is incorrect';
    end if;
    if (select count(*) from app_api.p0_active_implementation_facts where family_id = 'point.d') <> 20
       or (select count(*) from app_api.p0_active_implementation_facts where family_id = 'point.jre') <> 12
       or (select count(*) from app_api.p0_active_implementation_facts where family_id = 'point.nanaco') <> 33
       or (select count(*) from app_api.p0_active_implementation_facts where family_id = 'point.paypay') <> 22
    then
        raise exception 'P0 implementation family distribution is incorrect';
    end if;
    if exists (
        select 1
          from information_schema.columns
         where table_schema = 'app_api'
           and table_name in ('p0_active_implementation_facts','p0_implementation_catalogue')
           and column_name in (
               'implementation_hash','value','evidence_locator','source_identity',
               'parent_claim_id'
           )
    ) then
        raise exception 'safe implementation view exposes hashes or raw evidence fields';
    end if;

    select snapshot_payload into strict v_snapshot
      from app_private.p0_implementation_snapshots
     where implementation_version = 'p0-point-rules-a.implementation.v0.1';
    select * into v_out
      from app_private.persist_p0_implementation_snapshot(v_snapshot);
    if v_out.outcome is distinct from 'duplicate'
       or v_out.fact_count <> 87
       or (select count(*) from app_private.p0_implementation_snapshots) <> v_before_snapshots
       or (select count(*) from app_private.p0_implementation_facts) <> v_before_facts
    then
        raise exception 'exact implementation retry was not idempotent';
    end if;

    v_tampered := jsonb_set(
        v_snapshot,
        '{implementation_hash}',
        to_jsonb(('sha256:' || repeat('0', 64))::text),
        false
    );
    v_sqlstate := null;
    begin
        perform app_private.persist_p0_implementation_snapshot(v_tampered);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '55000'
       or (select count(*) from app_private.p0_implementation_snapshots) <> v_before_snapshots
       or (select count(*) from app_private.p0_implementation_facts) <> v_before_facts
    then
        raise exception 'implementation version tamper was not rejected atomically';
    end if;

    v_unknown := jsonb_set(
        v_snapshot,
        '{artifact_type}',
        '"unknown_implementation"'::jsonb,
        false
    );
    v_sqlstate := null;
    begin
        perform app_private.persist_p0_implementation_snapshot(v_unknown);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '22023'
       or (select count(*) from app_private.p0_implementation_snapshots) <> v_before_snapshots
       or (select count(*) from app_private.p0_implementation_facts) <> v_before_facts
    then
        raise exception 'unknown implementation artifact type was accepted';
    end if;

    v_unknown := jsonb_set(
        v_snapshot,
        '{implementation_hash}',
        to_jsonb(('sha256:' || repeat('2', 64))::text),
        false
    );
    v_unknown := jsonb_set(
        v_unknown,
        '{entries,0,source_identity,0,roles}',
        '["earn_rules","earn_rules"]'::jsonb,
        false
    );
    v_sqlstate := null;
    begin
        perform app_private.persist_p0_implementation_snapshot(v_unknown);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '22023'
       or (select count(*) from app_private.p0_implementation_snapshots) <> v_before_snapshots
       or (select count(*) from app_private.p0_implementation_facts) <> v_before_facts
    then
        raise exception 'duplicate source identity roles were accepted';
    end if;

    v_unknown := jsonb_set(
        v_snapshot,
        '{implementation_hash}',
        to_jsonb(('sha256:' || repeat('3', 64))::text),
        false
    );
    v_unknown := jsonb_set(
        v_unknown,
        '{entries,0,source_identity,0,url}',
        'null'::jsonb,
        false
    );
    v_sqlstate := null;
    begin
        perform app_private.persist_p0_implementation_snapshot(v_unknown);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '22023'
       or (select count(*) from app_private.p0_implementation_snapshots) <> v_before_snapshots
       or (select count(*) from app_private.p0_implementation_facts) <> v_before_facts
    then
        raise exception 'null source identity URL was accepted';
    end if;

    v_malformed := jsonb_set(
        v_snapshot,
        '{version}',
        '"p0-point-rules-a.implementation.v0.1-malformed"'::jsonb,
        false
    );
    v_malformed := jsonb_set(
        v_malformed,
        '{implementation_hash}',
        to_jsonb(('sha256:' || repeat('1', 64))::text),
        false
    );
    v_malformed := jsonb_set(
        v_malformed,
        '{entries,86}',
        (v_malformed->'entries'->86) - 'short_paraphrase',
        false
    );
    v_sqlstate := null;
    begin
        perform app_private.persist_p0_implementation_snapshot(v_malformed);
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '22023'
       or exists (
           select 1 from app_private.p0_implementation_snapshots
            where implementation_version = 'p0-point-rules-a.implementation.v0.1-malformed'
       )
       or (select count(*) from app_private.p0_implementation_facts) <> v_before_facts
    then
        raise exception 'malformed final implementation fact caused a partial write';
    end if;

    -- A second artifact identity proves that the generic lane is not bound to
    -- the seeded Research-A identity. Research-B is a complete exact snapshot
    -- and remains a zero-derived catalogue until a later rule-link migration.
    select snapshot_payload into strict v_generic
      from app_private.p0_implementation_snapshots
     where implementation_version = 'p0-point-rules-b.implementation.v0.4';
    select * into v_out
      from app_private.persist_p0_implementation_snapshot(v_generic);
    if v_out.outcome is distinct from 'duplicate'
       or v_out.fact_count <> 111
       or v_out.derived_rule_count <> 0
       or (select count(*) from app_private.p0_implementation_snapshots) <> v_before_snapshots
       or (select count(*) from app_private.p0_implementation_facts) <> v_before_facts
    then
        raise exception 'generic Research-B implementation retry was not idempotent';
    end if;

    if exists (
        select 1
          from pg_constraint as constraint_row
          join pg_class as relation on relation.oid = constraint_row.conrelid
          join pg_namespace as namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'app_private'
           and relation.relname in (
               'p0_implementation_snapshots','p0_implementation_facts',
               'p0_implementation_fact_corrections'
           )
           and pg_get_constraintdef(constraint_row.oid) ~ 'p0-point-rules-a|4dd1'
    ) or pg_get_functiondef(
        'app_private.persist_p0_implementation_snapshot(jsonb)'::regprocedure
    ) ~ 'p0-point-rules-a|4dd1'
    then
        raise exception 'generic implementation contract retained a Research-A identity constant';
    end if;

    -- A correction is bound to exactly one implementation version/hash/fact
    -- version and immediately removes only that fact from the active view.
    select fact.fact_id into strict v_fact_id
      from app_private.p0_implementation_facts as fact
     where fact.parent_claim_id = v_claim_id
       and fact.implementation_version = 'p0-point-rules-a.implementation.v0.1';
    select fact.fact_id into strict v_other_fact_id
      from app_private.p0_implementation_facts as fact
     where fact.parent_claim_id = v_other_claim
       and fact.implementation_version = 'p0-point-rules-a.implementation.v0.1';
    select * into v_out
      from app_private.record_p0_implementation_fact_correction_by_id(
          v_fact_id,
          'p0_impl_correction_001',
          'Exact fact correction test'
      );
    if v_out.outcome is distinct from 'recorded'
       or (select count(*) from app_api.p0_active_implementation_facts) <> 363
       or exists (select 1 from app_api.p0_active_implementation_facts where fact_id = v_fact_id)
       or not exists (select 1 from app_api.p0_active_implementation_facts where fact_id = v_other_fact_id)
    then
        raise exception 'exact implementation fact correction did not hide only one fact';
    end if;
    select * into v_out
      from app_private.record_p0_implementation_fact_correction_by_id(
          v_fact_id,
          'p0_impl_correction_001',
          'Exact fact correction test'
      );
    if v_out.outcome is distinct from 'duplicate'
       or (select count(*) from app_private.p0_implementation_fact_corrections) <> 1
    then
        raise exception 'exact correction retry was not idempotent';
    end if;
    v_sqlstate := null;
    begin
        perform app_private.record_p0_implementation_fact_correction_by_id(
            v_fact_id,
            'p0_impl_correction_001',
            'Tampered correction text'
        );
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '55000'
       or (select count(*) from app_private.p0_implementation_fact_corrections) <> 1
    then
        raise exception 'correction ID tamper was accepted';
    end if;

    if (select count(*) from app_private.provisional_rule_candidates) <> v_before_candidates
       or (select count(*) from app_private.reward_rules) <> v_before_rules
       or (select count(*) from app_private.reward_rule_versions) <> v_before_versions
       or (select count(*) from app_private.evidence_records) <> v_before_evidence
    then
        raise exception 'generic implementation ingestion crossed a protected boundary';
    end if;

    select reloptions into v_options
      from pg_class as relation
      join pg_namespace as namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'app_api'
       and relation.relname = 'p0_active_implementation_facts';
    if not ('security_invoker=true' = any(v_options))
       or not ('security_barrier=true' = any(v_options))
       or has_table_privilege('public', 'app_api.p0_active_implementation_facts', 'select')
       or has_function_privilege(
           'public',
           'app_private.persist_p0_implementation_snapshot(jsonb)',
           'execute'
       )
       or has_function_privilege(
           'public',
           'app_private.record_p0_implementation_fact_correction_by_id(uuid,text,text)',
           'execute'
       )
       or has_function_privilege(
           'public',
           'app_private.p0_active_implementation_fact_rows()',
           'execute'
       )
    then
        raise exception 'generic implementation ACL/view security is too broad';
    end if;
    select prosecdef, proconfig into v_is_definer, v_config
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'app_private'
       and procedure.proname = 'persist_p0_implementation_snapshot';
    if not v_is_definer
       or not ('search_path=pg_catalog' = any(v_config))
    then
        raise exception 'snapshot function is not fixed SECURITY DEFINER';
    end if;
end
$test$;

do $role_test$
begin
    if not exists (select 1 from pg_roles where rolname = 'p0_impl_adapter_test') then
        execute 'create role p0_impl_adapter_test nosuperuser nologin noinherit';
    end if;
    execute 'grant usage on schema app_api to p0_impl_adapter_test';
    execute 'grant usage on schema app_private to p0_impl_adapter_test';
    execute 'grant select on app_api.p0_active_implementation_facts to p0_impl_adapter_test';
    execute 'grant execute on function app_private.p0_active_implementation_fact_rows() to p0_impl_adapter_test';
    if has_table_privilege('p0_impl_adapter_test', 'app_private.p0_implementation_facts', 'select') then
        raise exception 'restricted implementation adapter role can read private facts';
    end if;
end
$role_test$;

set role p0_impl_adapter_test;
select count(*) from app_api.p0_active_implementation_facts;
reset role;

revoke select on app_api.p0_active_implementation_facts from p0_impl_adapter_test;
revoke execute on function app_private.p0_active_implementation_fact_rows()
    from p0_impl_adapter_test;
revoke usage on schema app_private from p0_impl_adapter_test;
revoke usage on schema app_api from p0_impl_adapter_test;
drop role p0_impl_adapter_test;

rollback;
