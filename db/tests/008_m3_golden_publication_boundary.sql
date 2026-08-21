\set ON_ERROR_STOP on
begin;

-- The generated seed persists exactly the two reviewed private golden fixtures.
do $$
declare
    v_count integer;
begin
    select count(*) into v_count
      from app_private.scenario_fixtures
     where scenario_key in ('JP-CVS-002', 'JP-CVS-006')
       and version = 1
       and status = 'golden';
    if v_count <> 2 then
        raise exception 'expected two seeded M3 golden fixtures, found %', v_count;
    end if;

    if (select fixture_hash from app_private.scenario_fixtures
         where scenario_key = 'JP-CVS-002' and version = 1)
       <> 'sha256:53f7431f52042c493ee300795eb7c77a5c996c0932742a26d362a946e32d8532' then
        raise exception 'JP-CVS-002 fixture hash mismatch';
    end if;
    if (select fixture_hash from app_private.scenario_fixtures
         where scenario_key = 'JP-CVS-006' and version = 1)
       <> 'sha256:d0bf84702534f9d0fa4a0c0946e407e73b509aac18aa409888de144db8e76dfa' then
        raise exception 'JP-CVS-006 fixture hash mismatch';
    end if;

    select count(*) into v_count from app_private.trusted_sources
     where source_key in (
        'merchant.seveneleven.payment-methods', 'merchant.seveneleven.nanaco',
        'jp.nanaco.redemption-value', 'jp.nanaco.sevencard-earning',
        'jp.nanaco.shopping-earning', 'jp.sevencard.nanaco-charge'
     ) and verification_status = 'content_verified';
    if v_count <> 6 then raise exception 'expected six verified M3 sources, found %', v_count; end if;

    select count(*) into v_count from app_private.evidence_records
     where evidence_key like 'ev_m3_%_20260820' and status = 'verified';
    if v_count <> 6 then raise exception 'expected six verified M3 evidence rows, found %', v_count; end if;

    select count(*) into v_count from app_private.reward_rules
     where rule_key like 'rr_jp_cvs_00%'
       and lifecycle_status = 'under_review';
    if v_count <> 6 then raise exception 'expected six under-review M3 rules, found %', v_count; end if;

    if exists (
        select 1 from app_private.reward_rule_versions rrv
        join app_private.reward_rules rr on rr.id = rrv.rule_id
        where rr.rule_key like 'rr_jp_cvs_00%'
          and rrv.review_status <> 'under_review'
    ) then raise exception 'M3 seed advanced a rule version beyond under_review'; end if;

    if exists (
        select 1 from app_private.rule_publication_requests rpr
        join app_private.reward_rules rr on rr.id = rpr.rule_id
        where rr.rule_key like 'rr_jp_cvs_00%'
    ) then raise exception 'M3 seed created a publication request'; end if;

    if exists (
        select 1 from app_api.approved_reward_rule_versions
        where rule_key like 'rr_jp_cvs_00%'
    ) then raise exception 'M3 seed leaked an under-review rule through the API view'; end if;
end
$$;

-- Exact fixture/evidence/rule/replay bindings survive database materialization.
do $$
declare
    v_count integer;
begin
    select count(*) into v_count
      from app_private.scenario_evidence se
      join app_private.scenario_fixtures sf on sf.id = se.scenario_fixture_id
     where sf.scenario_key = 'JP-CVS-002';
    if v_count <> 1 then raise exception 'JP-CVS-002 evidence link count mismatch'; end if;

    select count(*) into v_count
      from app_private.scenario_evidence se
      join app_private.scenario_fixtures sf on sf.id = se.scenario_fixture_id
     where sf.scenario_key = 'JP-CVS-006';
    if v_count <> 5 then raise exception 'JP-CVS-006 evidence link count mismatch'; end if;

    select count(*) into v_count
      from app_private.scenario_rule_versions srv
      join app_private.scenario_fixtures sf on sf.id = srv.scenario_fixture_id
     where sf.scenario_key = 'JP-CVS-002';
    if v_count <> 3 then raise exception 'JP-CVS-002 rule-relation count mismatch'; end if;

    select count(*) into v_count
      from app_private.scenario_rule_versions srv
      join app_private.scenario_fixtures sf on sf.id = srv.scenario_fixture_id
     where sf.scenario_key = 'JP-CVS-006';
    if v_count <> 8 then raise exception 'JP-CVS-006 rule-relation count mismatch'; end if;

    select count(*) into v_count
      from app_private.scenario_canonical_replays scr
      join app_private.scenario_fixtures sf on sf.id = scr.scenario_fixture_id
      join app_private.canonical_replay_runs cr on cr.id = scr.replay_run_id
     where sf.scenario_key in ('JP-CVS-002', 'JP-CVS-006')
       and cr.replay_class = 'golden_fixture'
       and cr.sealed_at is not null
       and cr.contains_user_data = false;
    if v_count <> 2 then raise exception 'expected two sealed private golden replays'; end if;

    if (select jsonb_array_length(cr.request_payload -> 'plans')
          from app_private.canonical_replay_runs cr
         where cr.replay_key = 'replay_jp_cvs_002_golden_v1') <> 2 then
        raise exception 'JP-CVS-002 replay input does not contain both engine plans';
    end if;

    if (select jsonb_array_length(cr.request_payload -> 'plans')
          from app_private.canonical_replay_runs cr
         where cr.replay_key = 'replay_jp_cvs_006_candidate') <> 1 then
        raise exception 'JP-CVS-006 replay input included the preflight-only plan';
    end if;

    if (select jsonb_array_length(cr.result_payload -> 'plans')
          from app_private.canonical_replay_runs cr
         where cr.replay_key = 'replay_jp_cvs_006_candidate') <> 1 then
        raise exception 'JP-CVS-006 replay output included the preflight-only result';
    end if;

    perform app_private.assert_golden_scenario_completion(id)
      from app_private.scenario_fixtures
     where scenario_key in ('JP-CVS-002', 'JP-CVS-006');
