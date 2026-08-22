\set ON_ERROR_STOP on

begin;

do $test$
declare
    v_candidate jsonb;
    v_malformed jsonb;
    v_out record;
    v_candidate_hash text := 'sha256:' || repeat('e', 64);
    v_definition_hash text := 'sha256:' || repeat('f', 64);
    v_inserted boolean;
    v_rules_before integer;
    v_versions_before integer;
    v_evidence_before integer;
    v_publications_before integer;
begin
    -- Reuse a current, already-admitted SourceObservation from the durable
    -- local rehearsal.  Only the candidate identity is changed; all source,
    -- authority, status, and candidate-shape material remains host-owned.
    select candidate_payload into strict v_candidate
      from app_private.provisional_rule_candidates
     where candidate_hash =
           'sha256:f931acf332c5432cca86af671798fe321353d11e49490d61e45b4df458e250bb';
    v_candidate := jsonb_set(
        v_candidate,
        '{candidate_id}',
        to_jsonb('candidate_p0_generic_reward_claim_001'::text),
        false
    );

    select count(*) into v_rules_before from app_private.reward_rules;
    select count(*) into v_versions_before from app_private.reward_rule_versions;
    select count(*) into v_evidence_before from app_private.evidence_records;
    select count(*) into v_publications_before
      from app_private.rule_publication_requests;

    if has_function_privilege(
           'public',
           'app_private.persist_p0_reward_claim_candidate(text,text,jsonb)',
           'execute'
       ) then
        raise exception 'generic reward-claim persistence wrapper is PUBLIC executable';
    end if;

    execute 'create role p0_reward_claim_adapter_test noinherit';
    execute 'grant usage on schema app_private to p0_reward_claim_adapter_test';
    execute 'grant execute on function app_private.persist_p0_reward_claim_candidate(text,text,jsonb) to p0_reward_claim_adapter_test';
    execute 'set local role p0_reward_claim_adapter_test';

    if has_table_privilege(
           current_user,
           'app_private.provisional_rule_candidates',
           'select'
       )
    then
        raise exception 'adapter role unexpectedly has candidate table SELECT';
    end if;
    begin
        execute 'select 1 from app_private.provisional_rule_candidates limit 1';
        raise exception 'execute-only adapter role can read candidate table';
    exception when insufficient_privilege then
        null;
    end;

    select * into strict v_out
      from app_private.persist_p0_reward_claim_candidate(
          v_candidate_hash,
          v_definition_hash,
          v_candidate
      );
    if v_out.outcome is distinct from 'inserted'
       or v_out.status is distinct from 'machine_checked'
       or v_out.candidate_id is null
    then
        raise exception 'valid generic reward claim was not inserted as machine_checked';
    end if;

    select * into strict v_out
      from app_private.persist_p0_reward_claim_candidate(
          v_candidate_hash,
          v_definition_hash,
          v_candidate
      );
    if v_out.outcome is distinct from 'duplicate'
       or v_out.status is distinct from 'machine_checked'
    then
        raise exception 'exact generic reward-claim replay was not duplicate';
    end if;

    begin
        perform app_private.persist_p0_reward_claim_candidate(
            v_candidate_hash,
            'sha256:' || repeat('d', 64),
            v_candidate
        );
        raise exception 'candidate hash reuse with a different definition succeeded';
    exception when sqlstate '55000' then
        null;
    end;

    v_malformed := v_candidate ||
        jsonb_build_object('required_source_role', 'primary');
    begin
        perform app_private.persist_p0_reward_claim_candidate(
            'sha256:' || repeat('1', 64),
            v_definition_hash,
            v_malformed
        );
        raise exception 'malformed legacy candidate shape succeeded';
    exception when sqlstate '22023' then
        null;
    end;

    v_malformed := jsonb_set(
        v_candidate,
        '{rule,status}',
        '"approved"'::jsonb,
        false
    );
    begin
        perform app_private.persist_p0_reward_claim_candidate(
            'sha256:' || repeat('2', 64),
            v_definition_hash,
            v_malformed
        );
        raise exception 'published rule candidate shape succeeded';
    exception when sqlstate '22023' then
        null;
    end;

    v_malformed := jsonb_set(
        v_candidate,
        '{rule,provenance,human_verified}',
        'true'::jsonb,
        false
    );
    begin
        perform app_private.persist_p0_reward_claim_candidate(
            'sha256:' || repeat('3', 64),
            v_definition_hash,
            v_malformed
        );
        raise exception 'human-verified review claim shape succeeded';
    exception when sqlstate '22023' then
        null;
    end;

    -- A candidate insert remains transactionally provisional.  The nested
    -- exception block rolls back this one insert, while the outer test keeps
    -- the durable database unchanged as well.
    v_inserted := false;
    begin
        perform app_private.persist_p0_reward_claim_candidate(
            'sha256:' || repeat('4', 64),
            v_definition_hash,
            v_candidate
        );
        v_inserted := true;
        raise exception 'force generic reward-claim transaction rollback';
    exception when others then
        if not v_inserted then
            raise;
        end if;
    end;
    execute 'reset role';
    if exists (
        select 1
          from app_private.provisional_rule_candidates
         where candidate_hash = 'sha256:' || repeat('4', 64)
    ) then
        raise exception 'rolled-back generic reward-claim candidate remained persisted';
    end if;

    execute 'revoke execute on function app_private.persist_p0_reward_claim_candidate(text,text,jsonb) from p0_reward_claim_adapter_test';
    execute 'revoke usage on schema app_private from p0_reward_claim_adapter_test';
    execute 'drop role p0_reward_claim_adapter_test';

    if (select count(*) from app_private.reward_rules) <> v_rules_before
       or (select count(*) from app_private.reward_rule_versions) <> v_versions_before
       or (select count(*) from app_private.evidence_records) <> v_evidence_before
       or (select count(*) from app_private.rule_publication_requests) <> v_publications_before
    then
        raise exception 'generic reward-claim adapter crossed the canonical boundary';
    end if;
end
$test$;

rollback;
