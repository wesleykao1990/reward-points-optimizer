-- Japan Rewards Optimizer Milestone 2 hardening.
-- Target: PostgreSQL 15+ / Supabase-compatible Postgres.
-- This migration is additive and assumes 0001_core_schema.sql and
-- 0002_agent_feed_consumer.sql have already been applied.

begin;

-- ---------------------------------------------------------------------------
-- Permanent replay and review-event immutability.
-- ---------------------------------------------------------------------------

alter table app_private.canonical_replay_runs
    add column sealed_at timestamptz;

-- Existing replay rows predate explicit sealing. Treat their original insert
-- as the seal boundary so an additive upgrade cannot reopen their link set.
update app_private.canonical_replay_runs
   set sealed_at = created_at;

alter table app_private.canonical_replay_runs
    add constraint canonical_replay_seal_time_check
    check (sealed_at is null or sealed_at >= created_at);

create or replace function app_private.protect_canonical_replay_run()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    if tg_op = 'DELETE' then
        raise exception 'canonical replay runs cannot be deleted'
            using errcode = '55000';
    end if;

    -- A new run is assembled and sealed in one transaction. Sealing exactly
    -- once is the only permitted update.
    if old.sealed_at is null
       and new.sealed_at is not null
       and (to_jsonb(new) - 'sealed_at') = (to_jsonb(old) - 'sealed_at') then
        return new;
    end if;

    raise exception 'canonical replay runs are immutable after sealing'
        using errcode = '55000';
end;
$$;

revoke execute on function app_private.protect_canonical_replay_run() from public;

create trigger canonical_replay_runs_immutable
before update or delete on app_private.canonical_replay_runs
for each row execute function app_private.protect_canonical_replay_run();

create or replace function app_private.protect_canonical_replay_link_insert()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    if exists (
        select 1
          from app_private.canonical_replay_runs as run
         where run.id = new.replay_run_id
           and run.sealed_at is not null
    ) then
        raise exception 'canonical replay % is sealed', new.replay_run_id
            using errcode = '55000';
    end if;
    return new;
end;
$$;

revoke execute on function app_private.protect_canonical_replay_link_insert() from public;

create trigger canonical_replay_rule_versions_insert_guard
before insert on app_private.canonical_replay_rule_versions
for each row execute function app_private.protect_canonical_replay_link_insert();

create trigger canonical_replay_rule_versions_immutable
before update or delete on app_private.canonical_replay_rule_versions
for each row execute function app_private.reject_update_or_delete();

create or replace function app_private.assert_canonical_replay_sealed()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
    v_replay_run_id uuid;
begin
    if tg_table_name = 'canonical_replay_runs' then
        v_replay_run_id := (to_jsonb(new) ->> 'id')::uuid;
    else
        v_replay_run_id := (to_jsonb(new) ->> 'replay_run_id')::uuid;
    end if;

    if not exists (
        select 1
          from app_private.canonical_replay_runs as run
         where run.id = v_replay_run_id
           and run.sealed_at is not null
    ) then
        raise exception 'canonical replay % must be sealed before commit', v_replay_run_id
            using errcode = '23514';
    end if;
    return new;
end;
$$;

revoke execute on function app_private.assert_canonical_replay_sealed() from public;

create constraint trigger canonical_replay_runs_require_seal
after insert or update on app_private.canonical_replay_runs
deferrable initially deferred
for each row execute function app_private.assert_canonical_replay_sealed();

create constraint trigger canonical_replay_links_require_seal
after insert on app_private.canonical_replay_rule_versions
deferrable initially deferred
for each row execute function app_private.assert_canonical_replay_sealed();

-- ---------------------------------------------------------------------------
-- Retention purge for deletable user history.
-- ---------------------------------------------------------------------------

