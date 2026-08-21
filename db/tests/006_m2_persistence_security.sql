\set ON_ERROR_STOP on

-- This is an intentionally adversarial integration test for the additive M2
-- hardening migration.  It is transaction-scoped: roles, the mock auth schema,
-- policies, grants, and all fixture rows disappear on rollback, including when
-- psql aborts the transaction after an unexpected error.
begin;

do $$
begin
    if to_regprocedure('app_private.purge_expired_user_history(timestamp with time zone)') is null then
        raise exception 'M2 dependency missing: app_private.purge_expired_user_history(timestamptz)';
    end if;
    if to_regprocedure('app_private.install_user_data_rls_policies(name)') is null then
        raise exception 'M2 dependency missing: app_private.install_user_data_rls_policies(name)';
    end if;
end
$$;

-- An isolated database must not have a real Supabase auth schema.  The policy
-- installer is deliberately exercised against this tiny JWT-claim mock.
do $$
begin
    if exists (select 1 from pg_namespace where nspname = 'auth') then
        raise exception '006_m2_persistence_security.sql requires an isolated database without auth schema';
    end if;
end
$$;

create schema auth;
create function auth.uid()
returns uuid
language sql
stable
as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

revoke all on schema auth from public;
revoke all on function auth.uid() from public;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'jro_m2_a') then
        execute 'drop owned by jro_m2_a';
        execute 'drop role jro_m2_a';
    end if;
    if exists (select 1 from pg_roles where rolname = 'jro_m2_b') then
        execute 'drop owned by jro_m2_b';
        execute 'drop role jro_m2_b';
    end if;
end
$$;

create role jro_m2_a nologin nobypassrls;
create role jro_m2_b nologin nobypassrls;

-- The isolated test owner is explicitly made a member so SET ROLE works even
-- when the test database owner is not a superuser.
do $$
begin
    execute format('grant jro_m2_a to %I', session_user);
    execute format('grant jro_m2_b to %I', session_user);
end
$$;

do $$
declare
    v_super boolean;
    v_bypass boolean;
begin
    select rolsuper, rolbypassrls into v_super, v_bypass
      from pg_roles where rolname = 'jro_m2_a';
    if v_super or v_bypass then
        raise exception 'jro_m2_a must be neither superuser nor BYPASSRLS';
    end if;
    select rolsuper, rolbypassrls into v_super, v_bypass
      from pg_roles where rolname = 'jro_m2_b';
    if v_super or v_bypass then
        raise exception 'jro_m2_b must be neither superuser nor BYPASSRLS';
    end if;
end
$$;

-- ----------
-- Catalog and baseline privilege gates
-- ----------

do $$
declare
    v_enabled integer;
    v_forced integer;
    v_tables integer;
begin
    with expected(relname) as (
        values
            ('user_profiles'), ('user_wallet_items'), ('user_facts'),
            ('user_asset_lots'), ('user_valuation_profiles'),
            ('user_valuation_entries'), ('user_cap_progress'),
            ('user_recommendation_history'),
            ('user_recommendation_rule_versions'), ('correction_reports')
    ), actual as (
        select e.relname,
               case when n.nspname = 'user_data' then c.relrowsecurity end as relrowsecurity,
               case when n.nspname = 'user_data' then c.relforcerowsecurity end as relforcerowsecurity
          from expected e
          left join pg_class c on c.relname = e.relname
          left join pg_namespace n on n.oid = c.relnamespace
                                      and n.nspname = 'user_data'
    )
    select count(*), count(*) filter (where relrowsecurity),
           count(*) filter (where relforcerowsecurity)
      into v_tables, v_enabled, v_forced
      from actual
     where relrowsecurity is not null;

    if v_tables <> 10 or v_enabled <> 10 or v_forced <> 10 then
        raise exception 'expected all 10 user tables ENABLE and FORCE RLS, got tables %, enabled %, forced %',
            v_tables, v_enabled, v_forced;
    end if;
end
$$;

-- Existing and default PUBLIC grants must remain empty for every object in the
-- three application schemas, including function EXECUTE.  The role grants
-- below are intentional and do not weaken this PUBLIC check.
do $$
begin
    if exists (
        select 1
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          cross join lateral aclexplode(coalesce(c.relacl, acldefault(
              case when c.relkind = 'S' then 'S'::"char" else 'r'::"char" end,
              c.relowner
          ))) a
         where n.nspname in ('app_private', 'app_api', 'user_data')
           and a.grantee = 0
           and a.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','USAGE')
    ) then
        raise exception 'unexpected current PUBLIC table/view/sequence privilege in application schemas';
    end if;

    if exists (
        select 1
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
         where n.nspname in ('app_private', 'app_api', 'user_data')
           and a.grantee = 0
           and a.privilege_type = 'EXECUTE'
    ) then
        raise exception 'unexpected current PUBLIC function EXECUTE privilege in application schemas';
    end if;

    if exists (
        select 1
          from pg_default_acl d
          join pg_namespace n on n.oid = d.defaclnamespace
          cross join lateral aclexplode(d.defaclacl) a
         where n.nspname in ('app_private', 'app_api', 'user_data')
           and a.grantee = 0
           and a.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','USAGE','EXECUTE')
    ) then
        raise exception 'unexpected default PUBLIC privilege in application schemas';
    end if;
end
$$;

-- ----------
-- Private fixtures: one draft rule for user links and one legitimate approved
-- rule with verified evidence and an immutable approved review event.
-- ----------

insert into app_private.reward_rules (rule_key, rule_type, name, lifecycle_status, created_by)
values ('rr_m2_draft_fixture', 'base_reward', 'M2 draft fixture', 'draft', 'db-test');

