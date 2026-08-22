-- Staged from db/0009_p0_experimental_economic_claims.sql; edit the canonical source, not this file.
-- Internal app projection for evidence-backed, under-review economic claims.
--
-- This does not publish a reward rule. It gives an explicitly privileged app
-- server a bounded read surface over already verified evidence that remains
-- attached to an under-review rule version. Untrusted Agent Feed observations
-- do not enter this view until they pass the normal evidence/rule gates.

begin;

create view app_api.experimental_economic_claims
with (security_invoker = true, security_barrier = true) as
select
    rr.rule_key,
    rr.rule_type,
    rr.name as rule_name,
    rrv.id as rule_version_id,
    rrv.version as rule_version,
    rrv.definition_hash,
    rrv.valid_from,
    rrv.valid_to,
    er.evidence_key,
    er.normalized_claim,
    re.supported_paths,
    er.review_mode as evidence_review_mode,
    er.reviewed_at as evidence_reviewed_at,
    ts.source_key,
    ts.name as source_name,
    ts.publisher as source_publisher,
    'under_review'::text as display_status
from app_private.reward_rules as rr
join app_private.reward_rule_versions as rrv
  on rrv.rule_id = rr.id
join app_private.rule_evidence as re
  on re.rule_version_id = rrv.id
join app_private.evidence_records as er
  on er.id = re.evidence_id
join app_private.source_snapshots as ss
  on ss.id = er.source_snapshot_id
join app_private.trusted_sources as ts
  on ts.id = ss.source_id
where rr.lifecycle_status = 'under_review'
  and rrv.review_status = 'under_review'
  and rrv.superseded_at is null
  and er.status = 'verified'
  and ts.verification_status = 'content_verified'
  and ts.publication_use <> 'discovery_only';

comment on view app_api.experimental_economic_claims is
    'Internal evidence-backed economic claims for prototype display only; rows remain under review and are not approved recommendation rules.';

revoke all on app_api.experimental_economic_claims from public;

commit;