end
$$;

-- A golden fixture, its links, evidence, rule versions, and replay binding are immutable.
do $$
begin
    begin
        update app_private.scenario_fixtures
           set title = 'tampered'
         where scenario_key = 'JP-CVS-002';
        raise exception 'golden fixture update unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;

    begin
        delete from app_private.scenario_evidence
         where scenario_fixture_id = (
             select id from app_private.scenario_fixtures where scenario_key = 'JP-CVS-002'
         );
        raise exception 'golden evidence-link deletion unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;

    begin
        insert into app_private.scenario_evidence (scenario_fixture_id, evidence_id)
        select sf.id, er.id
          from app_private.scenario_fixtures sf
          cross join app_private.evidence_records er
         where sf.scenario_key = 'JP-CVS-002'
           and er.evidence_key = 'ev_m3_nanaco_redemption_value_20260820';
        raise exception 'golden evidence-link insertion unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;

    begin
        update app_private.evidence_records
           set notes = 'tampered'
         where evidence_key = 'ev_m3_seveneleven_payment_methods_20260820';
        raise exception 'golden evidence mutation unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;

    begin
        update app_private.reward_rule_versions rrv
           set definition = '{"tampered":true}'::jsonb
          from app_private.reward_rules rr
         where rr.id = rrv.rule_id
           and rr.rule_key = 'rr_jp_cvs_002_b_accept_credit_card';
        raise exception 'golden rule-version mutation unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;

    begin
        delete from app_private.scenario_canonical_replays
         where scenario_fixture_id = (
             select id from app_private.scenario_fixtures where scenario_key = 'JP-CVS-006'
         );
        raise exception 'golden replay-link deletion unexpectedly succeeded';
    exception when object_not_in_prerequisite_state then null;
    end;
end
$$;

-- Golden status alone cannot publish a rule. Both direct parent publication and
-- a forged completed request against an under-review version fail at the
-- deferred authorization boundary.
do $$
begin
    begin
        set constraints all deferred;
        update app_private.reward_rules
           set lifecycle_status = 'published'
         where rule_key = 'rr_jp_cvs_002_b_accept_credit_card';
        set constraints all immediate;
        raise exception 'direct M3 rule publication unexpectedly succeeded';
    exception when check_violation then null;
    end;
    set constraints all deferred;

    begin
        set constraints all deferred;
        insert into app_private.rule_publication_requests (
            rule_id, idempotency_key, request_hash, resulting_rule_version_id,
            status, created_by, completed_at
        )
        select rr.id, 'forged-m3-publication', 'sha256:' || repeat('f', 64),
               rrv.id, 'published', 'attacker', clock_timestamp()
          from app_private.reward_rules rr
          join app_private.reward_rule_versions rrv on rrv.rule_id = rr.id
         where rr.rule_key = 'rr_jp_cvs_002_b_accept_credit_card'
           and rrv.version = 1;
        set constraints all immediate;
        raise exception 'forged M3 publication request unexpectedly succeeded';
    exception when check_violation then null;
    end;
    set constraints all deferred;
end
$$;

-- A structurally golden row cannot commit without exact evidence, rule, and replay links.
do $$
begin
    begin
        set constraints all deferred;
        insert into app_private.scenario_fixtures (
            scenario_key, version, title, level, status, as_of, replay_knowledge_at,
            fixture_payload, fixture_hash, calculated_by, calculated_at,
            review_mode, required_review_modes, completed_review_modes,
            reviewed_by, reviewed_at
        )
        select 'JP-CVS-999', 1, 'forged golden', 'L1_SINGLE_RULE', 'golden',
               as_of, replay_knowledge_at,
               jsonb_set(jsonb_set(fixture_payload, '{scenario_id}', '"JP-CVS-999"'),
                         '{version}', '1'),
               'sha256:' || repeat('e', 64), 'attacker', clock_timestamp(),
               review_mode, required_review_modes, completed_review_modes,
               'attacker', clock_timestamp()
          from app_private.scenario_fixtures
         where scenario_key = 'JP-CVS-002';
        set constraints all immediate;
        raise exception 'unlinked forged golden fixture unexpectedly succeeded';
    exception when check_violation then null;
    end;
    set constraints all deferred;
end
$$;

-- New private objects/functions do not grant PUBLIC capabilities.
do $$
begin
    if has_table_privilege('public', 'app_private.scenario_canonical_replays', 'select') then
        raise exception 'PUBLIC can read scenario replay bindings';
    end if;
    if has_function_privilege(
        'public', 'app_private.assert_golden_scenario_completion(uuid)', 'execute'
    ) then
        raise exception 'PUBLIC can execute golden completion assertion';
    end if;
    if has_function_privilege(
        'public', 'app_private.assert_published_reward_rule_completion(uuid)', 'execute'
    ) then
        raise exception 'PUBLIC can execute publication assertion';
    end if;
end
$$;

rollback;