insert into app_private.reward_rule_versions (
    rule_id, version, definition, definition_hash,
    valid_from, valid_to, recorded_at, superseded_at,
    review_status, review_mode, required_review_modes, completed_review_modes,
    reviewed_by, reviewed_at, change_reason, created_by
)
select id, 1, '{"fixture":"draft"}'::jsonb, 'sha256:' || repeat('1', 64),
       '2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z',
       '2026-01-01T00:00:00Z', null,
       'draft', null, '{}'::text[], '{}'::text[],
       null, null, 'M2 test fixture', 'db-test'
  from app_private.reward_rules where rule_key = 'rr_m2_draft_fixture';

insert into app_private.trusted_sources (
    source_key, name, publisher, category, tier, publication_use, source_url,
    authority_scope, locale, geography, evidence_format, volatility,
    recommended_check_cadence, retrieval_method, requires_login, automation_status,
    terms_review_status, technical_feasibility, url_registered_on,
    content_verified_on, verification_status, registry_payload
)
values (
    'src_m2_test', 'M2 synthetic authority', 'M2 test publisher', 'rewards',
    'T1_CANONICAL', 'canonical', 'https://example.invalid/m2-test',
    '["synthetic reward definition"]'::jsonb, 'en-US', 'JP', 'html', 'low',
    'annual', 'test_fixture', false, 'enabled', 'approved',
    'manual_capture_candidate', '2026-01-01', '2026-01-01',
    'content_verified', '{"synthetic":true}'::jsonb
);

insert into app_private.source_snapshots (
    snapshot_key, source_id, fetched_at, requested_url, effective_url,
    http_status, content_type, raw_content_hash, normalized_content_hash,
    storage_uri, acquisition_method, parser_version, capture_complete,
    metadata, created_by
)
select 'snap_m2_test', id, '2026-01-02T00:00:00Z',
       'https://example.invalid/m2-test', 'https://example.invalid/m2-test',
       200, 'text/html', 'sha256:' || repeat('2', 64),
       'sha256:' || repeat('3', 64), 'memory://m2-test', 'test_fixture',
       'm2-test-parser', true, '{"synthetic":true}'::jsonb, 'db-test'
  from app_private.trusted_sources where source_key = 'src_m2_test';

insert into app_private.evidence_records (
    evidence_key, source_snapshot_id, locator, excerpt_text, normalized_claim,
    supports, status, extraction_method, extraction_model,
    review_mode, required_review_modes, completed_review_modes,
    reviewed_by, reviewed_at, notes
)
select 'ev_m2_test', id, '{"line_start":1,"line_end":1}'::jsonb,
       'Synthetic evidence for the M2 approved-rule gate.',
       '{"rate_bps":100}'::jsonb, '[{"path":"rate_bps"}]'::jsonb,
       'verified', 'manual_capture', null, 'human_second_review',
       array['human_second_review'], array['human_second_review'],
       'db-reviewer', '2026-01-03T00:00:00Z', 'M2 synthetic evidence'
  from app_private.source_snapshots where snapshot_key = 'snap_m2_test';

insert into app_private.reward_rules (rule_key, rule_type, name, lifecycle_status, created_by)
values ('rr_m2_approved_fixture', 'base_reward', 'M2 approved fixture', 'under_review', 'db-test');

insert into app_private.reward_rule_versions (
    rule_id, version, definition, definition_hash,
    valid_from, valid_to, recorded_at, superseded_at,
    review_status, review_mode, required_review_modes, completed_review_modes,
    reviewed_by, reviewed_at, change_reason, created_by
)
select id, 1, '{"fixture":"approved","rate_bps":100}'::jsonb,
       'sha256:' || repeat('4', 64),
       '2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z',
       '2026-01-01T00:00:00Z', null,
       'draft', 'human_second_review', array['human_second_review'],
       array['human_second_review'], 'db-reviewer', '2026-01-03T00:00:00Z',
       'M2 approved fixture', 'db-test'
  from app_private.reward_rules where rule_key = 'rr_m2_approved_fixture';

insert into app_private.review_items (
    review_type, subject_type, subject_id, external_subject_key,
    priority, status, assigned_to, payload
)
select 'rule', 'reward_rule_version', rrv.id, 'rr_m2_approved_fixture:v1',
       'high', 'approved', 'db-reviewer',
       jsonb_build_object('rule_version_id', rrv.id, 'synthetic', true)
  from app_private.reward_rule_versions rrv
  join app_private.reward_rules rr on rr.id = rrv.rule_id
 where rr.rule_key = 'rr_m2_approved_fixture' and rrv.version = 1;

insert into app_private.review_decisions (
    review_item_id, review_mode, decision, rationale, decided_by,
    decided_at, evidence_refs
)
select ri.id, 'human_second_review', 'approved',
       'Verified synthetic evidence supports the approved definition.',
       'db-reviewer', '2026-01-03T00:00:00Z',
       jsonb_build_array((select id from app_private.evidence_records where evidence_key = 'ev_m2_test'))
  from app_private.review_items ri
 where ri.subject_type = 'reward_rule_version'
   and ri.external_subject_key = 'rr_m2_approved_fixture:v1';

insert into app_private.rule_evidence (rule_version_id, evidence_id, supported_paths)
select rrv.id, er.id, '["/rate_bps"]'::jsonb
  from app_private.reward_rule_versions rrv
  join app_private.reward_rules rr on rr.id = rrv.rule_id
  cross join app_private.evidence_records er
 where rr.rule_key = 'rr_m2_approved_fixture'
   and rrv.version = 1
   and er.evidence_key = 'ev_m2_test';

update app_private.reward_rules
   set lifecycle_status = 'published'
 where rule_key = 'rr_m2_approved_fixture';

set constraints all deferred;
update app_private.reward_rule_versions rrv
   set review_status = 'approved'
 where rrv.rule_id = (select id from app_private.reward_rules where rule_key = 'rr_m2_approved_fixture')
   and rrv.version = 1;

