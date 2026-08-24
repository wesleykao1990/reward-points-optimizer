\set ON_ERROR_STOP on

begin;

do $complete_route_snapshot$
declare
    v_count integer;
begin
    select count(*) into v_count
      from app_private.p0_implementation_rule_facts_at(
          '2026-08-24T12:00:00+09:00'::timestamptz
      );
    if v_count <> 364 then
        raise exception 'route compiler did not receive the complete 364-fact snapshot: %', v_count;
    end if;
end
$complete_route_snapshot$;

do $existing_merchant_catalogue$
declare
    v_count integer;
begin
    select count(*) into v_count
      from app_private.agent_feed_active_merchant_payment_acceptance_at(
          '2026-08-24T12:00:00+09:00'::timestamptz
      )
     where merchant_id = 'merchant.seveneleven'
       and payment_family in ('category.credit_card','category.mobile_pay')
       and accepted;
    if v_count <> 2 then
        raise exception 'existing merchant catalogue did not project card and mobile-pay acceptance';
    end if;
end
$existing_merchant_catalogue$;

-- The new tables remain private; runtime reads are bounded SECURITY DEFINER
-- functions, not Data API table grants or request-time evidence checks.
do $privileges$
begin
    if has_table_privilege(
           'jro_runtime',
           'app_private.agent_feed_typed_rule_records',
           'select'
       )
       or has_table_privilege(
           'jro_runtime',
           'app_private.agent_feed_merchant_payment_acceptance',
           'select'
       ) then
        raise exception 'runtime received direct typed-rule table SELECT';
    end if;
    if has_function_privilege(
           'public',
           'app_private.agent_feed_typed_rule_records_at(timestamptz)',
           'execute'
       )
       or has_function_privilege(
           'public',
           'app_private.agent_feed_active_rule_families_at(timestamptz)',
           'execute'
       )
       or has_function_privilege(
           'public',
           'app_private.agent_feed_active_merchant_payment_acceptance_at(timestamptz)',
           'execute'
       ) then
        raise exception 'typed-rule runtime projections are PUBLIC executable';
    end if;
    if not has_function_privilege(
           'jro_runtime',
           'app_private.agent_feed_typed_rule_records_at(timestamptz)',
           'execute'
       )
       or not has_function_privilege(
           'jro_runtime',
           'app_private.agent_feed_active_rule_families_at(timestamptz)',
           'execute'
       )
       or not has_function_privilege(
           'jro_runtime',
           'app_private.agent_feed_active_merchant_payment_acceptance_at(timestamptz)',
           'execute'
       ) then
        raise exception 'runtime cannot execute typed-rule projections';
    end if;
end
$privileges$;

do $typed_rule_materialization$
declare
    v_receipt_id uuid;
    v_observation_id uuid;
    v_record_count integer;
    v_before_count integer;
    v_after_count integer;
    v_first_version integer;
    v_latest_version integer;
    v_calc boolean;
    v_class text;
    v_family_count integer;
    v_acceptance_count integer;
    v_snapshot_id uuid;
    v_fact_id uuid;
    v_fact_record_count integer;
    v_active_fact_count integer;
