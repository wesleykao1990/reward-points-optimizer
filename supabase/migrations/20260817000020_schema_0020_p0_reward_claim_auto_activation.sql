-- Staged from db/0020_p0_reward_claim_auto_activation.sql; edit the canonical source, not this file.
-- Atomic persistence for compiler-produced structured reward claims.
--
-- The three-argument adapter from migration 0016 remains available for
-- callers that intentionally persist a candidate without activation.  This
-- four-argument overload is the host boundary used by
-- processP0RewardClaimBatch: p_activate is derived from the compiler's
-- envelope status, and persistence plus the lifecycle transition happen in
-- one locked function call.

begin;

create or replace function app_private.persist_p0_reward_claim_candidate(
    p_candidate_hash text,
    p_definition_hash text,
    p_candidate_payload jsonb,
    p_activate boolean
)
returns table (
    candidate_id uuid,
    outcome text,
    status text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_existing app_private.provisional_rule_candidates%rowtype;
    v_candidate_id uuid;
    v_outcome text;
    v_status text;
    v_occurred_at timestamptz;
begin
    if p_activate is null
       or p_candidate_hash is null
       or p_definition_hash is null
       or p_candidate_hash !~ '^sha256:[0-9a-f]{64}$'
       or p_definition_hash !~ '^sha256:[0-9a-f]{64}$'
    then
        raise exception 'P0 reward-claim candidate identity or activation intent is invalid'
            using errcode = '22023';
    end if;

    -- Match the lock order of both underlying lifecycle routines.  A replay
    -- therefore waits for the original insert/activation and observes its
    -- final status instead of manufacturing a second transition.
    perform pg_advisory_xact_lock(hashtextextended(p_candidate_hash, 0));
    select * into v_existing
      from app_private.provisional_rule_candidates as candidate
     where candidate.candidate_hash = p_candidate_hash
     for update;
    if found then
        if v_existing.definition_hash is distinct from p_definition_hash
           or v_existing.candidate_payload is distinct from p_candidate_payload
        then
            raise exception 'P0 reward-claim candidate hash was reused with different content'
                using errcode = '55000';
        end if;
        v_candidate_id := v_existing.id;
        v_outcome := 'duplicate';
    else
        v_candidate_id := app_private.persist_provisional_rule_candidate(
            p_candidate_hash,
            p_definition_hash,
            p_candidate_payload
        );
        v_outcome := 'inserted';
    end if;

    select candidate.status into v_status
      from app_private.provisional_rule_candidates as candidate
     where candidate.id = v_candidate_id;

    if p_activate then
        if v_status = 'machine_checked' then
            -- The base persistence routine records the machine-check timestamp
            -- as transition zero. Reuse that compiler-owned timestamp so the
            -- append-only history remains deterministic and monotonic.
            v_occurred_at := (
                coalesce(v_existing.candidate_payload, p_candidate_payload)
                    ->'machine_check'->>'checked_at'
            )::timestamptz;
            perform app_private.activate_provisional_rule_candidate(
                p_candidate_hash,
                v_occurred_at,
                'automatic_structured_claim_activation'
            );
            select candidate.status into v_status
              from app_private.provisional_rule_candidates as candidate
             where candidate.id = v_candidate_id;
        elsif v_status is distinct from 'active_experimental' then
            -- In particular, needs_evidence, disputed, and quarantined
            -- candidates can never be promoted by this adapter.
            raise exception 'P0 reward-claim activation requested for non-machine-checked candidate'
                using errcode = '55000';
        end if;
    end if;

    return query select v_candidate_id, v_outcome, v_status;
end;
$$;

revoke execute on function
    app_private.persist_p0_reward_claim_candidate(text,text,jsonb,boolean)
    from public;

-- The application runtime may write only through this exact compiler adapter;
-- it still has no table mutation privileges and the underlying activation
-- routine independently enforces primary-source and complete-evidence state.
grant execute on function
    app_private.persist_p0_reward_claim_candidate(text,text,jsonb,boolean)
    to jro_runtime;

comment on function app_private.persist_p0_reward_claim_candidate(text,text,jsonb,boolean) is
    'Atomic generic P0 reward-claim persistence; compiler-derived activation appends one audited active_experimental transition and exact replays return the active status.';

commit;