insert into app_private.rule_publication_requests (
    rule_id, idempotency_key, request_hash, resulting_rule_version_id,
    status, created_by, completed_at
)
select rr.id, 'm2-approved-fixture-publication', 'sha256:' || repeat('9', 64),
       rrv.id, 'published', 'db-test', clock_timestamp()
  from app_private.reward_rules rr
  join app_private.reward_rule_versions rrv on rrv.rule_id = rr.id
 where rr.rule_key = 'rr_m2_approved_fixture'
   and rrv.version = 1;
set constraints all immediate;

-- ----------
-- Approved review/evidence constraint trigger and controlled immutability
-- ----------

insert into app_private.reward_rules (rule_key, rule_type, name, lifecycle_status, created_by)
values ('rr_m2_forged_arrays', 'base_reward', 'M2 forged arrays', 'under_review', 'db-test');

do $$
begin
    begin
        set constraints all deferred;
        insert into app_private.reward_rule_versions (
            rule_id, version, definition, definition_hash,
            valid_from, valid_to, recorded_at, superseded_at,
            review_status, review_mode, required_review_modes, completed_review_modes,
            reviewed_by, reviewed_at, change_reason, created_by
        )
        select id, 1, '{"fixture":"forged-arrays"}'::jsonb,
               'sha256:' || repeat('5', 64),
               '2027-01-01T00:00:00Z', '2027-12-31T00:00:00Z',
               '2027-01-01T00:00:00Z', null,
               'approved', 'human_second_review', array['human_second_review'],
               array['human_second_review'], 'attacker', '2027-01-01T00:00:00Z',
               'forged completion arrays', 'db-test'
          from app_private.reward_rules where rule_key = 'rr_m2_forged_arrays';
        set constraints all immediate;
        raise exception 'forged approved review arrays unexpectedly succeeded';
    exception when check_violation then null;
    end;
    set constraints all deferred;
end
$$;

insert into app_private.reward_rules (rule_key, rule_type, name, lifecycle_status, created_by)
values ('rr_m2_missing_evidence', 'base_reward', 'M2 missing evidence', 'under_review', 'db-test');
insert into app_private.reward_rule_versions (
    rule_id, version, definition, definition_hash,
    valid_from, valid_to, recorded_at, superseded_at,
    review_status, review_mode, required_review_modes, completed_review_modes,
    reviewed_by, reviewed_at, change_reason, created_by
)
select id, 1, '{"fixture":"missing-evidence"}'::jsonb,
       'sha256:' || repeat('6', 64),
       '2028-01-01T00:00:00Z', '2028-12-31T00:00:00Z',
       '2028-01-01T00:00:00Z', null,
       'draft', 'human_second_review', array['human_second_review'],
       array['human_second_review'], 'attacker', '2028-01-01T00:00:00Z',
       'missing evidence fixture', 'db-test'
  from app_private.reward_rules where rule_key = 'rr_m2_missing_evidence';

do $$
begin
    begin
        set constraints all deferred;
        update app_private.reward_rule_versions
           set review_status = 'approved'
         where rule_id = (select id from app_private.reward_rules where rule_key = 'rr_m2_missing_evidence');
        set constraints all immediate;
        raise exception 'approved rule without immutable review/evidence unexpectedly succeeded';
    exception when check_violation then null;
    end;
    set constraints all deferred;
end
$$;

-- A verified, linked review event is the positive control for that deferred
-- trigger.  Mutating or deleting that review event remains append-only.
do $$
begin
    begin
        update app_private.review_decisions
           set rationale = 'tampered'
         where review_item_id = (
             select id from app_private.review_items
              where external_subject_key = 'rr_m2_approved_fixture:v1'
         );
        raise exception 'approved review decision update unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;
    begin
        delete from app_private.review_decisions
         where review_item_id = (
             select id from app_private.review_items
              where external_subject_key = 'rr_m2_approved_fixture:v1'
         );
        raise exception 'approved review decision delete unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;
end
$$;

-- Approved payload, economic dates, and review fields are immutable.  Exactly
-- one update that only closes system validity is the sole permitted mutation.
do $$
begin
    begin
        update app_private.reward_rule_versions
           set definition = '{"tampered":true}'::jsonb
         where rule_id = (select id from app_private.reward_rules where rule_key = 'rr_m2_approved_fixture');
        raise exception 'approved definition mutation unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;
    begin
        update app_private.reward_rule_versions
           set valid_from = valid_from + interval '1 day'
         where rule_id = (select id from app_private.reward_rules where rule_key = 'rr_m2_approved_fixture');
        raise exception 'approved economic-date mutation unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;
    begin
        update app_private.reward_rule_versions
           set review_mode = 'expert_review', reviewed_by = 'attacker'
         where rule_id = (select id from app_private.reward_rules where rule_key = 'rr_m2_approved_fixture');
        raise exception 'approved review mutation unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;
    begin
        delete from app_private.reward_rule_versions
         where rule_id = (select id from app_private.reward_rules where rule_key = 'rr_m2_approved_fixture');
        raise exception 'approved version delete unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;
end
$$;

update app_private.reward_rule_versions
   set superseded_at = '2026-02-01T00:00:00Z'
 where rule_id = (select id from app_private.reward_rules where rule_key = 'rr_m2_approved_fixture');

-- A published parent cannot remain current after its only approved version is
-- system-closed. A later version would instead carry a new publication request.
update app_private.reward_rules
   set lifecycle_status = 'superseded'
 where rule_key = 'rr_m2_approved_fixture';

