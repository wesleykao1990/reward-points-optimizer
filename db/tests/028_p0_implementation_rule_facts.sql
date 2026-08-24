\set ON_ERROR_STOP on

begin;

-- The machine-readable fact projection widens what the runtime can read, so
-- the privilege boundary around it is asserted before anything else.
do $privileges$
begin
    if has_function_privilege(
           'public',
           'app_private.p0_implementation_rule_facts_at(timestamptz)',
           'execute'
       ) then
        raise exception 'implementation rule-fact projection is PUBLIC executable';
    end if;
    if not has_function_privilege(
           'jro_runtime',
           'app_private.p0_implementation_rule_facts_at(timestamptz)',
           'execute'
       ) then
        raise exception 'runtime cannot execute implementation rule-fact projection';
    end if;
    -- The projection is the only widening.  Direct table access would let the
    -- runtime read superseded snapshots and corrected facts.
    if has_table_privilege(
           'jro_runtime',
           'app_private.p0_implementation_facts',
           'select'
       ) then
        raise exception 'runtime received direct implementation-fact SELECT';
    end if;
    if has_table_privilege(
           'jro_runtime',
           'app_private.p0_implementation_snapshots',
           'select'
       ) then
        raise exception 'runtime received direct implementation-snapshot SELECT';
    end if;
end
$privileges$;

-- The function must be read-only: a compiler input can never be a write path.
do $volatility$
declare
    v_volatility "char";
    v_kind text;
begin
    select p.provolatile, p.prokind
      into v_volatility, v_kind
      from pg_catalog.pg_proc as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'app_private'
       and p.proname = 'p0_implementation_rule_facts_at';
    if v_volatility is null then
        raise exception 'implementation rule-fact projection is missing';
    end if;
    if v_volatility <> 's' then
        raise exception 'implementation rule-fact projection is not STABLE';
    end if;
    if v_kind <> 'f' then
        raise exception 'implementation rule-fact projection is not a function';
    end if;
end
$volatility$;

-- Only the newest snapshot of each research artifact may be projected, and a
-- corrected fact must disappear.  Both are asserted against real rows.
do $currency$
declare
    v_old uuid;
    v_new uuid;
    v_other uuid;
    v_fact uuid;
    v_rows integer;
    v_value jsonb;
