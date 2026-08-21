\set ON_ERROR_STOP on

begin;

-- Run as a role allowed to create/drop test roles, normally the isolated-test
-- database owner.  The transaction gives role and grant cleanup even when a
-- later assertion fails.
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'jro_view_test') then
        execute 'drop owned by jro_view_test';
        execute 'drop role jro_view_test';
    end if;
    execute 'create role jro_view_test nologin nobypassrls';
    -- PostgreSQL 16 grants a role creator ADMIN but not SET membership by
    -- default. Add explicit membership so this test also works for a
    -- non-superuser database owner with CREATEROLE.
    execute format('grant jro_view_test to %I', session_user);
end
$$;

do $$
declare
    v_super boolean;
    v_bypass boolean;
begin
    select rolsuper, rolbypassrls
      into v_super, v_bypass
      from pg_roles
     where rolname = 'jro_view_test';
    if v_super or v_bypass then
        raise exception 'view test role must be neither superuser nor BYPASSRLS';
    end if;
end
$$;

grant usage on schema app_api to jro_view_test;
grant select on app_api.verified_sources, app_api.approved_reward_rule_versions to jro_view_test;

-- The migration must keep both controls explicit on both views.  Do not rely
-- on a view's default reloptions, which can silently change across upgrades.
do $$
declare
    view_name text;
begin
    foreach view_name in array array['verified_sources', 'approved_reward_rule_versions'] loop
        if not exists (
            select 1
              from pg_class c
              join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'app_api'
               and c.relname = view_name
               and c.relkind = 'v'
               and array['security_invoker=true', 'security_barrier=true']::text[] <@ coalesce(c.reloptions, '{}'::text[])
        ) then
            raise exception 'app_api.% must declare security_invoker=true and security_barrier=true', view_name;
        end if;
    end loop;
end
$$;

set role jro_view_test;

do $$
declare
    v_state text;
begin
    begin
        perform count(*) from app_api.verified_sources;
        raise exception 'verified_sources unexpectedly succeeded without underlying grants';
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
        if v_state <> '42501' then
            raise exception 'verified_sources expected SQLSTATE 42501, got %', v_state;
        end if;
    end;
end
$$;

do $$
declare
    v_state text;
begin
    begin
        perform count(*) from app_api.approved_reward_rule_versions;
        raise exception 'approved_reward_rule_versions unexpectedly succeeded without underlying grants';
    exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
        if v_state <> '42501' then
            raise exception 'approved_reward_rule_versions expected SQLSTATE 42501, got %', v_state;
        end if;
    end;
end
$$;

reset role;

-- A deliberate backend role can be granted only the underlying reads required by the views.
grant usage on schema app_private to jro_view_test;
grant select on app_private.trusted_sources,
                app_private.reward_rules,
                app_private.reward_rule_versions
to jro_view_test;

set role jro_view_test;
select count(*) from app_api.verified_sources;
select count(*) from app_api.approved_reward_rule_versions;
reset role;

rollback;