do $$
begin
    begin
        update app_private.reward_rule_versions
           set superseded_at = '2026-03-01T00:00:00Z'
         where rule_id = (select id from app_private.reward_rules where rule_key = 'rr_m2_approved_fixture');
        raise exception 'second superseded_at closure unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;
    begin
        update app_private.reward_rule_versions
           set superseded_at = '2026-04-01T00:00:00Z',
               definition = '{"mixed":true}'::jsonb
         where rule_id = (select id from app_private.reward_rules where rule_key = 'rr_m2_approved_fixture');
        raise exception 'mixed superseded_at/payload mutation unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;
end
$$;

-- Source snapshots are append-only independently of their evidence references.
do $$
begin
    begin
        update app_private.source_snapshots
           set requested_url = 'https://example.invalid/tampered'
         where snapshot_key = 'snap_m2_test';
        raise exception 'source snapshot update unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;
    begin
        delete from app_private.source_snapshots where snapshot_key = 'snap_m2_test';
        raise exception 'source snapshot delete unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;
end
$$;

-- ----------
-- Canonical replay immutability
-- ----------

insert into app_private.canonical_replay_runs (
    replay_key, replay_class, engine_version, contracts_version,
    request_hash, request_payload, result_payload, result_hash,
    transaction_time, replay_knowledge_time, valuation_profile_version,
    contains_user_data
)
values (
    'm2-canonical-replay', 'synthetic', 'm2-test-engine', 'm2-test-contracts',
    'sha256:' || repeat('7', 64), '{"synthetic":true}'::jsonb,
    '{"winner":"synthetic"}'::jsonb, 'sha256:' || repeat('8', 64),
    '2026-01-15T00:00:00Z', '2026-02-15T00:00:00Z', 'm2-test-valuations', false
);

insert into app_private.canonical_replay_rule_versions (
    replay_run_id, rule_version_id, disposition, reason_codes
)
select cr.id, rrv.id, 'applied', '["m2_test"]'::jsonb
  from app_private.canonical_replay_runs cr
  cross join app_private.reward_rule_versions rrv
  join app_private.reward_rules rr on rr.id = rrv.rule_id
 where cr.replay_key = 'm2-canonical-replay'
   and rr.rule_key = 'rr_m2_draft_fixture';

update app_private.canonical_replay_runs
   set sealed_at = clock_timestamp()
 where replay_key = 'm2-canonical-replay';

set constraints all immediate;
set constraints all deferred;

-- Once sealed, even a new disposition/link is forbidden. This is distinct
-- from update/delete immutability and closes post-commit replay augmentation.
do $$
begin
    begin
        insert into app_private.canonical_replay_rule_versions (
            replay_run_id, rule_version_id, disposition, reason_codes
        )
        select cr.id, rrv.id, 'considered', '["late-link"]'::jsonb
          from app_private.canonical_replay_runs cr
          cross join app_private.reward_rule_versions rrv
          join app_private.reward_rules rr on rr.id = rrv.rule_id
         where cr.replay_key = 'm2-canonical-replay'
           and rr.rule_key = 'rr_m2_draft_fixture';
        raise exception 'sealed canonical replay accepted a late rule link';
    exception when object_not_in_prerequisite_state then null;
    end;
end
$$;

-- The deferred half of the protocol rejects a run that reaches the commit
-- boundary without a seal, even if it has no rule links.
do $$
begin
    begin
        set constraints all deferred;
        insert into app_private.canonical_replay_runs (
            replay_key, replay_class, engine_version, contracts_version,
            request_hash, request_payload, result_payload, result_hash,
            transaction_time, replay_knowledge_time, valuation_profile_version
        ) values (
            'm2-unsealed-replay', 'synthetic', 'm2-test-engine', 'm2-test-contracts',
            'sha256:' || repeat('c', 64), '{}'::jsonb, '{}'::jsonb,
            'sha256:' || repeat('d', 64), clock_timestamp(), clock_timestamp(), 'm2-test'
        );
        set constraints all immediate;
        raise exception 'unsealed canonical replay unexpectedly reached commit boundary';
    exception when check_violation then null;
    end;
    set constraints all deferred;
end
$$;

do $$
begin
    begin
        update app_private.canonical_replay_runs
           set result_payload = '{"tampered":true}'::jsonb
         where replay_key = 'm2-canonical-replay';
        raise exception 'canonical replay run update unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;
    begin
        delete from app_private.canonical_replay_runs where replay_key = 'm2-canonical-replay';
        raise exception 'canonical replay run delete unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;
    begin
        update app_private.canonical_replay_rule_versions
           set disposition = 'considered'
         where replay_run_id = (select id from app_private.canonical_replay_runs where replay_key = 'm2-canonical-replay');
        raise exception 'canonical replay link update unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;
    begin
        delete from app_private.canonical_replay_rule_versions
         where replay_run_id = (select id from app_private.canonical_replay_runs where replay_key = 'm2-canonical-replay');
        raise exception 'canonical replay link delete unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;
end
$$;

-- ----------
-- User fixtures
-- ----------

-- FORCE RLS is intentionally already asserted above.  The migration owner has
-- no policy before installation, so temporarily remove FORCE only while the
-- owner seeds deterministic fixtures; restore it before any role test.
do $$
declare
    t text;
begin
    foreach t in array array[
        'user_profiles', 'user_wallet_items', 'user_facts', 'user_asset_lots',
        'user_valuation_profiles', 'user_valuation_entries', 'user_cap_progress',
        'user_recommendation_history', 'user_recommendation_rule_versions',
        'correction_reports'
    ] loop
        execute format('alter table user_data.%I no force row level security', t);
    end loop;
end
$$;

insert into user_data.user_profiles (user_id, locale, timezone, preferences)
values
    ('00000000-0000-0000-0000-0000000000a1', 'en-US', 'UTC', '{"fixture":"A"}'::jsonb),
    ('00000000-0000-0000-0000-0000000000b1', 'ja-JP', 'Asia/Tokyo', '{"fixture":"B"}'::jsonb);