create or replace function app_private.purge_expired_user_history(
    p_now timestamptz default now()
)
returns table (
    recommendations_deleted bigint,
    correction_reports_deleted bigint
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_recommendations_deleted bigint := 0;
    v_correction_reports_deleted bigint := 0;
begin
    -- A null cutoff is not a useful retention decision.  Fail closed rather
    -- than interpreting it as an unbounded purge.
    if p_now is null then
        raise exception 'p_now must not be null'
            using errcode = '22004';
    end if;

    -- Correction reports have their own retention deadline.  A report also
    -- follows an expiring non-legal-hold recommendation even when its own
    -- deadline is later, so deletion cannot leave a dangling derived record.
    delete from user_data.correction_reports as cr
     where (
            cr.purge_after <= p_now
            and not exists (
                select 1
                  from user_data.user_recommendation_history as held
                 where held.id = cr.recommendation_history_id
                   and held.retention_class = 'legal_hold'
            )
        )
        or exists (
            select 1
              from user_data.user_recommendation_history as h
             where h.id = cr.recommendation_history_id
               and h.retention_class <> 'legal_hold'
               and h.purge_after <= p_now
        );
    get diagnostics v_correction_reports_deleted = row_count;

    -- The child recommendation-rule join rows are removed by its ON DELETE
    -- CASCADE foreign key.  Legal-hold and not-yet-expired histories remain.
    delete from user_data.user_recommendation_history as h
     where h.retention_class <> 'legal_hold'
       and h.purge_after <= p_now;
    get diagnostics v_recommendations_deleted = row_count;

    recommendations_deleted := v_recommendations_deleted;
    correction_reports_deleted := v_correction_reports_deleted;
    return next;
end;
$$;

revoke execute on function app_private.purge_expired_user_history(timestamptz) from public;

-- FORCE RLS applies to table owners. Give only the migration/function owner
-- the read/delete policies needed by the fixed purge routine; client roles
-- remain denied until separately installed auth.uid()-based policies exist.
do $$
declare
    v_owner name := current_user;
begin
    execute format(
        'create policy retention_purge_owner_read on user_data.user_recommendation_history for select to %I using (true)',
        v_owner
    );
    execute format(
        'create policy retention_purge_owner_delete on user_data.user_recommendation_history for delete to %I using (true)',
        v_owner
    );
    execute format(
        'create policy retention_correction_owner_read on user_data.correction_reports for select to %I using (true)',
        v_owner
    );
    execute format(
        'create policy retention_correction_owner_delete on user_data.correction_reports for delete to %I using (true)',
        v_owner
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- User-fact and cap-state semantic constraints.
-- ---------------------------------------------------------------------------

alter table user_data.user_facts
    add constraint user_facts_semantic_state_check
    check (
        (
            status = 'known'
            and value is not null
            and value <> 'null'::jsonb
            and observed_at is not null
            and lower_bound is null
            and upper_bound is null
            and source not in ('unknown', 'inferred')
        )
        or (
            status = 'estimated'
            -- Keep this expression self-contained. RLS client roles must not
            -- need EXECUTE on an app_private helper merely to satisfy a table
            -- constraint.
            and case
                    when jsonb_typeof(lower_bound) in ('number', 'string')
                     and lower_bound #>> '{}' ~ '^-?[0-9]+(?:\.[0-9]+)?$'
                    then (lower_bound #>> '{}')::numeric
                end is not null
            and case
                    when jsonb_typeof(upper_bound) in ('number', 'string')
                     and upper_bound #>> '{}' ~ '^-?[0-9]+(?:\.[0-9]+)?$'
                    then (upper_bound #>> '{}')::numeric
                end is not null
            and (case
                    when jsonb_typeof(lower_bound) in ('number', 'string')
                     and lower_bound #>> '{}' ~ '^-?[0-9]+(?:\.[0-9]+)?$'
                    then (lower_bound #>> '{}')::numeric
                 end)
                <=
                (case
                    when jsonb_typeof(upper_bound) in ('number', 'string')
                     and upper_bound #>> '{}' ~ '^-?[0-9]+(?:\.[0-9]+)?$'
                    then (upper_bound #>> '{}')::numeric
                 end)
            and confidence is not null
            and observed_at is not null
            and source <> 'unknown'
        )
        or (
            status in ('unknown', 'not_applicable')
            and (value is null or value = 'null'::jsonb)
            and (lower_bound is null or lower_bound = 'null'::jsonb)
            and (upper_bound is null or upper_bound = 'null'::jsonb)
            and confidence is null
        )
    );

alter table user_data.user_cap_progress
    add constraint user_cap_progress_unknown_bounds_null
    check (
        status not in ('unknown', 'not_applicable')
        or (
            eligible_spend_jpy_min is null
            and eligible_spend_jpy_max is null
            and reward_earned_units_min is null
            and reward_earned_units_max is null
        )
    );

-- ---------------------------------------------------------------------------
-- Review-mode arrays and terminal reviewer identity.
-- ---------------------------------------------------------------------------

alter table app_private.evidence_records
    add constraint evidence_records_review_modes_allowed
    check (
        required_review_modes <@ array[
            'solo_dual_pass', 'agent_challenged',
            'human_second_review', 'expert_review'
        ]::text[]
        and completed_review_modes <@ array[
            'solo_dual_pass', 'agent_challenged',
            'human_second_review', 'expert_review'
        ]::text[]
    );

alter table app_private.reward_rule_versions
    add constraint reward_rule_versions_review_modes_allowed
    check (
        required_review_modes <@ array[
            'solo_dual_pass', 'agent_challenged',
            'human_second_review', 'expert_review'
        ]::text[]
        and completed_review_modes <@ array[
            'solo_dual_pass', 'agent_challenged',
            'human_second_review', 'expert_review'
        ]::text[]
    );

alter table app_private.scenario_fixtures
    add constraint scenario_fixtures_review_modes_allowed
    check (
        required_review_modes <@ array[
            'solo_dual_pass', 'agent_challenged',
            'human_second_review', 'expert_review'
        ]::text[]
        and completed_review_modes <@ array[
            'solo_dual_pass', 'agent_challenged',
            'human_second_review', 'expert_review'
        ]::text[]
    );

alter table app_private.evidence_records
    add constraint evidence_records_verified_reviewer_required
    check (status <> 'verified' or reviewed_by is not null);

alter table app_private.reward_rule_versions
    add constraint reward_rule_versions_approved_reviewer_required
    check (review_status <> 'approved' or reviewed_by is not null);

alter table app_private.scenario_fixtures
    add constraint scenario_fixtures_completed_reviewer_required
    check (status not in ('reviewed', 'golden') or reviewed_by is not null);

-- ---------------------------------------------------------------------------
-- Approved reward-rule completion gate.
-- ---------------------------------------------------------------------------

create or replace function app_private.assert_approved_reward_rule_completion(
    p_rule_version_id uuid
)
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
    v_required text[];
    v_completed text[];
    v_mode text;
begin
    select rrv.required_review_modes, rrv.completed_review_modes
      into v_required, v_completed
      from app_private.reward_rule_versions as rrv
     where rrv.id = p_rule_version_id
       and rrv.review_status = 'approved';

    -- Draft, under-review, and rejected versions are intentionally not gated;
    -- an approved row is the terminal state that needs the complete evidence
    -- and immutable-review proof.
    if not found then
        return;
    end if;

    for v_mode in
        select distinct mode
          from unnest(coalesce(v_required, '{}'::text[]) ||
                      coalesce(v_completed, '{}'::text[])) as modes(mode)
    loop
        if not exists (
            select 1
              from app_private.review_items as ri
              join app_private.review_decisions as rd
                on rd.review_item_id = ri.id
               and rd.review_mode = v_mode
               and rd.decision = 'approved'
             where ri.subject_type = 'reward_rule_version'
               and ri.subject_id = p_rule_version_id
        ) then
            raise exception
                'approved reward rule version % is missing an approved immutable review decision for mode %',
                p_rule_version_id, v_mode
                using errcode = '23514';
        end if;
    end loop;

    if not exists (
        select 1
          from app_private.rule_evidence as re
          join app_private.evidence_records as er on er.id = re.evidence_id
         where re.rule_version_id = p_rule_version_id
           and er.status = 'verified'
    ) then
        raise exception
            'approved reward rule version % requires at least one linked verified evidence record',
            p_rule_version_id
            using errcode = '23514';
    end if;
end;
$$;

revoke execute on function app_private.assert_approved_reward_rule_completion(uuid) from public;

-- Do not grandfather pre-migration approved rows whose completion arrays were
-- never backed by immutable decisions and verified evidence. Deployments must
-- backfill legitimate review records before applying this hardening step.
do $$
declare
    v_rule_version_id uuid;
begin
    for v_rule_version_id in
        select id
          from app_private.reward_rule_versions
         where review_status = 'approved'
    loop
        perform app_private.assert_approved_reward_rule_completion(v_rule_version_id);
    end loop;
end;
$$;

create or replace function app_private.enforce_approved_reward_rule_completion()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
    v_rule_version_id uuid;
begin
    if tg_table_name = 'reward_rule_versions' then
        if tg_op in ('INSERT', 'UPDATE') then
            perform app_private.assert_approved_reward_rule_completion(new.id);
        end if;
        return coalesce(new, old);
    end if;

    if tg_table_name = 'rule_evidence' then
        if tg_op in ('INSERT', 'UPDATE') then
            perform app_private.assert_approved_reward_rule_completion(new.rule_version_id);
        end if;
        if tg_op in ('UPDATE', 'DELETE') then
            perform app_private.assert_approved_reward_rule_completion(old.rule_version_id);
        end if;
        return coalesce(new, old);
    end if;

    if tg_table_name = 'review_items' then
        if tg_op in ('INSERT', 'UPDATE')
           and new.subject_type = 'reward_rule_version'
           and new.subject_id is not null then
            perform app_private.assert_approved_reward_rule_completion(new.subject_id);
        end if;
        if tg_op in ('UPDATE', 'DELETE')
           and old.subject_type = 'reward_rule_version'
           and old.subject_id is not null then
            perform app_private.assert_approved_reward_rule_completion(old.subject_id);
        end if;
        return coalesce(new, old);
    end if;

    if tg_table_name = 'review_decisions' then
        if tg_op in ('INSERT', 'UPDATE') then
            select ri.subject_id
              into v_rule_version_id
              from app_private.review_items as ri
             where ri.id = new.review_item_id
               and ri.subject_type = 'reward_rule_version';
            if v_rule_version_id is not null then
                perform app_private.assert_approved_reward_rule_completion(v_rule_version_id);
            end if;
        end if;
        if tg_op in ('UPDATE', 'DELETE') then
            select ri.subject_id
              into v_rule_version_id
              from app_private.review_items as ri
             where ri.id = old.review_item_id
               and ri.subject_type = 'reward_rule_version';
            if v_rule_version_id is not null then
                perform app_private.assert_approved_reward_rule_completion(v_rule_version_id);
            end if;
        end if;
        return coalesce(new, old);
    end if;

    if tg_table_name = 'evidence_records' then
        if tg_op in ('INSERT', 'UPDATE') then
            for v_rule_version_id in
                select re.rule_version_id
                  from app_private.rule_evidence as re
                 where re.evidence_id = new.id
            loop
                perform app_private.assert_approved_reward_rule_completion(v_rule_version_id);
            end loop;
        end if;
        if tg_op in ('UPDATE', 'DELETE') then
            for v_rule_version_id in
                select re.rule_version_id
                  from app_private.rule_evidence as re
                 where re.evidence_id = old.id
            loop
                perform app_private.assert_approved_reward_rule_completion(v_rule_version_id);
            end loop;
        end if;
        return coalesce(new, old);
    end if;

    return coalesce(new, old);
end;
$$;

revoke execute on function app_private.enforce_approved_reward_rule_completion() from public;

-- Deferred checks permit a legitimate transaction to create a draft, evidence,
-- review item, immutable approved decision, and rule-evidence link in any order,
-- while SET CONSTRAINTS or transaction commit still rejects forged arrays.
create constraint trigger reward_rule_versions_review_completion
after insert or update on app_private.reward_rule_versions
deferrable initially deferred
for each row execute function app_private.enforce_approved_reward_rule_completion();

create constraint trigger rule_evidence_review_completion
after insert or update or delete on app_private.rule_evidence
deferrable initially deferred
for each row execute function app_private.enforce_approved_reward_rule_completion();

create constraint trigger review_items_review_completion
after insert or update or delete on app_private.review_items
deferrable initially deferred
for each row execute function app_private.enforce_approved_reward_rule_completion();

create constraint trigger review_decisions_review_completion
after insert or update or delete on app_private.review_decisions
deferrable initially deferred
for each row execute function app_private.enforce_approved_reward_rule_completion();

create constraint trigger evidence_records_review_completion
after insert or update or delete on app_private.evidence_records
deferrable initially deferred
for each row execute function app_private.enforce_approved_reward_rule_completion();

-- ---------------------------------------------------------------------------
-- Deployment-specific user-data RLS installer.
-- ---------------------------------------------------------------------------

create or replace function app_private.install_user_data_rls_policies(
    p_role name
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare
    v_role text;
    v_table text;
    v_policy_suffix text;
    v_permissive_policy text;
    v_restrictive_policy text;
    v_owner_expression text;
    v_tables constant text[] := array[
        'user_profiles',
        'user_wallet_items',
        'user_facts',
        'user_asset_lots',
        'user_valuation_profiles',
        'user_valuation_entries',
        'user_cap_progress',
        'user_recommendation_history',
        'user_recommendation_rule_versions',
        'correction_reports'
    ];
begin
    if p_role is null or btrim(p_role::text) = '' then
        raise exception 'p_role must name an existing non-privileged role'
            using errcode = '22004';
    end if;

    v_role := p_role::text;

    if not exists (select 1 from pg_roles where rolname = v_role) then
        raise exception 'role % does not exist', v_role
            using errcode = '42704';
    end if;

    if exists (
        select 1
          from pg_roles
         where rolname = v_role
           and (rolsuper or rolbypassrls)
    ) then
        raise exception 'role % must not be a superuser or BYPASSRLS role', v_role
            using errcode = '42501';
    end if;

    -- Resolve the auth provider before creating any policy.  At runtime a
    -- NULL auth.uid() still fails closed because every expression tests it.
    if to_regprocedure('auth.uid()') is null then
        raise exception 'auth.uid() is required before installing user-data RLS policies'
            using errcode = '42704';
    end if;

    foreach v_table in array v_tables loop
        if v_table in (
            'user_profiles', 'user_wallet_items', 'user_facts',
            'user_asset_lots', 'user_valuation_profiles', 'user_cap_progress',
            'user_recommendation_history', 'correction_reports'
        ) then
            v_owner_expression :=
                '(auth.uid() is not null and user_id = auth.uid())';
        elsif v_table = 'user_valuation_entries' then
            v_owner_expression :=
                '(auth.uid() is not null and exists (' ||
                'select 1 from user_data.user_valuation_profiles as parent ' ||
                'where parent.id = valuation_profile_id ' ||
                'and parent.user_id = auth.uid()))';
        elsif v_table = 'user_recommendation_rule_versions' then
            v_owner_expression :=
                '(auth.uid() is not null and exists (' ||
                'select 1 from user_data.user_recommendation_history as parent ' ||
                'where parent.id = recommendation_history_id ' ||
                'and parent.user_id = auth.uid()))';
        else
            raise exception 'unhandled user-data table %', v_table
                using errcode = '22023';
        end if;

        -- Policy names are deterministic and bounded even for a maximum-length
        -- PostgreSQL role name.  The policy body contains only fixed table
        -- names/expressions; the role and identifiers are always %I-quoted.
        v_policy_suffix := substr(md5(v_role || ':' || v_table), 1, 16);
        v_permissive_policy := 'owner_' || v_policy_suffix;
        v_restrictive_policy := 'owner_restrict_' || v_policy_suffix;

        execute format(
            'drop policy if exists %I on user_data.%I',
            v_permissive_policy, v_table
        );
        execute format(
            'drop policy if exists %I on user_data.%I',
            v_restrictive_policy, v_table
        );

        execute format(
            'create policy %I on user_data.%I as permissive for all to %I using (%s) with check (%s)',
            v_permissive_policy, v_table, v_role,
            v_owner_expression, v_owner_expression
        );
        -- The restrictive companion prevents a separately-installed broad
        -- permissive policy for this role from weakening owner isolation.
        execute format(
            'create policy %I on user_data.%I as restrictive for all to %I using (%s) with check (%s)',
            v_restrictive_policy, v_table, v_role,
            v_owner_expression, v_owner_expression
        );
    end loop;
end;
$$;

revoke execute on function app_private.install_user_data_rls_policies(name) from public;

-- ---------------------------------------------------------------------------
-- Close privilege gaps for objects that already existed before this migration.
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema app_private from public;
revoke execute on all functions in schema app_api from public;
revoke execute on all functions in schema user_data from public;
revoke all on all sequences in schema app_private from public;
revoke all on all sequences in schema app_api from public;
revoke all on all sequences in schema user_data from public;

do $$
declare
    v_role text;
    v_schema text;
begin
    foreach v_role in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = v_role) then
            foreach v_schema in array array['app_private', 'app_api', 'user_data'] loop
                execute format(
                    'revoke all on all tables in schema %I from %I',
                    v_schema, v_role
                );
                execute format(
                    'revoke execute on all functions in schema %I from %I',
                    v_schema, v_role
                );
                execute format(
                    'revoke all on all sequences in schema %I from %I',
                    v_schema, v_role
                );
                execute format(
                    'alter default privileges in schema %I revoke execute on functions from %I',
                    v_schema, v_role
                );
                execute format(
                    'alter default privileges in schema %I revoke all on tables from %I',
                    v_schema, v_role
                );
                execute format(
                    'alter default privileges in schema %I revoke all on sequences from %I',
                    v_schema, v_role
                );
            end loop;
        end if;
    end loop;
end;
$$;

commit;
