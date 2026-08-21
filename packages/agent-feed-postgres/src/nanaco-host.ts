import {
  createNanacoEconomicPilot,
  createProvisionalRuleStore,
  type NanacoCanonicalEvidenceLookup,
  type NanacoEconomicPilotRoute,
} from "@jro/provisional-rules";
import type {
  PoolClient,
  QueryClient,
  QueryPool,
  QueryTarget,
} from "./adapter.js";

const NANACO_RULE_KEY = "rr_jp_cvs_006_nanaco_purchase_reward" as const;
const NANACO_RULE_VERSION = 1 as const;
const NANACO_DEFINITION_HASH =
  "sha256:9f8cb5de0af689ee8ca751a3ae6a34c2d974eb1c79c29c60bd555da4db116746" as const;

/**
 * The only database fact exposed to the sealed route is whether the exact
 * observation/evidence/source binding has passed the Rewards-owned trust
 * boundary. Caller values occupy the first three query parameters; the sealed
 * rule identity occupies the final three parameters.
 */
export const NANACO_CANONICAL_EVIDENCE_QUERY = `
select exists (
    select 1
      from app_private.source_observations as observation
      join app_private.source_observation_submitted_evidence as submitted
        on submitted.observation_id = observation.id
      join app_private.source_observation_evidence_work as work
        on work.observation_id = observation.id
       and work.agent_feed_evidence_id = submitted.agent_feed_evidence_id
       and work.work_status = 'promoted'
      join app_private.evidence_records as evidence
        on evidence.id = work.evidence_id
       and evidence.id = submitted.promoted_evidence_id
      join app_private.source_snapshots as snapshot
        on snapshot.id = evidence.source_snapshot_id
       and snapshot.id = work.source_snapshot_id
      join app_private.trusted_sources as source
        on source.id = snapshot.source_id
      join app_private.rule_evidence as rule_evidence
        on rule_evidence.evidence_id = evidence.id
      join app_private.reward_rule_versions as rule_version
        on rule_version.id = rule_evidence.rule_version_id
      join app_private.reward_rules as rule
        on rule.id = rule_version.rule_id
     where observation.observation_key = $1::text
       and observation.source_ids = jsonb_build_array($3::text)
       and observation.canonical_evidence_ids = jsonb_build_array($2::text)
       and jsonb_array_length(observation.submitted_evidence_refs) > 0
       and observation.submitted_evidence_refs @> jsonb_build_array(submitted.agent_feed_evidence_id)
       and observation.status = 'needs_review'
       and observation.trust_state = 'canonical_reviewed'
       and observation.security_flags = '[]'::jsonb
       and submitted.promotion_status = 'promoted'
       and work.evidence_id is not null
       and evidence.evidence_key = $2::text
       and evidence.status = 'verified'
       and evidence.review_mode is not null
       and evidence.reviewed_by is not null
       and evidence.reviewed_at is not null
       and evidence.required_review_modes <@ evidence.completed_review_modes
       and source.source_key = $3::text
       and source.verification_status = 'content_verified'
       and source.publication_use <> 'discovery_only'
       and rule_evidence.evidence_id = evidence.id
       and rule.rule_key = $4::text
       and rule.lifecycle_status = 'under_review'
       and rule_version.version = $5::integer
       and rule_version.definition_hash = $6::text
       and rule_version.review_status = 'under_review'
       and rule_version.superseded_at is null
) as eligible
`;

type NanacoEvidenceResultRow = {
  readonly eligible?: unknown;
};

function isQueryPool(target: QueryTarget): target is QueryPool {
  return "connect" in target && typeof target.connect === "function";
}

function asLookupError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("nanaco_canonical_evidence_lookup_failed");
}

async function verifyCanonicalEvidence(
  target: QueryTarget,
  lookup: NanacoCanonicalEvidenceLookup,
): Promise<boolean> {
  let client: PoolClient | QueryClient = target;
  let release: ((error?: Error) => void) | undefined;
  let failure: Error | undefined;

  try {
    if (isQueryPool(target)) {
      const checkedOut = await target.connect();
      client = checkedOut;
      release = checkedOut.release;
    }

    const result = await client.query<NanacoEvidenceResultRow>(
      NANACO_CANONICAL_EVIDENCE_QUERY,
      [
        lookup.observation_id,
        lookup.evidence_id,
        lookup.source_id,
        NANACO_RULE_KEY,
        NANACO_RULE_VERSION,
        NANACO_DEFINITION_HASH,
      ],
    );
    if (
      !Array.isArray(result.rows) ||
      result.rows.length !== 1 ||
      result.rows[0] === undefined
    ) {
      throw new Error("nanaco_canonical_evidence_lookup_malformed_result");
    }
    const row = result.rows[0];
    if (
      row === null ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).length !== 1 ||
      !Object.hasOwn(row, "eligible") ||
      typeof row.eligible !== "boolean"
    ) {
      throw new Error("nanaco_canonical_evidence_lookup_malformed_result");
    }
    return row.eligible;
  } catch (error) {
    failure = asLookupError(error);
    return false;
  } finally {
    if (release !== undefined) {
      try {
        if (failure === undefined) release();
        else release(failure);
      } catch {
        // Lookup failures are fail-closed; pool release diagnostics stay local.
      }
    }
  }
}

/**
 * Construct the trusted host for the sealed nanaco economic pilot. The
 * process-local store and DB-backed verifier remain private; callers receive
 * only the route's admit/activate capabilities.
 */
export function createPostgresNanacoEconomicPilotHost(
  target: QueryTarget,
): NanacoEconomicPilotRoute {
  const store = createProvisionalRuleStore();
  const verifier = (lookup: NanacoCanonicalEvidenceLookup): Promise<boolean> =>
    verifyCanonicalEvidence(target, lookup);
  return createNanacoEconomicPilot(store, verifier);
}