insert into app_private.entities (entity_key, entity_type, display_name, status)
values ('ent_m2_test_asset', 'loyalty_program', 'M2 Test Points', 'active');

insert into app_private.asset_definitions (
    asset_key, asset_kind, program_entity_id, default_reward_class, display_name,
    scale, default_expiry_policy, default_usage_restrictions, status
)
select 'asset_m2_test', 'reward_point', id, 'normal', 'M2 Test Points', 0,
       '{}'::jsonb, '{}'::jsonb, 'active'
  from app_private.entities where entity_key = 'ent_m2_test_asset';

insert into user_data.user_wallet_items (user_id, item_type, nickname, optional_last_four, settings)
values
    ('00000000-0000-0000-0000-0000000000a1', 'credit_card', 'A card', '1111', '{"fixture":"A"}'::jsonb),
    ('00000000-0000-0000-0000-0000000000b1', 'credit_card', 'B card', '2222', '{"fixture":"B"}'::jsonb);

insert into user_data.user_facts (
    user_id, fact_key, status, value, observed_at, source, confidence
)
values
    ('00000000-0000-0000-0000-0000000000a1', 'm2_fact', 'known', '{"value":1}'::jsonb,
     '2026-02-01T00:00:00Z', 'user_input', 1),
    ('00000000-0000-0000-0000-0000000000b1', 'm2_fact', 'known', '{"value":2}'::jsonb,
     '2026-02-01T00:00:00Z', 'user_input', 1);

insert into user_data.user_asset_lots (
    user_id, asset_definition_id, reward_class, quantity, acquired_at,
    settlement_status, expiry_policy, expires_at, provenance_rule_ids
)
select '00000000-0000-0000-0000-0000000000a1'::uuid, id, 'normal', 10,
       '2026-01-10T00:00:00Z'::timestamptz,
       'posted', 'none', null::timestamptz, '[]'::jsonb
  from app_private.asset_definitions where asset_key = 'asset_m2_test'
union all
select '00000000-0000-0000-0000-0000000000b1'::uuid, id, 'normal', 20,
       '2026-01-10T00:00:00Z'::timestamptz,
       'posted', 'none', null::timestamptz, '[]'::jsonb
  from app_private.asset_definitions where asset_key = 'asset_m2_test';

insert into user_data.user_valuation_profiles (user_id, version, name, is_active)
values
    ('00000000-0000-0000-0000-0000000000a1', 1, 'A valuation', true),
    ('00000000-0000-0000-0000-0000000000b1', 1, 'B valuation', true);

insert into user_data.user_valuation_entries (
    valuation_profile_id, asset_definition_id, reward_class,
    expiry_horizon_days, jpy_per_unit, basis
)
select vp.id, ad.id, 'normal', null, 1.0, 'm2-test'
  from user_data.user_valuation_profiles vp
  cross join app_private.asset_definitions ad
 where ad.asset_key = 'asset_m2_test'
   and vp.version = 1
   and vp.user_id in (
       '00000000-0000-0000-0000-0000000000a1',
       '00000000-0000-0000-0000-0000000000b1'
   );

insert into user_data.user_cap_progress (
    user_id, cap_key, status, eligible_spend_jpy_min, eligible_spend_jpy_max,
    reward_earned_units_min, reward_earned_units_max,
    period_start, period_end, observed_at, source
)
values
    ('00000000-0000-0000-0000-0000000000a1', 'm2_cap', 'known', 100, 100, 10, 10,
     '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z', 'user_input'),
    ('00000000-0000-0000-0000-0000000000b1', 'm2_cap', 'known', 200, 200, 20, 20,
     '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z', 'user_input');

insert into user_data.user_recommendation_history (
    user_id, recommendation_key, engine_version, contracts_version,
    request_hash, request_payload_redacted, result_payload, result_hash,
    transaction_time, replay_knowledge_time, valuation_profile_version,
    retention_class, purge_after, payload_redaction_status
)
values
    ('00000000-0000-0000-0000-0000000000a1', 'm2_seed', 'm2-engine', 'm2-contracts',
     'sha256:' || repeat('a',64), '{"fixture":"A"}'::jsonb, '{"result":"A"}'::jsonb,
     'sha256:' || repeat('b',64), '2026-01-10T00:00:00Z', '2026-02-10T00:00:00Z',
     'm2-test-valuations', '30_days', '2026-12-01T00:00:00Z', 'redacted'),
    ('00000000-0000-0000-0000-0000000000b1', 'm2_seed', 'm2-engine', 'm2-contracts',
     'sha256:' || repeat('c',64), '{"fixture":"B"}'::jsonb, '{"result":"B"}'::jsonb,
     'sha256:' || repeat('d',64), '2026-01-10T00:00:00Z', '2026-02-10T00:00:00Z',
     'm2-test-valuations', '30_days', '2026-12-01T00:00:00Z', 'redacted');

insert into user_data.user_recommendation_rule_versions (
    recommendation_history_id, rule_version_id, disposition, reason_codes
)
select rh.id, rrv.id, 'applied', '["m2_seed"]'::jsonb
  from user_data.user_recommendation_history rh
  cross join app_private.reward_rule_versions rrv
  join app_private.reward_rules rr on rr.id = rrv.rule_id
 where rh.recommendation_key = 'm2_seed'
   and rr.rule_key = 'rr_m2_draft_fixture';

insert into user_data.correction_reports (
    user_id, recommendation_history_id, report_payload_redacted,
    privacy_redaction_status, status, purge_after
)
select rh.user_id, rh.id, '{"fixture":"correction"}'::jsonb,
       'complete', 'open', '2026-12-01T00:00:00Z'
  from user_data.user_recommendation_history rh
 where rh.recommendation_key = 'm2_seed';

do $$
declare
    t text;
