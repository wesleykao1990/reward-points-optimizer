\set ON_ERROR_STOP on

begin;

do $privileges$
begin
    if has_function_privilege(
        'public',
        'app_private.persist_p0_reward_claim_candidate(text,text,jsonb,boolean)',
        'execute'
    ) then
        raise exception 'public can execute reward-claim auto-activation';
    end if;
    if not has_function_privilege(
        'jro_runtime',
        'app_private.persist_p0_reward_claim_candidate(text,text,jsonb,boolean)',
        'execute'
    ) then
        raise exception 'runtime cannot execute reward-claim auto-activation';
    end if;
end
$privileges$;

do $test$
declare
    v_candidate jsonb;
    v_out record;
    v_hash text := 'sha256:' || repeat('a', 64);
    v_definition_hash text := 'sha256:' || repeat('b', 64);
    v_sequence_before integer;
    v_sequence_after integer;
begin
    -- The rehearsal candidate is already bound to a complete primary
    -- SourceObservation.  A new hash/candidate ID exercises the insert path
    -- without adding durable fixture data to the seed.
    select candidate_payload into strict v_candidate
      from app_private.provisional_rule_candidates
     where candidate_hash =
           'sha256:f931acf332c5432cca86af671798fe321353d11e49490d61e45b4df458e250bb';
    v_candidate := jsonb_set(
        v_candidate,
        '{candidate_id}',
        to_jsonb('candidate_p0_reward_claim_auto_activation_test'::text),
        false
    );

    select * into strict v_out
      from app_private.persist_p0_reward_claim_candidate(
          v_hash,
          v_definition_hash,
          v_candidate,
          true
      );
    if v_out.outcome is distinct from 'inserted'
       or v_out.status is distinct from 'active_experimental'
       or v_out.candidate_id is null
    then
        raise exception 'complete primary reward candidate was not atomically activated';
    end if;

    select max(sequence) into strict v_sequence_before
      from app_private.provisional_rule_transitions
     where candidate_id = v_out.candidate_id;
    if v_sequence_before <> 1 then
        raise exception 'automatic activation did not append one audited transition';
    end if;

    select * into strict v_out
      from app_private.persist_p0_reward_claim_candidate(
          v_hash,
          v_definition_hash,
          v_candidate,
          true
      );
    if v_out.outcome is distinct from 'duplicate'
       or v_out.status is distinct from 'active_experimental'
    then
        raise exception 'exact reward candidate replay did not return active_experimental';
    end if;

    select max(sequence) into strict v_sequence_after
      from app_private.provisional_rule_transitions
     where candidate_id = v_out.candidate_id;
    if v_sequence_after <> v_sequence_before then
        raise exception 'idempotent reward candidate replay appended a duplicate transition';
    end if;

    begin
        perform app_private.persist_p0_reward_claim_candidate(
            'sha256:' || repeat('c', 64),
            v_definition_hash,
            v_candidate || jsonb_build_object('prose', 'not a structured claim'),
            true
        );
        raise exception 'malformed reward candidate was activated';
    exception when sqlstate '22023' then
        null;
    end;
end
$test$;

rollback;
