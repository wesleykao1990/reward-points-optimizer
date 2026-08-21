\set ON_ERROR_STOP on

begin;

do $$
declare
    v_candidate app_private.provisional_rule_candidates%rowtype;
    v_rules_before integer;
    v_versions_before integer;
begin
    select count(*) into v_rules_before from app_private.reward_rules;
    select count(*) into v_versions_before from app_private.reward_rule_versions;
    select * into strict v_candidate
      from app_private.provisional_rule_candidates
     where candidate_hash = 'sha256:05c33d3f208f425b511bb90ef71a6a22e1f45973c23b1997f9f9a316a7fbff07';

    if v_candidate.definition_hash is distinct from
         'sha256:9f8cb5de0af689ee8ca751a3ae6a34c2d974eb1c79c29c60bd555da4db116746'
       or v_candidate.status is distinct from 'active_experimental'
       or v_candidate.candidate_payload->'rule'->>'rule_id' is distinct from
          'rr_jp_cvs_006_nanaco_purchase_reward'
       or v_candidate.candidate_payload->'rule'->'provenance'->>'human_verified'
          is distinct from 'false'
    then
        raise exception 'seeded Nanaco experimental candidate identity drifted';
    end if;

    if exists (
        select 1
          from app_api.p0_unverified_experimental_catalogue_at(
               '2026-08-20T05:38:59+09:00'
          ) as row
         where row.candidate_hash = v_candidate.candidate_hash
    ) or not exists (
        select 1
          from app_api.p0_unverified_experimental_catalogue_at(
               '2026-08-22T00:00:00+09:00'
          ) as row
         where row.candidate_hash = v_candidate.candidate_hash
    ) then
        raise exception 'seeded Nanaco candidate violated half-open validity';
    end if;

    if not exists (
        select 1
          from app_api.p0_unverified_experimental_catalogue_at(
               '2026-08-22T00:00:00+09:00'
          ) as row
         where row.candidate_payload->'rule'->>'rule_id' =
               'rr_p0_seveneleven_accept_nanaco'
    ) then
        raise exception 'Nanaco recommendation lacks the independent acceptance candidate';
    end if;

    if (select count(*) from app_private.reward_rules) <> v_rules_before
       or (select count(*) from app_private.reward_rule_versions) <> v_versions_before
    then
        raise exception 'experimental seed mutated canonical rule tables';
    end if;
end
$$;

rollback;