begin
    foreach t in array array[
        'user_profiles', 'user_wallet_items', 'user_facts', 'user_asset_lots',
        'user_valuation_profiles', 'user_valuation_entries', 'user_cap_progress',
        'user_recommendation_history', 'user_recommendation_rule_versions',
        'correction_reports'
    ] loop
        execute format('alter table user_data.%I force row level security', t);
    end loop;
end
$$;

-- Before policies, explicit CRUD grants still cannot bypass deny-by-default RLS.
grant usage on schema auth, user_data to jro_m2_a, jro_m2_b;
grant execute on function auth.uid() to jro_m2_a, jro_m2_b;
grant select, insert, update, delete on all tables in schema user_data to jro_m2_a, jro_m2_b;
grant usage, select on all sequences in schema user_data to jro_m2_a, jro_m2_b;

do $$
declare
    v_policy_count integer;
begin
    select count(*) into v_policy_count
      from pg_policies
     where schemaname = 'user_data'
       and roles && array['jro_m2_a'::name, 'jro_m2_b'::name];
    if v_policy_count <> 0 then
        raise exception 'deny-before-policy gate requires zero user_data policies, got %', v_policy_count;
    end if;
end
$$;

set role jro_m2_a;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$
declare
    v_count integer;
begin
    select count(*) into v_count from user_data.user_profiles;
    if v_count <> 0 then
        raise exception 'RLS without policies exposed % profile rows', v_count;
    end if;
    begin
        insert into user_data.user_profiles (user_id) values ('00000000-0000-0000-0000-0000000000c1');
        raise exception 'RLS without policies unexpectedly allowed profile insert';
    exception when insufficient_privilege then null;
    end;
end
$$;
reset role;
reset request.jwt.claim.sub;

-- Install reviewed, role-scoped policies only after the deny-before-policy gate.
select app_private.install_user_data_rls_policies('jro_m2_a'::name);
select app_private.install_user_data_rls_policies('jro_m2_b'::name);
select app_private.install_user_data_rls_policies('jro_m2_a'::name);

do $$
declare
    v_policy_count integer;
begin
    select count(*) into v_policy_count
      from pg_policies
     where schemaname = 'user_data'
       and roles && array['jro_m2_a'::name, 'jro_m2_b'::name];
    if v_policy_count <> 40 then
        raise exception 'expected 40 stable role/table policies after reinstall, got %', v_policy_count;
    end if;
end
$$;

-- ----------
-- Role/JWT read isolation and CRUD checks
-- ----------

set role jro_m2_a;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$
declare
    t text;
    v_count integer;
begin
    foreach t in array array[
        'user_profiles', 'user_wallet_items', 'user_facts', 'user_asset_lots',
        'user_valuation_profiles', 'user_valuation_entries', 'user_cap_progress',
        'user_recommendation_history', 'user_recommendation_rule_versions',
        'correction_reports'
    ] loop
        execute format('select count(*) from user_data.%I', t) into v_count;
        if v_count <> 1 then
            raise exception 'role A expected one visible row in %, got %', t, v_count;
        end if;
    end loop;

    update user_data.user_profiles
       set locale = 'en-GB'
     where user_id = '00000000-0000-0000-0000-0000000000a1';
    if not found then raise exception 'role A could not update own profile'; end if;

    update user_data.user_profiles
       set locale = 'should-not-write-B'
     where user_id = '00000000-0000-0000-0000-0000000000b1';
    if found then raise exception 'role A updated user B profile'; end if;

    delete from user_data.user_profiles
     where user_id = '00000000-0000-0000-0000-0000000000b1';
    if found then raise exception 'role A deleted user B profile'; end if;

    begin
        insert into user_data.user_wallet_items (user_id, item_type, nickname)
        values ('00000000-0000-0000-0000-0000000000b1', 'other', 'forged A-to-B write');
        raise exception 'role A inserted a wallet row for user B';
    exception when insufficient_privilege then null;
    end;

    insert into user_data.user_facts (
        user_id, fact_key, status, value, observed_at, source
    ) values (
        '00000000-0000-0000-0000-0000000000a1', 'm2_role_a_fact', 'known',
        '{"ok":true}'::jsonb, '2026-02-01T00:00:00Z', 'user_input'
    );
    delete from user_data.user_facts
     where user_id = '00000000-0000-0000-0000-0000000000a1'
       and fact_key = 'm2_role_a_fact';
    if not found then raise exception 'role A could not delete own inserted fact'; end if;
end
$$;
reset role;
reset request.jwt.claim.sub;

set role jro_m2_b;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$
declare
    t text;
    v_count integer;
begin
    foreach t in array array[
        'user_profiles', 'user_wallet_items', 'user_facts', 'user_asset_lots',
        'user_valuation_profiles', 'user_valuation_entries', 'user_cap_progress',
        'user_recommendation_history', 'user_recommendation_rule_versions',
        'correction_reports'
    ] loop
        execute format('select count(*) from user_data.%I', t) into v_count;
        if v_count <> 1 then
            raise exception 'role B expected one visible row in %, got %', t, v_count;
        end if;
    end loop;

    update user_data.user_profiles
       set locale = 'ja-JP-x-test'
     where user_id = '00000000-0000-0000-0000-0000000000b1';
    if not found then raise exception 'role B could not update own profile'; end if;

    update user_data.user_profiles
       set locale = 'should-not-write-A'
     where user_id = '00000000-0000-0000-0000-0000000000a1';
    if found then raise exception 'role B updated user A profile'; end if;

    delete from user_data.user_profiles
     where user_id = '00000000-0000-0000-0000-0000000000a1';
    if found then raise exception 'role B deleted user A profile'; end if;

    begin
        insert into user_data.user_wallet_items (user_id, item_type, nickname)
        values ('00000000-0000-0000-0000-0000000000a1', 'other', 'forged B-to-A write');
        raise exception 'role B inserted a wallet row for user A';
    exception when insufficient_privilege then null;
    end;