begin
    -- A complete reward observation becomes one calculable typed rule and one
    -- authoritative merchant acceptance row, with no evidence/proof lookup.
    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, finding_id, event_type,
        payload_hash, raw_payload
    ) values (
        'evt_typed_rule_test_reward_001', '0.1', 'stream_typed_rule_test',
        'run_typed_rule_test_001', 'finding_typed_rule_test_reward_001',
        'finding.submitted', 'sha256:' || repeat('1', 64), '{}'::jsonb
    ) returning id into v_receipt_id;

    insert into app_private.source_observations (
        observation_key, receipt_id, semantic_fingerprint_version,
        semantic_fingerprint, source_keys, source_ids, subjects, change_type,
        summary, effective_time, discovery_assessment, raw_attributes, status
    ) values (
        'so_typed_rule_test_reward_001', v_receipt_id, 1,
        'sha256:' || repeat('2', 64), '["source.typed.reward"]'::jsonb,
        '["source.typed.reward"]'::jsonb,
        '[{"type":"merchant","id":"merchant.typed","name":"Typed merchant"}]'::jsonb,
        'reward_rate', 'An explicitly structured typed reward rule.',
        '{"occurred_at":null,"effective_from":null,"effective_to":null}'::jsonb,
        '{"source_authority_claim":"primary","evidence_completeness":"complete","agent_confidence":1}'::jsonb,
        '{"family_id":"family.typed.reward","merchant_id":"merchant.typed","payment_family":"card","accepted":true,"calculable":true,"calculation":{"model":"points_per_unit","spend_jpy":100,"reward_units":"1"}}'::jsonb,
        'new'
    ) returning id into v_observation_id;

    select count(*), min(rule_version), max(rule_version), bool_or(calculable)
      into v_record_count, v_first_version, v_latest_version, v_calc
      from app_private.agent_feed_typed_rule_records
     where source_kind = 'source_observation'
       and source_id = v_observation_id;
    if v_record_count <> 1 or v_first_version <> 1 or v_latest_version <> 1
       or v_calc is distinct from true then
        raise exception 'complete observation did not materialize one calculable v1 rule';
    end if;

    select count(*) into v_acceptance_count
      from app_private.agent_feed_active_merchant_payment_acceptance_at(now())
     where merchant_id = 'merchant.typed'
       and payment_family = 'card'
       and accepted;
    if v_acceptance_count <> 1 then
        raise exception 'explicit merchant acceptance was not active';
    end if;

    -- Replaying the same row through the AFTER UPDATE trigger is idempotent.
    select count(*) into v_before_count
      from app_private.agent_feed_typed_rule_records
     where source_kind = 'source_observation' and source_id = v_observation_id;
    update app_private.source_observations
       set raw_attributes = raw_attributes
     where id = v_observation_id;
    select count(*) into v_after_count
      from app_private.agent_feed_typed_rule_records
     where source_kind = 'source_observation' and source_id = v_observation_id;
    if v_after_count <> v_before_count then
        raise exception 'observation replay created a duplicate typed rule version';
    end if;

    -- A changed explicit payload creates a new version; removing the complete
    -- calculation object makes the latest rule non-calculable rather than
    -- inventing a rate from the remaining numeric-looking data.
    update app_private.source_observations
       set raw_attributes = '{"family_id":"family.typed.reward","merchant_id":"merchant.typed","payment_family":"card","accepted":true,"spend_jpy":100}'::jsonb
     where id = v_observation_id;
    select count(*), max(rule_version)
      into v_after_count, v_latest_version
      from app_private.agent_feed_typed_rule_records
     where source_kind = 'source_observation' and source_id = v_observation_id;
    select calculable
      into v_calc
      from app_private.agent_feed_typed_rule_records
     where source_kind = 'source_observation' and source_id = v_observation_id
     order by rule_version desc
     limit 1;
    if v_after_count <> 2 or v_latest_version <> 2 or v_calc is distinct from false then
        raise exception 'changed observation did not create a non-calculable v2';
    end if;
    select count(*) into v_record_count
      from app_private.agent_feed_typed_rule_records_at(now())
     where source_id = v_observation_id;
    if v_record_count <> 1 then
        raise exception 'active projection exposed superseded typed rule versions';
    end if;

    -- Informational observations and unknown/null JSON still materialize a
    -- bounded rule. The opaque family fallback is only used when no explicit
    -- family can be identified; it never drops the observation.
    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, finding_id, event_type,
        payload_hash, raw_payload
    ) values (
        'evt_typed_rule_test_info_001', '0.1', 'stream_typed_rule_test',
        'run_typed_rule_test_002', 'finding_typed_rule_test_info_001',
        'finding.submitted', 'sha256:' || repeat('3', 64), '{}'::jsonb
    ) returning id into v_receipt_id;
    insert into app_private.source_observations (
        observation_key, receipt_id, semantic_fingerprint, source_keys,
        source_ids, subjects, change_type, summary, effective_time,
        discovery_assessment, raw_attributes, status
    ) values (
        'so_typed_rule_test_info_001', v_receipt_id,
        'sha256:' || repeat('4', 64), '["source.typed.info"]'::jsonb,
        '["source.typed.info"]'::jsonb,
        '[{"type":"finding","id":null,"name":null}]'::jsonb,
        'announcement', 'An informational typed observation.',
        '{"occurred_at":null,"effective_from":null,"effective_to":null}'::jsonb,
        '{"source_authority_claim":"unknown","evidence_completeness":"lead_only","agent_confidence":null}'::jsonb,
        '{"family_id":"family.typed.info","spend_jpy":100}'::jsonb, 'new'
    ) returning id into v_observation_id;
    select rule_class, calculable into v_class, v_calc
      from app_private.agent_feed_typed_rule_records
     where source_id = v_observation_id;
    if v_class <> 'informational' or v_calc is distinct from false then
        raise exception 'informational observation was classified/calculated unsafely';
    end if;
    select count(*) into v_family_count
      from app_private.agent_feed_active_rule_families_at(now())
     where family_id = 'family.typed.info';
    if v_family_count <> 1 then
        raise exception 'new Agent Feed family was not enumerable';
    end if;

    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, finding_id, event_type,
        payload_hash, raw_payload
    ) values (
        'evt_typed_rule_test_null_001', '0.1', 'stream_typed_rule_test',
        'run_typed_rule_test_003', 'finding_typed_rule_test_null_001',
        'finding.submitted', 'sha256:' || repeat('5', 64), '{}'::jsonb
    ) returning id into v_receipt_id;
    insert into app_private.source_observations (
        observation_key, receipt_id, semantic_fingerprint, source_keys,
        source_ids, subjects, change_type, summary, effective_time,
        discovery_assessment, raw_attributes, status
    ) values (
        'so_typed_rule_test_null_001', v_receipt_id,
        'sha256:' || repeat('6', 64), '["source.typed.null"]'::jsonb,
        '["source.typed.null"]'::jsonb,
        '[{"type":"finding","id":null,"name":null}]'::jsonb,
        'unknown', 'A null-attributes hostile-shape observation.',
        '{"occurred_at":null,"effective_from":null,"effective_to":null}'::jsonb,
        '{"source_authority_claim":"unknown","evidence_completeness":"lead_only","agent_confidence":null}'::jsonb,
        'null'::jsonb, 'new'
    ) returning id into v_observation_id;
    select count(*) into v_record_count
      from app_private.agent_feed_typed_rule_records
     where source_id = v_observation_id;
    if v_record_count <> 1 then
        raise exception 'JSON null attributes dropped the normalized observation';
    end if;

    -- Source correction/quarantine is reflected by the current source row; the
    -- append-only history remains stored but disappears from active records.
    update app_private.source_observations
       set security_flags = '["security_flagged"]'::jsonb
     where id = (select id from app_private.source_observations
                  where observation_key = 'so_typed_rule_test_reward_001');
    select count(*) into v_record_count
      from app_private.agent_feed_typed_rule_records_at(now())
     where family_id = 'family.typed.reward';
    if v_record_count <> 0 then
        raise exception 'quarantined SourceObservation remained active';
    end if;

    -- Implementation facts receive exactly one typed outcome too, and the
    -- implementation correction ledger removes it from the active projection.
    perform set_config('app_private.p0_implementation_write_context', 'snapshot', true);
    insert into app_private.p0_implementation_snapshots (
        implementation_version, implementation_hash, artifact_type,
        research_artifact_id, research_artifact_hash, coverage_index_version,
        as_of, parent_claim_count, derived_rule_count, fact_count,
        snapshot_payload
    ) values (
        'p0-typed-rule-test.implementation.v1', 'sha256:' || repeat('7', 64),
        'p0_point_rules_implementation', 'p0-typed-rule-test.research.v0.1',
        'sha256:' || repeat('8', 64), 'p0-coverage-index.v0.3', now(), 1, 0, 1,
        '{}'::jsonb
    ) returning snapshot_id into v_snapshot_id;
    insert into app_private.p0_implementation_facts (
        snapshot_id, implementation_version, implementation_hash,
        parent_claim_id, family_id, source_role_id, source_ids, source_identity,
        claim_type, subject, predicate, value, applicability, exclusions,
        evidence_locator, short_paraphrase, disposition, derived_rule_ids,
        fact_payload
    ) values (
        v_snapshot_id, 'p0-typed-rule-test.implementation.v1',
        'sha256:' || repeat('7', 64), 'claim.typed-rule-test.001',
        'family.typed.fact', 'earn_rules', '["src.typed.fact"]'::jsonb,
        '[]'::jsonb, 'earn_rule', 'Typed implementation fact', 'awards_points',
        '{"points":1}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'test locator',
        'Typed implementation fact', 'catalogue_fact', '[]'::jsonb,
        '{"explicit_value":{"points":1}}'::jsonb
    ) returning fact_id into v_fact_id;
    perform set_config('app_private.p0_implementation_write_context', '', true);

    select count(*) into v_fact_record_count
      from app_private.agent_feed_typed_rule_records
     where source_kind = 'implementation_fact' and source_id = v_fact_id;
    if v_fact_record_count <> 1 then
        raise exception 'implementation fact did not get exactly one typed outcome';
    end if;
    select count(*) into v_active_fact_count
      from app_private.agent_feed_typed_rule_records_at(now())
     where source_id = v_fact_id;
    if v_active_fact_count <> 1 then
        raise exception 'implementation fact was not active before correction';
    end if;

    perform set_config('app_private.p0_implementation_write_context', 'correction', true);
    insert into app_private.p0_implementation_fact_corrections (
        correction_id, fact_id, snapshot_id, implementation_version,
        implementation_hash, parent_claim_id, fact_version, reason,
        correction_payload
    ) values (
        'corr.typed-rule-test.001', v_fact_id, v_snapshot_id,
        'p0-typed-rule-test.implementation.v1', 'sha256:' || repeat('7', 64),
        'claim.typed-rule-test.001', 1, 'typed rule test correction', '{}'::jsonb
    );
    perform set_config('app_private.p0_implementation_write_context', '', true);
    select count(*) into v_active_fact_count
      from app_private.agent_feed_typed_rule_records_at(now())
     where source_id = v_fact_id;
    if v_active_fact_count <> 0 then
        raise exception 'corrected implementation fact remained active';
    end if;
end
$typed_rule_materialization$;

rollback;
