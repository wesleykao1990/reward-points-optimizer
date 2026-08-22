-- Staged from db/0016_p0_generic_reward_claim_persistence.sql; edit the canonical source, not this file.
-- Generic P0 reward-claim candidate persistence adapter.
--
-- This wrapper is deliberately narrower than a table grant.  The host adapter
-- receives only EXECUTE on this SECURITY DEFINER routine; the existing
-- provisional candidate routine remains the sole shape, source-observation,
-- and lifecycle gate.  No canonical rule, evidence, or publication row is
-- created here.

begin;

create or replace function app_private.persist_p0_reward_claim_candidate(
    p_candidate_hash text,
    p_definition_hash text,
    p_candidate_payload jsonb
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
    v_status text;
begin
    if p_candidate_hash is null
       or p_definition_hash is null
       or p_candidate_hash !~ '^sha256:[0-9a-f]{64}$'
       or p_definition_hash !~ '^sha256:[0-9a-f]{64}$'
    then
        raise exception 'P0 reward-claim candidate identity is invalid'
            using errcode = '22023';
    end if;

    -- Match the lock order of the underlying routine: the candidate advisory
    -- lock always precedes the duplicate row lock.  This also makes the
    -- preflight duplicate/result classification race-free for adapter roles
    -- that cannot read the private relation directly.
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
        return query select v_existing.id, 'duplicate'::text, v_existing.status;
        return;
    end if;

    v_candidate_id := app_private.persist_provisional_rule_candidate(
        p_candidate_hash,
        p_definition_hash,
        p_candidate_payload
    );
    select candidate.status into v_status
      from app_private.provisional_rule_candidates as candidate
     where candidate.id = v_candidate_id;
    return query select v_candidate_id, 'inserted'::text, v_status;
end;
$$;

revoke execute on function app_private.persist_p0_reward_claim_candidate(text,text,jsonb)
    from public;

comment on function app_private.persist_p0_reward_claim_candidate(text,text,jsonb) is
    'Generic P0 reward-claim adapter; persists only provisional candidates and never publishes canonical rules or evidence.';

commit;