end
$$;
reset role;
reset request.jwt.claim.sub;

-- No claim (including a role-local leftover claim after RESET) must grant access.
set role jro_m2_a;
reset request.jwt.claim.sub;
do $$
declare
    v_count integer;
begin
    select count(*) into v_count from user_data.user_profiles;
    if v_count <> 0 then raise exception 'missing JWT identity exposed % profile rows', v_count; end if;
    begin
        insert into user_data.user_profiles (user_id) values ('00000000-0000-0000-0000-0000000000c1');
        raise exception 'missing JWT identity unexpectedly allowed insert';
    exception when insufficient_privilege then null;
    end;
end
$$;
reset role;

-- ----------
-- Deletion cascade: delete A through A's own policy, then inspect as owner.
-- ----------

set role jro_m2_a;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
delete from user_data.user_profiles
 where user_id = '00000000-0000-0000-0000-0000000000a1';
reset role;
reset request.jwt.claim.sub;

do $$
declare
    t text;
    v_a_count bigint;
    v_b_count bigint;
begin
    -- An owner has no policy for these role-specific policies; temporarily
    -- remove FORCE only for owner-side inspection, and restore it before exit.
    foreach t in array array[
        'user_profiles', 'user_wallet_items', 'user_facts', 'user_asset_lots',
        'user_valuation_profiles', 'user_valuation_entries', 'user_cap_progress',
        'user_recommendation_history', 'user_recommendation_rule_versions',
        'correction_reports'
    ] loop
        execute format('alter table user_data.%I no force row level security', t);
    end loop;

    foreach t in array array[
        'user_profiles', 'user_wallet_items', 'user_facts', 'user_asset_lots',
        'user_valuation_profiles', 'user_valuation_entries', 'user_cap_progress',
        'user_recommendation_history', 'user_recommendation_rule_versions',
        'correction_reports'
    ] loop
        -- Valuation entries and recommendation-rule links do not have a direct
        -- user_id; their policy/FK roots are checked through their parent rows.
        if t = 'user_valuation_entries' then
            execute format(
                'select count(*) from user_data.%I e join user_data.user_valuation_profiles p on p.id=e.valuation_profile_id where p.user_id=$1', t
            ) into v_a_count using '00000000-0000-0000-0000-0000000000a1'::uuid;
            if v_a_count <> 0 then raise exception 'cascade left valuation entries for user A'; end if;
        elsif t = 'user_recommendation_rule_versions' then
            execute format(
                'select count(*) from user_data.%I x join user_data.user_recommendation_history h on h.id=x.recommendation_history_id where h.user_id=$1', t
            ) into v_a_count using '00000000-0000-0000-0000-0000000000a1'::uuid;
            if v_a_count <> 0 then raise exception 'cascade left recommendation rule links for user A'; end if;
        else
            execute format('select count(*) from user_data.%I where user_id = $1', t)
                into v_a_count using '00000000-0000-0000-0000-0000000000a1'::uuid;
            if v_a_count <> 0 then raise exception 'cascade left % rows in % for user A', v_a_count, t; end if;
        end if;
    end loop;

    select count(*) into v_b_count from user_data.user_profiles
     where user_id = '00000000-0000-0000-0000-0000000000b1';
    if v_b_count <> 1 then raise exception 'cascade unexpectedly removed user B profile'; end if;
    select count(*) into v_b_count from user_data.user_wallet_items
     where user_id = '00000000-0000-0000-0000-0000000000b1';
    if v_b_count <> 1 then raise exception 'cascade unexpectedly removed user B wallet'; end if;

    foreach t in array array[
        'user_profiles', 'user_wallet_items', 'user_facts', 'user_asset_lots',
        'user_valuation_profiles', 'user_valuation_entries', 'user_cap_progress',
        'user_recommendation_history', 'user_recommendation_rule_versions',
        'correction_reports'
    ] loop
        execute format('alter table user_data.%I force row level security', t);
    end loop;
end
$$;

-- ----------
-- Strengthened unknown-state constraints and retention purge
-- ----------

set role jro_m2_b;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$
begin
    begin
        insert into user_data.user_facts (
            user_id, fact_key, status, value, source
        ) values (
            '00000000-0000-0000-0000-0000000000b1', 'm2_forged_unknown',
            'unknown', '{"forged":true}'::jsonb, 'unknown'
        );
        raise exception 'unknown user fact with payload unexpectedly succeeded';
    exception when check_violation then null;
    end;
    begin
        insert into user_data.user_facts (
            user_id, fact_key, status, value, observed_at, source
        ) values (
            '00000000-0000-0000-0000-0000000000b1', 'm2_forged_known',
            'known', '1'::jsonb, '2026-02-01T00:00:00Z', 'inferred'
        );
        raise exception 'known user fact with inferred source unexpectedly succeeded';
    exception when check_violation then null;
    end;
    begin
        insert into user_data.user_cap_progress (
            user_id, cap_key, status, eligible_spend_jpy_min, eligible_spend_jpy_max,
            reward_earned_units_min, reward_earned_units_max, source
        ) values (
            '00000000-0000-0000-0000-0000000000b1', 'm2_forged_unknown',
            'unknown', 1, 2, 3, 4, 'unknown'
        );
        raise exception 'unknown cap state with numeric payload unexpectedly succeeded';
    exception when check_violation then null;
    end;
end
$$;
reset role;
reset request.jwt.claim.sub;

-- The test owner was granted SET membership only to exercise both client
-- roles. Remove those memberships before testing the owner-only maintenance
-- policies; restrictive client policies intentionally compose with every
-- inherited role membership.
do $$
begin
    execute format('revoke jro_m2_a from %I', session_user);
    execute format('revoke jro_m2_b from %I', session_user);
end
$$;

