\set ON_ERROR_STOP on

begin;

do $privileges$
begin
    if has_function_privilege(
           'public',
           'app_private.active_reward_claim_calculations_at(timestamptz)',
           'execute'
       ) then
        raise exception 'active reward-claim projection is PUBLIC executable';
    end if;
    if not has_function_privilege(
           'jro_runtime',
           'app_private.active_reward_claim_calculations_at(timestamptz)',
           'execute'
       ) then
        raise exception 'runtime cannot execute active reward-claim projection';
    end if;
    if has_table_privilege(
           'jro_runtime',
           'app_private.source_observation_submitted_evidence',
           'select'
       ) then
        raise exception 'runtime received direct submitted-evidence SELECT';
    end if;
end
$privileges$;

do $fixture$
declare
    v_base jsonb;
    v_candidate_a jsonb;
    v_candidate_b jsonb;
    v_definition_hash text;
    v_out record;
begin
    -- Reuse the durable lead-only SourceObservation and its valid submitted
    -- evidence. The two identities deliberately use different family/role
    -- tuples to prove this projection is dynamic rather than an ID allowlist.
    select candidate_payload, definition_hash
      into strict v_base, v_definition_hash
      from app_private.provisional_rule_candidates
     where candidate_hash =
           'sha256:f931acf332c5432cca86af671798fe321353d11e49490d61e45b4df458e250bb';

    v_candidate_a := jsonb_set(
        v_base,
        '{candidate_id}',
        to_jsonb('candidate_p0_active_reward_claim_a'::text),
        false
    );
    v_candidate_a := jsonb_set(
        v_candidate_a,
        '{p0_family_id}',
        to_jsonb('dynamic.family.a'::text),
        false
    );
    v_candidate_a := jsonb_set(
        v_candidate_a,
        '{source_role_id}',
        to_jsonb('base_reward_rules'::text),
        false
    );
    v_candidate_a := jsonb_set(
        v_candidate_a,
        '{extractor}',
        jsonb_build_object('name', 'reward-claim-compiler', 'version', '1'),
        false
    );
    v_candidate_a := jsonb_set(
        v_candidate_a,
        '{machine_check}',
        jsonb_build_object(
            'checker', 'reward-claim-compiler',
            'checker_version', '1',
            'checked_at', '2026-08-21T00:03:00Z',
            'checks', jsonb_build_object(
                'representation_safe', true,
                'rule_structure', true,
                'rule_semantics', true,
                'observation_binding', true,
                'p0_coverage', true
            )
        ),
        false
    );
    v_candidate_a := jsonb_set(
        v_candidate_a,
        '{rule,validity,valid_to}',
        to_jsonb('2026-08-22T00:00:00Z'::text),
        false
    );

    v_candidate_b := jsonb_set(
        v_candidate_a,
        '{candidate_id}',
        to_jsonb('candidate_p0_active_reward_claim_b'::text),
        false
    );
    v_candidate_b := jsonb_set(
        v_candidate_b,
        '{p0_family_id}',
        to_jsonb('dynamic.family.b'::text),
        false
    );
    v_candidate_b := jsonb_set(
        v_candidate_b,
        '{source_role_id}',
        to_jsonb('campaign_rules'::text),
        false
    );

    select * into strict v_out
      from app_private.persist_p0_reward_claim_candidate(
          'sha256:' || repeat('a', 64),
          v_definition_hash,
          v_candidate_a,
          true
      );
    if v_out.status is distinct from 'active_experimental' then
        raise exception 'generic reward candidate A was not activated';
    end if;

    select * into strict v_out
      from app_private.persist_p0_reward_claim_candidate(
          'sha256:' || repeat('b', 64),
          v_definition_hash,
          v_candidate_b,
          true
      );
    if v_out.status is distinct from 'active_experimental' then
        raise exception 'generic reward candidate B was not activated';
    end if;

end
$fixture$;

-- Public callers are denied while the runtime role can execute only the
-- constrained function. The function itself runs with the owner rights needed
-- by the security-invoker active view and private observation join.
set local role jro_runtime;

do $runtime_projection$
declare
    v_rows integer;
    v_families text[];
    v_url text;
    v_checked_at text;
    v_observation jsonb;
begin
    select count(*), array_agg(p0_family_id order by p0_family_id)
      into strict v_rows, v_families
      from app_private.active_reward_claim_calculations_at(
          '2026-08-21T12:00:00Z'::timestamptz
      );
    if v_rows <> 2
       or v_families is distinct from array['dynamic.family.a','dynamic.family.b']::text[]
    then
        raise exception 'active compiler projection did not discover dynamic family/role rows';
    end if;

    select source_url, checked_at, observation
      into strict v_url, v_checked_at, v_observation
      from app_private.active_reward_claim_calculations_at(
          '2026-08-21T12:00:00Z'::timestamptz
      )
     where p0_family_id = 'dynamic.family.a';
    if v_url is distinct from 'https://www.sej.co.jp/services/cash.html'
       or v_checked_at is distinct from '2026-08-20T03:13:10+09:00'
       or v_observation->>'observation_id' is distinct from 'so_finding_jp_cvs_002_payment_acceptance_001_27170bd69424f4e0'
       or jsonb_typeof(v_observation->'raw_attributes') is distinct from 'object'
    then
        raise exception 'active compiler projection provenance or canonical observation is incomplete';
    end if;

    select count(*) into strict v_rows
      from app_private.active_reward_claim_calculations_at(
          '2026-08-23T00:00:00Z'::timestamptz
      );
    if v_rows <> 0 then
        raise exception 'expired generic reward candidates remained visible';
    end if;
end
$runtime_projection$;

reset role;

do $rejected_evidence$
declare
    v_rows integer;
    v_observation_id uuid;
begin
    select id into strict v_observation_id
      from app_private.source_observations
     where observation_key = 'so_finding_jp_cvs_002_payment_acceptance_001_27170bd69424f4e0';

    -- A rejected submitted lead excludes every candidate bound to that
    -- observation, even though the lifecycle candidate remains active.
    update app_private.source_observation_submitted_evidence
       set promotion_status = 'rejected'
     where observation_id = v_observation_id;
    select count(*) into strict v_rows
      from app_private.active_reward_claim_calculations_at(
          '2026-08-21T12:00:00Z'::timestamptz
      );
    if v_rows <> 0 then
        raise exception 'rejected submitted evidence remained visible';
    end if;
end
$rejected_evidence$;

rollback;
