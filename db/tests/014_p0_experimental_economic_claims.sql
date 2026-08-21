-- Fail-closed checks for the internal under-review economic-claim projection.

begin;

do $test$
declare
    v_count integer;
    v_bad integer;
    v_options text[];
begin
    select count(*) into v_count
      from app_api.experimental_economic_claims;
    if v_count < 1 then
        raise exception 'expected seeded evidence-backed economic claims';
    end if;

    select count(*) into v_bad
      from app_api.experimental_economic_claims
     where display_status is distinct from 'under_review'
        or evidence_reviewed_at is null
        or normalized_claim is null
        or jsonb_typeof(normalized_claim) <> 'object'
        or jsonb_typeof(supported_paths) <> 'array';
    if v_bad <> 0 then
        raise exception 'experimental economic projection contains an unsafe or incomplete row';
    end if;

    if exists (
        select 1
          from app_api.experimental_economic_claims as claim
          join app_private.reward_rules as rule
            on rule.rule_key = claim.rule_key
          join app_private.reward_rule_versions as version
            on version.id = claim.rule_version_id
          join app_private.evidence_records as evidence
            on evidence.evidence_key = claim.evidence_key
         where rule.lifecycle_status <> 'under_review'
            or version.review_status <> 'under_review'
            or version.superseded_at is not null
            or evidence.status <> 'verified'
    ) then
        raise exception 'experimental economic projection escaped review-state constraints';
    end if;

    select c.reloptions into v_options
      from pg_class as c
      join pg_namespace as n on n.oid = c.relnamespace
     where n.nspname = 'app_api'
       and c.relname = 'experimental_economic_claims';
    if not ('security_invoker=true' = any(v_options))
       or not ('security_barrier=true' = any(v_options)) then
        raise exception 'experimental economic projection must be invoker and barrier protected';
    end if;

    if has_table_privilege('public', 'app_api.experimental_economic_claims', 'select') then
        raise exception 'PUBLIC must not read experimental economic claims';
    end if;
end
$test$;

rollback;