begin
    insert into app_private.p0_implementation_snapshots (
        implementation_version, implementation_hash, artifact_type,
        research_artifact_id, research_artifact_hash, coverage_index_version,
        as_of, parent_claim_count, derived_rule_count, fact_count,
        snapshot_payload
    ) values (
        'p0-gate-old.implementation.v1',
        'sha256:' || repeat('1', 64),
        'p0_point_rules_implementation',
        'p0-gate.research.v0.1',
        'sha256:' || repeat('2', 64),
        'p0-coverage-index.v0.3',
        timestamptz '2026-08-01T00:00:00+09:00',
        1, 0, 1, '{}'::jsonb
    ) returning snapshot_id into v_old;

    insert into app_private.p0_implementation_snapshots (
        implementation_version, implementation_hash, artifact_type,
        research_artifact_id, research_artifact_hash, coverage_index_version,
        as_of, parent_claim_count, derived_rule_count, fact_count,
        snapshot_payload
    ) values (
        'p0-gate-new.implementation.v1',
        'sha256:' || repeat('3', 64),
        'p0_point_rules_implementation',
        'p0-gate.research.v0.1',
        'sha256:' || repeat('4', 64),
        'p0-coverage-index.v0.3',
        timestamptz '2026-08-20T00:00:00+09:00',
        1, 0, 1, '{}'::jsonb
    ) returning snapshot_id into v_new;

    insert into app_private.p0_implementation_snapshots (
        implementation_version, implementation_hash, artifact_type,
        research_artifact_id, research_artifact_hash, coverage_index_version,
        as_of, parent_claim_count, derived_rule_count, fact_count,
        snapshot_payload
    ) values (
        'p0-gate-other.implementation.v1',
        'sha256:' || repeat('5', 64),
        'p0_point_rules_implementation',
        'p0-gate-other.research.v0.1',
        'sha256:' || repeat('6', 64),
        'p0-coverage-index.v0.3',
        timestamptz '2026-08-02T00:00:00+09:00',
        1, 0, 1, '{}'::jsonb
    ) returning snapshot_id into v_other;

    insert into app_private.p0_implementation_facts (
        snapshot_id, implementation_version, implementation_hash,
        parent_claim_id, family_id, source_role_id, source_ids,
        source_identity, claim_type, subject, predicate, value, applicability,
        exclusions, evidence_locator, short_paraphrase, disposition,
        derived_rule_ids, fact_payload
    ) values
    (v_old, 'p0-gate-old.implementation.v1', 'sha256:' || repeat('1', 64),
     'claim.gate.rate.001', 'point.gate', 'earn_rules', '["src.gate"]'::jsonb,
     '[]'::jsonb, 'earn_rule', 'gate', 'awards_points',
     '{"spend_yen": 100, "points": 1}'::jsonb, '{}'::jsonb, '[]'::jsonb,
     'https://example.invalid/old', 'old', 'catalogue_fact', '[]'::jsonb,
     '{}'::jsonb),
    (v_new, 'p0-gate-new.implementation.v1', 'sha256:' || repeat('3', 64),
     'claim.gate.rate.001', 'point.gate', 'earn_rules', '["src.gate"]'::jsonb,
     '[]'::jsonb, 'earn_rule', 'gate', 'awards_points',
     '{"spend_yen": 100, "points": 2}'::jsonb, '{}'::jsonb, '[]'::jsonb,
     'https://example.invalid/new', 'new', 'catalogue_fact', '[]'::jsonb,
     '{}'::jsonb),
    (v_other, 'p0-gate-other.implementation.v1', 'sha256:' || repeat('5', 64),
     'claim.gate.other.001', 'point.gate', 'earn_rules', '["src.gate"]'::jsonb,
     '[]'::jsonb, 'earn_rule', 'gate', 'awards_points',
     '{"spend_yen": 200, "points": 1}'::jsonb, '{}'::jsonb, '[]'::jsonb,
     'https://example.invalid/other', 'other', 'catalogue_fact', '[]'::jsonb,
     '{}'::jsonb);

    -- Superseded snapshots are invisible; the newest one answers for its own
    -- artifact without hiding a different artifact's facts.
    select count(*) into v_rows
      from app_private.p0_implementation_rule_facts_at(now())
     where claim_id in ('claim.gate.rate.001', 'claim.gate.other.001');
    if v_rows <> 2 then
        raise exception 'expected exactly one row per gate claim, got %', v_rows;
    end if;

    select value into v_value
      from app_private.p0_implementation_rule_facts_at(now())
     where claim_id = 'claim.gate.rate.001';
    if v_value <> '{"spend_yen": 100, "points": 2}'::jsonb then
        raise exception 'superseded snapshot was projected: %', v_value;
    end if;

    -- A corrected fact must leave the projection entirely.
    select fact_id into v_fact
      from app_private.p0_implementation_facts
     where snapshot_id = v_new and parent_claim_id = 'claim.gate.rate.001';
    insert into app_private.p0_implementation_fact_corrections (
        correction_id, fact_id, snapshot_id, implementation_version,
        implementation_hash, parent_claim_id, fact_version, reason,
        correction_payload
    ) values (
        'corr.gate.001', v_fact, v_new, 'p0-gate-new.implementation.v1',
        'sha256:' || repeat('3', 64), 'claim.gate.rate.001', 1,
        'gate rehearsal correction', '{}'::jsonb
    );

    select count(*) into v_rows
      from app_private.p0_implementation_rule_facts_at(now())
     where claim_id = 'claim.gate.rate.001';
    if v_rows <> 0 then
        raise exception 'corrected fact remained projected';
    end if;
end
$currency$;

rollback;
