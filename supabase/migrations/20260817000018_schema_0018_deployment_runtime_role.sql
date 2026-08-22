-- Staged from db/0018_deployment_runtime_role.sql; edit the canonical source, not this file.
-- Least-privilege role used by the Vercel serverless adapter.
--
-- The connection authenticates with the Supabase transaction-pooler account
-- and selects this NOLOGIN role in the PostgreSQL startup options. The role
-- can read only the bounded internal projections and can write only through
-- the two correction-sensitive SECURITY DEFINER routines.

begin;

create role jro_runtime
    nologin
    noinherit
    nosuperuser
    nocreatedb
    nocreaterole
    noreplication;

do $grant_runtime$
begin
    -- Hosted Supabase migrations run as `postgres`; disposable/local gates may
    -- use another database owner. Grant only the migration owner the ability
    -- to select the NOLOGIN role.
    execute format('grant jro_runtime to %I', current_user);
end;
$grant_runtime$;

grant usage on schema app_api, app_private to jro_runtime;

grant select on
    app_api.active_experimental_provisional_rules,
    app_api.p0_unverified_experimental_catalogue,
    app_api.p0_nanaco_credit_charge_experimental_route
to jro_runtime;

-- The API views are security_invoker views, so their exact underlying read
-- relations must also be granted. No broad schema or future-table grant is
-- installed.
grant select on
    app_private.provisional_rule_candidates,
    app_private.source_observations,
    app_private.p0_nanaco_credit_charge_route_bindings,
    app_private.evidence_records
to jro_runtime;

grant execute on function
    app_private.provisional_rule_valid_at(jsonb,timestamptz),
    app_private.record_provisional_correction(jsonb,text),
    app_private.p0_active_implementation_fact_rows_at(timestamptz),
    app_private.record_p0_implementation_fact_correction_by_id(uuid,text,text),
    app_private.p0_implementation_fact_influence_graph_rows(timestamptz),
    app_api.p0_nanaco_credit_charge_experimental_route_at(timestamptz)
to jro_runtime;

comment on role jro_runtime is
    'NOLOGIN Vercel runtime role: bounded catalogue reads and correction routines only.';

commit;
