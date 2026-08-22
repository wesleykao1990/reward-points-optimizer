-- Staged from db/0005_m3_golden_publication_boundary.sql; edit the canonical source, not this file.
-- M3 reviewed-golden persistence and rule-publication boundary.
-- Target: PostgreSQL 15+ / Supabase-compatible Postgres.
-- This migration is additive and assumes 0001 through 0004 are applied.

begin;

-- A golden scenario is bound to exactly one immutable, sealed canonical replay.
-- The replay remains private and does not authorize a reward-rule publication.
create table app_private.scenario_canonical_replays (
    scenario_fixture_id uuid primary key
        references app_private.scenario_fixtures(id) on delete restrict,
    replay_run_id uuid not null unique
        references app_private.canonical_replay_runs(id) on delete restrict,
    created_at timestamptz not null default now()
);

comment on table app_private.scenario_canonical_replays is
    'Private one-to-one binding between a reviewed golden fixture and its sealed canonical replay; not a publication grant.';

revoke all on app_private.scenario_canonical_replays from public;

create or replace function app_private.assert_golden_scenario_completion(
    p_scenario_fixture_id uuid
)
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
    v_scenario app_private.scenario_fixtures%rowtype;
    v_replay_count integer;
begin
    select *
      into v_scenario
      from app_private.scenario_fixtures
     where id = p_scenario_fixture_id;

    if not found or v_scenario.status <> 'golden' then
        return;
    end if;

    if jsonb_typeof(v_scenario.fixture_payload) <> 'object'
       or v_scenario.fixture_payload ->> 'scenario_id' <> v_scenario.scenario_key
       or (v_scenario.fixture_payload ->> 'version')::integer <> v_scenario.version
       or v_scenario.fixture_payload ->> 'status' <> 'golden' then
        raise exception 'golden scenario % payload identity/status mismatch', p_scenario_fixture_id
            using errcode = '23514';
    end if;

    if v_scenario.fixture_payload #>> '{replay_provenance,publication_authorized}' <> 'false' then
        raise exception 'golden scenario % replay must not authorize publication', p_scenario_fixture_id
            using errcode = '23514';
    end if;

    -- Exact scenario evidence coverage and verified status.
    if exists (
        (select value #>> '{}' as evidence_key
           from jsonb_array_elements(v_scenario.fixture_payload -> 'evidence_ids'))
        except
        (select er.evidence_key
           from app_private.scenario_evidence se
           join app_private.evidence_records er on er.id = se.evidence_id
          where se.scenario_fixture_id = p_scenario_fixture_id)
    ) or exists (
        (select er.evidence_key
           from app_private.scenario_evidence se
           join app_private.evidence_records er on er.id = se.evidence_id
          where se.scenario_fixture_id = p_scenario_fixture_id)
        except
        (select value #>> '{}' as evidence_key
           from jsonb_array_elements(v_scenario.fixture_payload -> 'evidence_ids'))
    ) or exists (
        select 1
          from app_private.scenario_evidence se
          join app_private.evidence_records er on er.id = se.evidence_id
         where se.scenario_fixture_id = p_scenario_fixture_id
           and er.status <> 'verified'
    ) then
        raise exception 'golden scenario % evidence coverage/status mismatch', p_scenario_fixture_id
            using errcode = '23514';
    end if;

    -- Every JSON rule binding must match the exact DB version, definition hash,
    -- validity rectangle, candidate lifecycle, evidence set, and relation set.
    if exists (
        select 1
          from jsonb_array_elements(v_scenario.fixture_payload -> 'rule_version_bindings') as binding
         where not exists (
            select 1
              from app_private.scenario_rule_versions srv
              join app_private.reward_rule_versions rrv on rrv.id = srv.rule_version_id
              join app_private.reward_rules rr on rr.id = rrv.rule_id
             where srv.scenario_fixture_id = p_scenario_fixture_id
               and rr.rule_key = binding ->> 'rule_id'
               and rrv.version = (binding ->> 'version')::integer
               and rrv.definition_hash = binding ->> 'definition_hash'
               and rrv.review_status = binding ->> 'source_candidate_status'
               and rr.lifecycle_status = binding ->> 'source_candidate_status'
               and rrv.valid_from = (binding #>> '{validity,valid_from}')::timestamptz
               and rrv.valid_to is not distinct from
                   nullif(binding #>> '{validity,valid_to}', '')::timestamptz
               and rrv.recorded_at = (binding #>> '{validity,recorded_at}')::timestamptz
               and rrv.superseded_at is not distinct from
                   nullif(binding #>> '{validity,superseded_at}', '')::timestamptz
         )
         or exists (
            (select value #>> '{}'
               from jsonb_array_elements(binding -> 'roles'))
            except
            (select srv.relation
               from app_private.scenario_rule_versions srv
               join app_private.reward_rule_versions rrv on rrv.id = srv.rule_version_id
               join app_private.reward_rules rr on rr.id = rrv.rule_id
              where srv.scenario_fixture_id = p_scenario_fixture_id
                and rr.rule_key = binding ->> 'rule_id'
                and rrv.version = (binding ->> 'version')::integer)
         )
         or exists (
            (select srv.relation
               from app_private.scenario_rule_versions srv
               join app_private.reward_rule_versions rrv on rrv.id = srv.rule_version_id
               join app_private.reward_rules rr on rr.id = rrv.rule_id
              where srv.scenario_fixture_id = p_scenario_fixture_id
                and rr.rule_key = binding ->> 'rule_id'
                and rrv.version = (binding ->> 'version')::integer)
            except
            (select value #>> '{}'
               from jsonb_array_elements(binding -> 'roles'))
         )
         or exists (
            (select value #>> '{}'
               from jsonb_array_elements(binding -> 'evidence_ids'))
            except
            (select er.evidence_key
               from app_private.rule_evidence re
               join app_private.evidence_records er on er.id = re.evidence_id
               join app_private.reward_rule_versions rrv on rrv.id = re.rule_version_id
               join app_private.reward_rules rr on rr.id = rrv.rule_id
              where rr.rule_key = binding ->> 'rule_id'
                and rrv.version = (binding ->> 'version')::integer)
         )
         or exists (
            (select er.evidence_key
               from app_private.rule_evidence re
               join app_private.evidence_records er on er.id = re.evidence_id
               join app_private.reward_rule_versions rrv on rrv.id = re.rule_version_id
               join app_private.reward_rules rr on rr.id = rrv.rule_id
              where rr.rule_key = binding ->> 'rule_id'
                and rrv.version = (binding ->> 'version')::integer)
            except
            (select value #>> '{}'
               from jsonb_array_elements(binding -> 'evidence_ids'))
         )
    ) or exists (
        select 1
          from app_private.scenario_rule_versions srv
          join app_private.reward_rule_versions rrv on rrv.id = srv.rule_version_id
          join app_private.reward_rules rr on rr.id = rrv.rule_id
         where srv.scenario_fixture_id = p_scenario_fixture_id
           and not exists (
                select 1
                  from jsonb_array_elements(v_scenario.fixture_payload -> 'rule_version_bindings') as binding
                 where binding ->> 'rule_id' = rr.rule_key
                   and (binding ->> 'version')::integer = rrv.version
                   and exists (
                       select 1
                         from jsonb_array_elements_text(binding -> 'roles') as role(value)
                        where role.value = srv.relation
                   )
           )
    ) then
        raise exception 'golden scenario % rule-version binding mismatch', p_scenario_fixture_id
            using errcode = '23514';
    end if;

    select count(*)
      into v_replay_count
      from app_private.scenario_canonical_replays scr
      join app_private.canonical_replay_runs cr on cr.id = scr.replay_run_id
     where scr.scenario_fixture_id = p_scenario_fixture_id
       and cr.replay_class = 'golden_fixture'
       and cr.sealed_at is not null
       and cr.contains_user_data = false
       and cr.engine_version = v_scenario.fixture_payload #>> '{replay_provenance,engine_version}'
       and cr.contracts_version = v_scenario.fixture_payload #>> '{replay_provenance,contracts_version}'
       and cr.request_hash = v_scenario.fixture_payload #>> '{replay_provenance,input_hash}'
       and cr.result_hash = v_scenario.fixture_payload #>> '{replay_provenance,output_hash}'
       and cr.transaction_time = (v_scenario.fixture_payload ->> 'as_of')::timestamptz
       and cr.replay_knowledge_time =
           (v_scenario.fixture_payload ->> 'replay_knowledge_at')::timestamptz
       and cr.valuation_profile_version =
           v_scenario.fixture_payload #>> '{replay_provenance,valuation_profile_version}';

    if v_replay_count <> 1 then
        raise exception 'golden scenario % requires exactly one matching sealed replay', p_scenario_fixture_id
            using errcode = '23514';
    end if;

    -- The replay link set must exactly mirror the scenario rule relation set.
    if exists (
        (select rr.rule_key,
                case when srv.relation = 'boundary_source' then 'considered' else srv.relation end
           from app_private.scenario_rule_versions srv
           join app_private.reward_rule_versions rrv on rrv.id = srv.rule_version_id
           join app_private.reward_rules rr on rr.id = rrv.rule_id
          where srv.scenario_fixture_id = p_scenario_fixture_id)
        except
        (select rr.rule_key, crrv.disposition
           from app_private.scenario_canonical_replays scr
           join app_private.canonical_replay_rule_versions crrv
             on crrv.replay_run_id = scr.replay_run_id
           join app_private.reward_rule_versions rrv on rrv.id = crrv.rule_version_id
           join app_private.reward_rules rr on rr.id = rrv.rule_id
          where scr.scenario_fixture_id = p_scenario_fixture_id)
    ) or exists (
        (select rr.rule_key, crrv.disposition
           from app_private.scenario_canonical_replays scr
           join app_private.canonical_replay_rule_versions crrv
             on crrv.replay_run_id = scr.replay_run_id
           join app_private.reward_rule_versions rrv on rrv.id = crrv.rule_version_id
           join app_private.reward_rules rr on rr.id = rrv.rule_id
          where scr.scenario_fixture_id = p_scenario_fixture_id)
        except
        (select rr.rule_key,
                case when srv.relation = 'boundary_source' then 'considered' else srv.relation end
           from app_private.scenario_rule_versions srv
           join app_private.reward_rule_versions rrv on rrv.id = srv.rule_version_id
           join app_private.reward_rules rr on rr.id = rrv.rule_id
          where srv.scenario_fixture_id = p_scenario_fixture_id)
    ) then
        raise exception 'golden scenario % replay disposition set mismatch', p_scenario_fixture_id
            using errcode = '23514';
    end if;
end;
$$;

revoke execute on function app_private.assert_golden_scenario_completion(uuid) from public;

create or replace function app_private.enforce_golden_scenario_completion()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
    v_scenario_fixture_id uuid;
begin
    if tg_table_name = 'scenario_fixtures' then
        v_scenario_fixture_id := coalesce(new.id, old.id);
    else
        v_scenario_fixture_id := coalesce(new.scenario_fixture_id, old.scenario_fixture_id);
    end if;
    perform app_private.assert_golden_scenario_completion(v_scenario_fixture_id);
    return coalesce(new, old);
end;
$$;

revoke execute on function app_private.enforce_golden_scenario_completion() from public;

create constraint trigger scenario_fixtures_golden_completion
after insert or update on app_private.scenario_fixtures
deferrable initially deferred
for each row execute function app_private.enforce_golden_scenario_completion();

create constraint trigger scenario_evidence_golden_completion
after insert or update or delete on app_private.scenario_evidence
deferrable initially deferred
for each row execute function app_private.enforce_golden_scenario_completion();

create constraint trigger scenario_rule_versions_golden_completion
after insert or update or delete on app_private.scenario_rule_versions
deferrable initially deferred
for each row execute function app_private.enforce_golden_scenario_completion();

create constraint trigger scenario_canonical_replays_golden_completion
after insert or update or delete on app_private.scenario_canonical_replays
deferrable initially deferred
for each row execute function app_private.enforce_golden_scenario_completion();

create or replace function app_private.protect_golden_scenario_fixture()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    if old.status in ('golden', 'superseded') then
        if tg_op = 'UPDATE'
           and old.status = 'golden'
           and new.status = 'superseded'
           and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
            return new;
        end if;
        raise exception 'golden scenario fixtures are immutable; create a new version'
            using errcode = '55000';
    end if;
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

revoke execute on function app_private.protect_golden_scenario_fixture() from public;

create trigger scenario_fixtures_protect_golden
before update or delete on app_private.scenario_fixtures
for each row execute function app_private.protect_golden_scenario_fixture();

create or replace function app_private.protect_golden_scenario_link()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
    v_scenario_fixture_id uuid;
begin
    v_scenario_fixture_id := coalesce(new.scenario_fixture_id, old.scenario_fixture_id);
    if exists (
        select 1
          from app_private.scenario_fixtures sf
         where sf.id = v_scenario_fixture_id
           and sf.status in ('golden', 'superseded')
    ) then
        raise exception 'golden scenario links are immutable'
            using errcode = '55000';
    end if;
    return coalesce(new, old);
end;
$$;

revoke execute on function app_private.protect_golden_scenario_link() from public;

create trigger scenario_evidence_protect_golden
before insert or update or delete on app_private.scenario_evidence
for each row execute function app_private.protect_golden_scenario_link();

create trigger scenario_rule_versions_protect_golden
before insert or update or delete on app_private.scenario_rule_versions
for each row execute function app_private.protect_golden_scenario_link();

create trigger scenario_canonical_replays_protect_golden
before insert or update or delete on app_private.scenario_canonical_replays
for each row execute function app_private.protect_golden_scenario_link();

create or replace function app_private.protect_golden_scenario_dependency()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
    v_dependency_id uuid;
begin
    if tg_table_name = 'evidence_records' then
        v_dependency_id := coalesce(new.id, old.id);
        if exists (
            select 1
              from app_private.scenario_evidence se
              join app_private.scenario_fixtures sf on sf.id = se.scenario_fixture_id
             where se.evidence_id = v_dependency_id
               and sf.status in ('golden', 'superseded')
        ) then
            raise exception 'evidence linked to a golden scenario is immutable'
                using errcode = '55000';
        end if;
    elsif tg_table_name = 'reward_rule_versions' then
        v_dependency_id := coalesce(new.id, old.id);
        if exists (
            select 1
              from app_private.scenario_rule_versions srv
              join app_private.scenario_fixtures sf on sf.id = srv.scenario_fixture_id
             where srv.rule_version_id = v_dependency_id
               and sf.status in ('golden', 'superseded')
        ) then
            raise exception 'rule version linked to a golden scenario is immutable'
                using errcode = '55000';
        end if;
    elsif tg_table_name = 'rule_evidence' then
        v_dependency_id := coalesce(new.rule_version_id, old.rule_version_id);
        if exists (
            select 1
              from app_private.scenario_rule_versions srv
              join app_private.scenario_fixtures sf on sf.id = srv.scenario_fixture_id
             where srv.rule_version_id = v_dependency_id
               and sf.status in ('golden', 'superseded')
        ) then
            raise exception 'rule evidence linked to a golden scenario is immutable'
                using errcode = '55000';
        end if;
    end if;
    return coalesce(new, old);
end;
$$;

revoke execute on function app_private.protect_golden_scenario_dependency() from public;

create trigger evidence_records_protect_golden_dependency
before update or delete on app_private.evidence_records
for each row execute function app_private.protect_golden_scenario_dependency();

create trigger reward_rule_versions_protect_golden_dependency
before update or delete on app_private.reward_rule_versions
for each row execute function app_private.protect_golden_scenario_dependency();

create trigger rule_evidence_protect_golden_dependency
before update or delete on app_private.rule_evidence
for each row execute function app_private.protect_golden_scenario_dependency();

-- Published parents are valid only when every current approved version has a
-- completed, immutable publication request that points back to the same rule.
create or replace function app_private.assert_published_reward_rule_completion(
    p_rule_id uuid
)
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
    v_status text;
begin
    select lifecycle_status into v_status
      from app_private.reward_rules
     where id = p_rule_id;

    if not found then
        return;
    end if;

    if exists (
        select 1
          from app_private.rule_publication_requests rpr
          left join app_private.reward_rule_versions rrv
            on rrv.id = rpr.resulting_rule_version_id
         where rpr.rule_id = p_rule_id
           and rpr.status = 'published'
           and (v_status not in ('published', 'superseded') or rrv.id is null
                or rrv.rule_id <> p_rule_id or rrv.review_status <> 'approved'
                or rpr.completed_at is null)
    ) then
        raise exception 'reward rule % has an invalid published request', p_rule_id
            using errcode = '23514';
    end if;

    if v_status <> 'published' then
        return;
    end if;

    if not exists (
        select 1 from app_private.reward_rule_versions
         where rule_id = p_rule_id
           and review_status = 'approved'
           and superseded_at is null
    ) then
        raise exception 'published reward rule % requires a current approved version', p_rule_id
            using errcode = '23514';
    end if;

    if exists (
        select 1
          from app_private.reward_rule_versions rrv
         where rrv.rule_id = p_rule_id
           and rrv.review_status = 'approved'
           and rrv.superseded_at is null
           and not exists (
               select 1
                 from app_private.rule_publication_requests rpr
                where rpr.rule_id = p_rule_id
                  and rpr.resulting_rule_version_id = rrv.id
                  and rpr.status = 'published'
                  and rpr.completed_at is not null
           )
    ) then
        raise exception 'published reward rule % lacks a completed publication request', p_rule_id
            using errcode = '23514';
    end if;

end;
$$;

revoke execute on function app_private.assert_published_reward_rule_completion(uuid) from public;

create or replace function app_private.enforce_published_reward_rule_completion()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
    v_rule_id uuid;
begin
    if tg_table_name = 'reward_rules' then
        v_rule_id := coalesce(new.id, old.id);
    elsif tg_table_name = 'reward_rule_versions' then
        v_rule_id := coalesce(new.rule_id, old.rule_id);
    else
        v_rule_id := coalesce(new.rule_id, old.rule_id);
    end if;
    perform app_private.assert_published_reward_rule_completion(v_rule_id);
    return coalesce(new, old);
end;
$$;

revoke execute on function app_private.enforce_published_reward_rule_completion() from public;

create constraint trigger reward_rules_publication_completion
after insert or update on app_private.reward_rules
deferrable initially deferred
for each row execute function app_private.enforce_published_reward_rule_completion();

create constraint trigger reward_rule_versions_publication_completion
after insert or update on app_private.reward_rule_versions
deferrable initially deferred
for each row execute function app_private.enforce_published_reward_rule_completion();

create constraint trigger rule_publication_requests_completion
after insert or update or delete on app_private.rule_publication_requests
deferrable initially deferred
for each row execute function app_private.enforce_published_reward_rule_completion();

create or replace function app_private.protect_completed_publication_request()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    if old.status = 'published' then
        raise exception 'completed publication requests are immutable'
            using errcode = '55000';
    end if;
    return coalesce(new, old);
end;
$$;

revoke execute on function app_private.protect_completed_publication_request() from public;

create trigger rule_publication_requests_protect_completed
before update or delete on app_private.rule_publication_requests
for each row execute function app_private.protect_completed_publication_request();

-- API visibility requires both an approved version and an explicitly published
-- parent. Scenario-golden status alone is never sufficient.
create or replace view app_api.approved_reward_rule_versions
with (security_invoker = true, security_barrier = true) as
select
    rr.rule_key,
    rr.rule_type,
    rr.name,
    rrv.id as rule_version_id,
    rrv.version,
    rrv.definition,
    rrv.valid_from,
    rrv.valid_to,
    rrv.recorded_at,
    rrv.superseded_at,
    rrv.review_mode
from app_private.reward_rules rr
join app_private.reward_rule_versions rrv on rrv.rule_id = rr.id
where rr.lifecycle_status = 'published'
  and rrv.review_status = 'approved'
  and rrv.superseded_at is null;

revoke all on app_api.approved_reward_rule_versions from public;

-- Fail an additive upgrade if it would grandfather an incompletely published
-- rule. Operators must backfill an auditable request before applying this step.
do $$
declare
    v_rule_id uuid;
begin
    for v_rule_id in
        select id from app_private.reward_rules where lifecycle_status = 'published'
    loop
        perform app_private.assert_published_reward_rule_completion(v_rule_id);
    end loop;
end;
$$;

commit;
