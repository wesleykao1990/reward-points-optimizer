\set ON_ERROR_STOP on

begin;

do $privileges$
begin
    if has_function_privilege(
           'public',
           'app_private.p0_route_graph_facts_at(timestamptz)',
           'execute'
       ) then
        raise exception 'route-graph source projection is PUBLIC executable';
    end if;
    if not has_function_privilege(
           'jro_runtime',
           'app_private.p0_route_graph_facts_at(timestamptz)',
           'execute'
       ) then
        raise exception 'runtime cannot execute route-graph source projection';
    end if;
    if has_table_privilege(
           'jro_runtime',
           'app_private.p0_implementation_facts',
           'select'
       ) then
        raise exception 'runtime received direct implementation-fact SELECT';
    end if;
end
$privileges$;

do $projection$
declare
    v_snapshot uuid;
    v_future_snapshot uuid;
    v_current uuid;
    v_corrected uuid;
    v_rows integer;
    v_identity jsonb;
    v_exclusions jsonb;
begin
    perform set_config('app_private.p0_implementation_write_context', 'snapshot', true);
    insert into app_private.p0_implementation_snapshots (
        implementation_version, implementation_hash, artifact_type,
        research_artifact_id, research_artifact_hash, coverage_index_version,
        as_of, parent_claim_count, derived_rule_count, fact_count,
        snapshot_payload
    ) values (
        'p0-route-graph-test.implementation.v1',
        'sha256:' || repeat('a', 64),
        'p0_point_rules_implementation',
        'p0-route-graph-test.research.v1',
        'sha256:' || repeat('b', 64),
        'p0-coverage-index.v0.7',
        timestamptz '2026-08-24T00:00:00+09:00',
        3, 0, 3, '{}'::jsonb
    ) returning snapshot_id into v_snapshot;

    insert into app_private.p0_implementation_snapshots (
        implementation_version, implementation_hash, artifact_type,
        research_artifact_id, research_artifact_hash, coverage_index_version,
        as_of, parent_claim_count, derived_rule_count, fact_count,
        snapshot_payload
    ) values (
        'p0-route-graph-future.implementation.v1',
        'sha256:' || repeat('c', 64),
        'p0_point_rules_implementation',
        'p0-route-graph-future.research.v1',
        'sha256:' || repeat('d', 64),
        'p0-coverage-index.v0.7',
        timestamptz '2026-08-24T00:00:00+09:00',
        1, 0, 1, '{}'::jsonb
    ) returning snapshot_id into v_future_snapshot;

    v_identity := jsonb_build_array(jsonb_build_object(
        'source_id', 'source.route.shared',
        'family_id', 'family.source',
        'roles', jsonb_build_array('earn_rules'),
        'url', 'https://example.invalid/route',
        'publisher', 'Example Publisher',
        'official_domain', 'example.invalid'
    ));

    insert into app_private.p0_implementation_facts (
        snapshot_id, implementation_version, implementation_hash,
        parent_claim_id, family_id, source_role_id, source_ids,
        source_identity, claim_type, subject, predicate, value, applicability,
        exclusions, evidence_locator, short_paraphrase, disposition,
        derived_rule_ids, fact_payload
    ) values (
        v_snapshot, 'p0-route-graph-test.implementation.v1',
        'sha256:' || repeat('a', 64), 'claim.route.graph.current.001',
        'family.claim', 'earn_rules', '["source.route.shared"]'::jsonb,
        v_identity, 'transfer_rule', 'route', 'transfer_ratio',
        '{"source_units":"1","destination_units":"1"}'::jsonb,
        '{"status":"current_as_observed"}'::jsonb,
        '["Preserve this exclusion"]'::jsonb, 'https://example.invalid/route',
        'Current route fact', 'catalogue_fact', '[]'::jsonb, '{}'::jsonb
    ) returning fact_id into v_current;

    insert into app_private.p0_implementation_facts (
        snapshot_id, implementation_version, implementation_hash,
        parent_claim_id, family_id, source_role_id, source_ids,
        source_identity, claim_type, subject, predicate, value, applicability,
        exclusions, evidence_locator, short_paraphrase, disposition,
        derived_rule_ids, fact_payload
    ) values (
        v_snapshot, 'p0-route-graph-test.implementation.v1',
        'sha256:' || repeat('a', 64), 'claim.route.graph.corrected.001',
        'family.claim', 'earn_rules', '["source.route.shared"]'::jsonb,
        v_identity, 'transfer_rule', 'route', 'transfer_ratio',
        '{"source_units":"2","destination_units":"1"}'::jsonb,
        '{"status":"current_as_observed"}'::jsonb, '[]'::jsonb,
        'https://example.invalid/route', 'Corrected route fact',
        'catalogue_fact', '[]'::jsonb, '{}'::jsonb
    ) returning fact_id into v_corrected;

    insert into app_private.p0_implementation_facts (
        snapshot_id, implementation_version, implementation_hash,
        parent_claim_id, family_id, source_role_id, source_ids,
        source_identity, claim_type, subject, predicate, value, applicability,
        exclusions, evidence_locator, short_paraphrase, disposition,
        derived_rule_ids, fact_payload
    ) values (
        v_future_snapshot, 'p0-route-graph-future.implementation.v1',
        'sha256:' || repeat('c', 64), 'claim.route.graph.future.001',
        'family.future', 'earn_rules', '["source.route.shared"]'::jsonb,
        v_identity, 'campaign_rule', 'future route', 'future',
        '{"source_units":"1","destination_units":"1"}'::jsonb,
        '{"status":"current_as_observed","effective_from":"2027-01-01"}'::jsonb,
        '[]'::jsonb, 'https://example.invalid/route', 'Future route fact',
        'catalogue_fact', '[]'::jsonb, '{}'::jsonb
    );

    select count(*) into v_rows
      from app_private.p0_route_graph_facts_at(
          timestamptz '2026-08-25T00:00:00+09:00'
      )
     where claim_id = 'claim.route.graph.current.001';
    if v_rows <> 1 then
        raise exception 'current route fact was not projected';
    end if;

    select source_identity, exclusions
      into v_identity, v_exclusions
      from app_private.p0_route_graph_facts_at(
          timestamptz '2026-08-25T00:00:00+09:00'
      )
     where claim_id = 'claim.route.graph.current.001';
    if v_identity <> jsonb_build_array(jsonb_build_object(
           'source_id', 'source.route.shared',
           'family_id', 'family.source',
           'roles', jsonb_build_array('earn_rules'),
           'url', 'https://example.invalid/route',
           'publisher', 'Example Publisher',
           'official_domain', 'example.invalid'
       ))
       or v_exclusions <> '["Preserve this exclusion"]'::jsonb then
        raise exception 'source identity or exclusions were not preserved';
    end if;

    select count(*) into v_rows
      from app_private.p0_route_graph_facts_at(
          timestamptz '2026-08-25T00:00:00+09:00'
      )
     where claim_id = 'claim.route.graph.future.001';
    if v_rows <> 0 then
        raise exception 'future route fact was projected as active';
    end if;

    perform set_config('app_private.p0_implementation_write_context', 'correction', true);
    insert into app_private.p0_implementation_fact_corrections (
        correction_id, fact_id, snapshot_id, implementation_version,
        implementation_hash, parent_claim_id, fact_version, reason,
        correction_payload
    ) values (
        'corr.route.graph.001', v_corrected, v_snapshot,
        'p0-route-graph-test.implementation.v1', 'sha256:' || repeat('a', 64),
        'claim.route.graph.corrected.001', 1, 'focused test correction',
        '{}'::jsonb
    );

    select count(*) into v_rows
      from app_private.p0_route_graph_facts_at(
          timestamptz '2026-08-25T00:00:00+09:00'
      )
     where claim_id = 'claim.route.graph.corrected.001';
    if v_rows <> 0 then
        raise exception 'corrected route fact remained projected';
    end if;
end
$projection$;

rollback;