-- Seed retention fixtures as the table owner without depending on superuser
-- bypass. FORCE is restored before the purge call so that call proves the
-- migration-owner maintenance policies are sufficient.
alter table user_data.user_recommendation_history no force row level security;
alter table user_data.user_recommendation_rule_versions no force row level security;
alter table user_data.correction_reports no force row level security;

insert into user_data.user_recommendation_history (
    user_id, recommendation_key, engine_version, contracts_version,
    request_hash, request_payload_redacted, result_payload, result_hash,
    transaction_time, replay_knowledge_time, valuation_profile_version,
    retention_class, purge_after, payload_redaction_status
)
values
    ('00000000-0000-0000-0000-0000000000b1', 'm2_purge_expired', 'm2-engine', 'm2-contracts',
     'sha256:' || repeat('e',64), '{"expired":true}'::jsonb, '{"result":"expired"}'::jsonb,
     'sha256:' || repeat('f',64), '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z',
     'm2-test-valuations', '30_days', '2026-01-01T00:00:00Z', 'redacted'),
    ('00000000-0000-0000-0000-0000000000b1', 'm2_purge_future', 'm2-engine', 'm2-contracts',
     'sha256:' || repeat('0',64), '{"future":true}'::jsonb, '{"result":"future"}'::jsonb,
     'sha256:' || repeat('1',64), '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z',
     'm2-test-valuations', '30_days', '2026-12-01T00:00:00Z', 'redacted'),
    ('00000000-0000-0000-0000-0000000000b1', 'm2_purge_legal', 'm2-engine', 'm2-contracts',
     'sha256:' || repeat('2',64), '{"legal":true}'::jsonb, '{"result":"legal"}'::jsonb,
     'sha256:' || repeat('3',64), '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z',
     'm2-test-valuations', 'legal_hold', null, 'redacted');

insert into user_data.user_recommendation_rule_versions (
    recommendation_history_id, rule_version_id, disposition, reason_codes
)
select rh.id, rrv.id, 'considered', '["purge-link"]'::jsonb
  from user_data.user_recommendation_history rh
  cross join app_private.reward_rule_versions rrv
  join app_private.reward_rules rr on rr.id = rrv.rule_id
 where rh.user_id = '00000000-0000-0000-0000-0000000000b1'
   and rh.recommendation_key in ('m2_purge_expired', 'm2_purge_future', 'm2_purge_legal')
   and rr.rule_key = 'rr_m2_draft_fixture';

insert into user_data.correction_reports (
    user_id, recommendation_history_id, report_payload_redacted,
    privacy_redaction_status, status, purge_after
)
select rh.user_id, rh.id, jsonb_build_object('kind', rh.recommendation_key),
       'complete', 'open',
       case rh.recommendation_key
           when 'm2_purge_expired' then '2026-12-01T00:00:00Z'::timestamptz
           when 'm2_purge_future' then '2026-12-01T00:00:00Z'::timestamptz
           else '2026-01-01T00:00:00Z'::timestamptz
       end
  from user_data.user_recommendation_history rh
 where rh.user_id = '00000000-0000-0000-0000-0000000000b1'
   and rh.recommendation_key in ('m2_purge_expired', 'm2_purge_future', 'm2_purge_legal');

-- A standalone expired correction proves the correction branch is not only
-- removed as a side effect of a history-row cascade.
insert into user_data.correction_reports (
    user_id, recommendation_history_id, report_payload_redacted,
    privacy_redaction_status, status, purge_after
)
values (
    '00000000-0000-0000-0000-0000000000b1', null, '{"kind":"standalone-expired"}'::jsonb,
    'complete', 'open', '2026-01-01T00:00:00Z'
);

alter table user_data.user_recommendation_history force row level security;
alter table user_data.user_recommendation_rule_versions force row level security;
alter table user_data.correction_reports force row level security;

do $$
declare
    v_recommendations bigint;
    v_corrections bigint;
begin
    select recommendations_deleted, correction_reports_deleted
      into v_recommendations, v_corrections
      from app_private.purge_expired_user_history('2026-02-01T00:00:00Z');
    if v_recommendations <> 1 then
        raise exception 'purge expected one expired recommendation, got %', v_recommendations;
    end if;
    if v_corrections <> 2 then
        raise exception 'purge expected linked plus standalone expired corrections, got %', v_corrections;
    end if;
end
$$;

do $$
declare
    v_count integer;
begin
    select count(*) into v_count from user_data.user_recommendation_history
     where recommendation_key = 'm2_purge_expired';
    if v_count <> 0 then raise exception 'expired recommendation survived purge'; end if;
    select count(*) into v_count from user_data.user_recommendation_rule_versions x
      join user_data.user_recommendation_history h on h.id = x.recommendation_history_id
     where h.recommendation_key = 'm2_purge_expired';
    if v_count <> 0 then raise exception 'linked rule row survived expired-history purge'; end if;
    select count(*) into v_count from user_data.correction_reports
     where report_payload_redacted->>'kind' in ('m2_purge_expired', 'standalone-expired');
    if v_count <> 0 then raise exception 'expired correction survived purge'; end if;

    select count(*) into v_count from user_data.user_recommendation_history
     where recommendation_key = 'm2_purge_future';
    if v_count <> 1 then raise exception 'future recommendation did not survive purge'; end if;
    select count(*) into v_count from user_data.user_recommendation_history
     where recommendation_key = 'm2_purge_legal' and retention_class = 'legal_hold';
    if v_count <> 1 then raise exception 'legal-hold recommendation did not survive purge'; end if;
    select count(*) into v_count from user_data.correction_reports
     where report_payload_redacted->>'kind' in ('m2_purge_future', 'm2_purge_legal');
    if v_count <> 2 then raise exception 'future/legal-hold corrections were not preserved'; end if;
end
$$;

rollback;
