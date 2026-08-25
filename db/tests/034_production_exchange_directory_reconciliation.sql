\set ON_ERROR_STOP on

begin;

do $exchange_directory_reconciliation$
declare
    v_receipt uuid;
    v_source jsonb := jsonb_build_object(
        'source_id', 'source.test.exchange-directory',
        'family_id', 'point.moppy',
        'roles', jsonb_build_array('transfer_partner_directory'),
        'url', 'https://example.test/official/exchange',
        'publisher', 'Test official publisher',
        'official_domain', 'example.test'
    );
    v_transfer jsonb;
    v_claim jsonb;
    v_snapshot jsonb;
    v_count integer;
begin
    v_transfer := jsonb_build_object(
        'route_id', 'moppy-to-ana-live-test',
        'operation', 'transfer',
        'source_asset_ref', 'asset.point.moppy',
        'destination_asset_ref', 'asset.mile.ana',
        'source_units', 1000,
        'destination_units', 300,
        'minimum_source_units', 1000,
        'increment_source_units', 1000,
        'maximum_source_units_per_request', null,
        'maximum_source_units_per_period', null,
        'maximum_period', null,
        'fee_source_units', 0,
        'processing_time_days_min', 1,
        'processing_time_days_max', 3,
        'cancellation_policy', 'provider_defined',
        'validity', jsonb_build_object(
            'valid_from', null, 'valid_to', null, 'timezone', 'Asia/Tokyo'
        ),
        'prerequisite_ids', '[]'::jsonb,
        'requires_rule_ids', '[]'::jsonb,
        'required_conditions_ja', '[]'::jsonb,
        'requires_direct_source', false,
        'partial_consumption', true
    );
    v_claim := jsonb_build_object(
        'claim_id', 'claim.route.moppy.ana.live-test.001',
        'family_id', 'point.moppy',
        'source_role_id', 'transfer_partner_directory',
        'source_ids', jsonb_build_array('source.test.exchange-directory'),
        'claim_type', 'transfer_rule',
        'subject', 'モッピーからANAマイル',
        'predicate', 'converts_at_fixed_ratio',
        'value', jsonb_build_object('transfer', v_transfer),
        'applicability', jsonb_build_object(
            'status', 'current_as_observed', 'effective_from', null,
            'effective_to', null, 'timezone', 'Asia/Tokyo'
        ),
        'exclusions', '[]'::jsonb
    );
    v_snapshot := jsonb_build_object(
        'version', 'production-exchange-directory-snapshot.v1',
        'directory_id', 'directory.test.moppy',
        'family_id', 'point.moppy',
        'source_role_id', 'transfer_partner_directory',
        'source_asset_id', 'asset.point.moppy',
        'complete', true,
        'sources', jsonb_build_array(v_source),
        'entries', jsonb_build_array(
            jsonb_build_object(
                'entry_id', 'moppy-to-ana-live-test',
                'destination_asset_id', 'asset.mile.ana',
                'disposition', 'exact_executable',
                'primary_claim_id', 'claim.route.moppy.ana.live-test.001',
                'claims', jsonb_build_array(v_claim),
                'research_request', null
            ),
            jsonb_build_object(
                'entry_id', 'moppy-to-unknown-fee',
                'destination_asset_id', 'asset.point.ponta',
                'disposition', 'incomplete_parameters',
                'primary_claim_id', null,
                'claims', '[]'::jsonb,
                'research_request', jsonb_build_object(
                    'missing_fields', jsonb_build_array('fee_schedule'),
                    'question_ja', '交換額ごとの手数料表を確認してください。'
                )
            )
        )
    );

    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, finding_id, event_type,
        payload_hash, raw_payload
    ) values (
        'evt_exchange_directory_001', '0.1', 'stream_exchange_directory',
        'run_exchange_directory_001', 'finding_exchange_directory_001',
        'finding.submitted', 'sha256:' || repeat('a', 64), '{}'::jsonb
    ) returning id into v_receipt;
    insert into app_private.source_observations (
        observation_key, receipt_id, semantic_fingerprint_version,
        semantic_fingerprint, source_keys, source_ids, subjects, change_type,
        summary, effective_time, discovery_assessment, raw_attributes, status,
        created_at
    ) values (
        'so_exchange_directory_001', v_receipt, 1,
        'sha256:' || repeat('b', 64), '["source.test.exchange-directory"]',
        '["source.test.exchange-directory"]',
        '[{"type":"reward_program","id":"point.moppy","name":"Moppy"}]',
        'transfer', 'Complete exchange directory snapshot.',
        '{"occurred_at":null,"effective_from":null,"effective_to":null}',
        '{"source_authority_claim":"primary","evidence_completeness":"complete","agent_confidence":1}',
        jsonb_build_object('exchange_directory_snapshot', v_snapshot),
        'needs_review', '2026-08-26T00:00:00+09:00'
    );

    if not exists (
        select 1 from app_private.p0_route_graph_facts_at('2026-08-26T00:00:00+09:00')
         where claim_id = 'claim.route.moppy.ana.live-test.001'
           and value #>> '{transfer,destination_units}' = '300'
    ) then
        raise exception 'initial Agent Feed directory edge was not visible immediately';
    end if;
    if (select count(*) from app_private.production_exchange_research_tasks
         where directory_id = 'directory.test.moppy') <> 1 then
        raise exception 'incomplete directory row did not create one research task';
    end if;
    if not exists (
        select 1 from app_private.production_exchange_graph_change_events
         where directory_id = 'directory.test.moppy'
           and rebuild_mode = 'complete_directory'
           and affected_rule_ids @> '["p0.transfer.moppy-to-ana-live-test"]'
    ) then
        raise exception 'affected rule/node change event was not recorded';
    end if;

    -- A partial update replaces only its entry and is visible without a deploy.
    v_transfer := jsonb_set(v_transfer, '{destination_units}', '350'::jsonb);
    v_claim := jsonb_set(v_claim, '{value,transfer}', v_transfer);
    v_snapshot := jsonb_set(v_snapshot, '{complete}', 'false'::jsonb);
    v_snapshot := jsonb_set(
        v_snapshot, '{entries}',
        jsonb_build_array(jsonb_build_object(
            'entry_id', 'moppy-to-ana-live-test',
            'destination_asset_id', 'asset.mile.ana',
            'disposition', 'exact_executable',
            'primary_claim_id', 'claim.route.moppy.ana.live-test.001',
            'claims', jsonb_build_array(v_claim),
            'research_request', null
        ))
    );
    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, finding_id, event_type,
        payload_hash, raw_payload
    ) values (
        'evt_exchange_directory_002', '0.1', 'stream_exchange_directory',
        'run_exchange_directory_002', 'finding_exchange_directory_002',
        'finding.submitted', 'sha256:' || repeat('c', 64), '{}'::jsonb
    ) returning id into v_receipt;
    insert into app_private.source_observations (
        observation_key, receipt_id, semantic_fingerprint_version,
        semantic_fingerprint, source_keys, source_ids, subjects, change_type,
        summary, effective_time, discovery_assessment, raw_attributes, status,
        created_at
    ) values (
        'so_exchange_directory_002', v_receipt, 1,
        'sha256:' || repeat('d', 64), '["source.test.exchange-directory"]',
        '["source.test.exchange-directory"]',
        '[{"type":"reward_program","id":"point.moppy","name":"Moppy"}]',
        'transfer', 'Partial exchange directory update.',
        '{"occurred_at":null,"effective_from":null,"effective_to":null}',
        '{"source_authority_claim":"primary","evidence_completeness":"complete","agent_confidence":1}',
        jsonb_build_object('exchange_directory_snapshot', v_snapshot),
        'needs_review', '2026-08-26T01:00:00+09:00'
    );
    select count(*) into v_count
      from app_private.p0_route_graph_facts_at('2026-08-26T02:00:00+09:00')
     where claim_id = 'claim.route.moppy.ana.live-test.001'
       and value #>> '{transfer,destination_units}' = '350';
    if v_count <> 1 then
        raise exception 'partial directory update did not replace the affected edge: %', v_count;
    end if;
    if not exists (
        select 1 from app_private.production_exchange_directory_claims_at(
            '2026-08-26T02:00:00+09:00'
        ) where claim_id = 'claim.route.moppy.ana.live-test.001'
    ) then
        raise exception 'current directory projection omitted the updated edge';
    end if;

    -- Reclassifying the same entry as incomplete removes it from arithmetic
    -- and creates the exact follow-up question instead of guessing a rate.
    v_snapshot := jsonb_set(
        v_snapshot, '{entries}',
        jsonb_build_array(jsonb_build_object(
            'entry_id', 'moppy-to-ana-live-test',
            'destination_asset_id', 'asset.mile.ana',
            'disposition', 'incomplete_parameters',
            'primary_claim_id', null,
            'claims', '[]'::jsonb,
            'research_request', jsonb_build_object(
                'missing_fields', jsonb_build_array('destination_units'),
                'question_ja', '現在の交換後マイル数を確認してください。'
            )
        ))
    );
    insert into app_private.agent_feed_receipts (
        event_id, protocol_version, stream_id, run_id, finding_id, event_type,
        payload_hash, raw_payload
    ) values (
        'evt_exchange_directory_003', '0.1', 'stream_exchange_directory',
        'run_exchange_directory_003', 'finding_exchange_directory_003',
        'finding.submitted', 'sha256:' || repeat('e', 64), '{}'::jsonb
    ) returning id into v_receipt;
    insert into app_private.source_observations (
        observation_key, receipt_id, semantic_fingerprint_version,
        semantic_fingerprint, source_keys, source_ids, subjects, change_type,
        summary, effective_time, discovery_assessment, raw_attributes, status,
        created_at
    ) values (
        'so_exchange_directory_003', v_receipt, 1,
        'sha256:' || repeat('f', 64), '["source.test.exchange-directory"]',
        '["source.test.exchange-directory"]',
        '[{"type":"reward_program","id":"point.moppy","name":"Moppy"}]',
        'transfer', 'Directory row is now incomplete.',
        '{"occurred_at":null,"effective_from":null,"effective_to":null}',
        '{"source_authority_claim":"primary","evidence_completeness":"partial","agent_confidence":1}',
        jsonb_build_object('exchange_directory_snapshot', v_snapshot),
        'needs_evidence', '2026-08-26T03:00:00+09:00'
    );
    if exists (
        select 1 from app_private.production_exchange_directory_claims_at(
            '2026-08-26T04:00:00+09:00'
        ) where claim_id = 'claim.route.moppy.ana.live-test.001'
    ) then
        raise exception 'incomplete update left the old arithmetic edge active';
    end if;
end
$exchange_directory_reconciliation$;

do $exchange_directory_privileges$
begin
    if has_table_privilege(
           'jro_runtime', 'app_private.production_exchange_directory_snapshots', 'select'
       ) or has_table_privilege(
           'jro_runtime', 'app_private.production_exchange_research_tasks', 'select'
       ) then
        raise exception 'runtime received direct exchange-directory table access';
    end if;
    if has_function_privilege(
           'public', 'app_private.production_exchange_directory_claims_at(timestamptz)', 'execute'
       ) then
        raise exception 'exchange-directory projection is PUBLIC executable';
    end if;
end
$exchange_directory_privileges$;

rollback;
