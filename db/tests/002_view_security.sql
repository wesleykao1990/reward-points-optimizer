\set ON_ERROR_STOP on

-- Run as a role allowed to create/drop test roles, normally the isolated-test database owner.
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'jro_view_test') then
        execute 'drop owned by jro_view_test';
        execute 'drop role jro_view_test';
    end if;
    execute 'create role jro_view_test nologin';
end
$$;

grant usage on schema app_api to jro_view_test;
grant select on app_api.verified_sources, app_api.approved_reward_rule_versions to jro_view_test;

set role jro_view_test;

do $$
begin
    begin
        perform count(*) from app_api.verified_sources;
        raise exception 'security-invoker view unexpectedly lent underlying privileges';
    exception
        when insufficient_privilege then null;
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

drop owned by jro_view_test;
drop role jro_view_test;
