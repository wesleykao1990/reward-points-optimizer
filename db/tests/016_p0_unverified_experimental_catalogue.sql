\set ON_ERROR_STOP on

begin;

do $test$
declare
    v_receipt_id uuid;
    v_observation_id uuid;
    v_candidate jsonb;
    v_mismatch_candidate jsonb;
    v_out record;
    v_before_rules integer;
    v_before_rule_versions integer;
    v_before_evidence integer;
    v_before_rule_evidence integer;
    v_before_publications integer;
    v_before_candidates integer;
    v_before_catalogue integer;
    v_options text[];
    v_sqlstate text;
begin
    select count(*) into v_before_rules from app_private.reward_rules;
    select count(*) into v_before_rule_versions from app_private.reward_rule_versions;
    select count(*) into v_before_evidence from app_private.evidence_records;
    select count(*) into v_before_rule_evidence from app_private.rule_evidence;
    select count(*) into v_before_publications from app_private.rule_publication_requests;
    select count(*) into v_before_candidates from app_private.provisional_rule_candidates;
    select count(*) into v_before_catalogue from app_api.p0_unverified_experimental_catalogue;

    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, finding_id, event_type,
        payload_hash, raw_payload, processing_status, redaction_status,
        delivery_id, signature_timestamp, signature_key_id, delivery_attempt,
        transport_payload_hash, signature_verified
    ) values (
        'evt_p0_nanaco_canary_001', '0.1', 'economy.seven-nanaco',
        '7f727453-b5d3-4585-8f87-44ffb0b380d3',
        'nanaco-economic-ui-canary-20260821-v1', 'finding.submitted',
        'sha256:' || repeat('1', 64), '{}'::jsonb, 'received', 'pending',
        'delivery_p0_nanaco_canary_001', '2026-08-21T00:05:00Z',
        'test-key', 1, 'sha256:' || repeat('1', 64), true
    ) returning id into v_receipt_id;

    select observation_id into v_observation_id
      from app_private.map_agent_feed_finding(
          v_receipt_id,
          'so_nanaco_economic_canary_001',
          '["jp.nanaco.shopping-earning"]'::jsonb,
          '[
             {"type":"loyalty_program","id":"program.jp.nanaco","name":"nanaco"},
             {"type":"merchant","id":"merchant.seveneleven","name":"Seven-Eleven"}
           ]'::jsonb,
          'reward_rate',
          'The supported Nanaco purchase reward canary finding.',
          '{"occurred_at":null,"effective_from":null,"effective_to":null}'::jsonb,
          '{"source_authority_claim":"primary","evidence_completeness":"complete","agent_confidence":0.95}'::jsonb,
          '["nanaco-shopping-earning-evidence-canary-20260821-v1"]'::jsonb,
          '{
             "change_type":"reward_rate",
             "program_id":"program.jp.nanaco",
             "merchant_id":"merchant.seveneleven",
             "reward_rate":{"reward_units":"1","spend_jpy":200,"spend_basis":"tax_exclusive"},
             "eligible_product_class":"ordinary",
             "posting_timing":"immediate_for_listed_merchant",
             "product_exclusions_apply":true,
             "canonical_publication":false,
             "human_verified":false
           }'::jsonb,
          '[]'::jsonb,
          'sha256:' || repeat('a', 64),
          1
      );
    if v_observation_id is null then
        raise exception 'Nanaco canary observation did not map';
    end if;
    update app_private.source_observations
       set status = 'needs_review'
     where id = v_observation_id;

    v_candidate := jsonb_build_object(
        'version','provisional-rule-candidate.v1',
        'candidate_id','candidate_p0_nanaco_canary_001',
        'observation_id','so_nanaco_economic_canary_001',
        'observation_fingerprint','sha256:' || repeat('a', 64),
        'p0_family_id','point.nanaco',
        'source_role_id','earn_rules',
        'source_authority_role','primary',
        'source_ids','["jp.nanaco.shopping-earning"]'::jsonb,
        'rule',jsonb_build_object(
            'rule_id','rr_jp_cvs_006_nanaco_purchase_reward',
            'version',1,
            'status','under_review',
            'provenance',jsonb_build_object('human_verified',false),
            'audit',jsonb_build_object(
                'review_mode',null,'reviewed_at',null,'reviewed_by',null,
                'review_events','[]'::jsonb
            ),
            'validity',jsonb_build_object('superseded_at',null)
        ),
        'extractor',jsonb_build_object('name','p0-nanaco-economic-extractor','version','0.1'),
        'machine_check',jsonb_build_object(
            'checker','p0-nanaco-economic-semantic-check','checker_version','0.1',
            'checked_at','2026-08-21T00:05:00Z',
            'checks',jsonb_build_object(
                'representation_safe',true,'rule_structure',true,
                'rule_semantics',true,'observation_binding',true,
                'p0_coverage',true
            )
        )
    );

    select * into v_out
      from app_private.persist_p0_economic_candidate(
          'sha256:' || repeat('b', 64),
          'sha256:9f8cb5de0af689ee8ca751a3ae6a34c2d974eb1c79c29c60bd555da4db116746',
          v_candidate
      );
    if v_out.outcome is distinct from 'inserted'
       or v_out.status is distinct from 'machine_checked'
       or v_out.candidate_id is null then
        raise exception 'valid Nanaco canary was not inserted as machine_checked';
    end if;
    if (select count(*) from app_api.p0_unverified_experimental_catalogue) <> v_before_catalogue + 1 then
        raise exception 'machine_checked canary is not visible in the experimental catalogue';
    end if;

    -- Exact retry is idempotent and does not duplicate a candidate or expose a
    -- second row.
    select * into v_out
      from app_private.persist_p0_economic_candidate(
          'sha256:' || repeat('b', 64),
          'sha256:9f8cb5de0af689ee8ca751a3ae6a34c2d974eb1c79c29c60bd555da4db116746',
          v_candidate
      );
    if v_out.outcome is distinct from 'duplicate'
       or v_out.status is distinct from 'machine_checked'
       or (select count(*) from app_private.provisional_rule_candidates) <> v_before_candidates + 1 then
        raise exception 'Nanaco canary retry was not duplicate/idempotent';
    end if;

    -- A credible correction hides only the exact candidate version.
    perform app_private.record_provisional_correction(
        jsonb_build_object(
            'version','provisional-correction.v1',
            'signal_id','signal_p0_nanaco_canary_rate_wrong_001',
            'candidate_hash','sha256:' || repeat('b', 64),
            'category','rate_wrong',
            'credible',true,
            'reported_at','2026-08-21T00:06:00Z',
            'severity','normal'
        ),
        'sha256:' || repeat('c', 64)
    );
    if exists (
        select 1 from app_api.p0_unverified_experimental_catalogue
         where candidate_hash = 'sha256:' || repeat('b', 64)
    ) then
        raise exception 'corrected Nanaco candidate remained visible';
    end if;

    -- A mismatched source must fail before candidate insertion and must not
    -- alter any canonical table count.
    v_mismatch_candidate := jsonb_set(
        v_candidate,
        '{source_ids}',
        '["jp.nanaco.attacker-source"]'::jsonb,
        false
    );
    v_sqlstate := null;
    begin
        perform app_private.persist_p0_economic_candidate(
            'sha256:' || repeat('d', 64),
            'sha256:9f8cb5de0af689ee8ca751a3ae6a34c2d974eb1c79c29c60bd555da4db116746',
            v_mismatch_candidate
        );
    exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is null
       or exists (select 1 from app_private.provisional_rule_candidates where candidate_hash = 'sha256:' || repeat('d', 64)) then
        raise exception 'mismatched Nanaco source unexpectedly persisted';
    end if;

    if (select count(*) from app_private.reward_rules) <> v_before_rules
       or (select count(*) from app_private.reward_rule_versions) <> v_before_rule_versions
       or (select count(*) from app_private.evidence_records) <> v_before_evidence
       or (select count(*) from app_private.rule_evidence) <> v_before_rule_evidence
       or (select count(*) from app_private.rule_publication_requests) <> v_before_publications then
        raise exception 'P0 economic ingestion crossed the canonical boundary';
    end if;

    select c.reloptions into v_options
      from pg_class as c
      join pg_namespace as n on n.oid = c.relnamespace
     where n.nspname = 'app_api'
       and c.relname = 'p0_unverified_experimental_catalogue';
    if not ('security_invoker=true' = any(v_options))
       or not ('security_barrier=true' = any(v_options))
       or has_table_privilege('public', 'app_api.p0_unverified_experimental_catalogue', 'select')
       or has_function_privilege('public', 'app_private.persist_p0_economic_candidate(text,text,jsonb)', 'execute') then
        raise exception 'P0 economic catalogue boundary is not private/invoker-safe';
    end if;
end
$test$;

rollback;
