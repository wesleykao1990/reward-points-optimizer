import { scanPublicValue } from "./security.js";

/** Version of the structured, non-authoritative claim projection. */
export const REWARD_CLAIM_VERSION = "reward-claim.v1" as const;

export type RewardClaimType =
  | "payment_acceptance"
  | "points_per_unit"
  | "fixed"
  | "percentage"
  | "transfer_ratio"
  | "conversion"
  | "redemption"
  | "exclusion"
  | "campaign";

export interface RewardClaimIssue {
  readonly code:
    | "input_not_object"
    | "hostile_input"
    | "document_shape_invalid"
    | "claim_shape_invalid"
    | "unknown_field"
    | "duplicate_claim_id"
    | "claim_id_invalid"
    | "claim_type_invalid";
  readonly path: string;
  readonly message: string;
  readonly claim_id?: string;
}

/**
 * The compiler intentionally keeps claim values as unknown JSON records until
 * the type-specific mapper copies them into a RewardRule.  This avoids a
 * lossy intermediate numeric representation.
 */
export interface ParsedRewardClaim {
  readonly claim_id: string;
  readonly claim_type: string;
  readonly value: Readonly<Record<string, unknown>>;
}

export interface ParsedRewardClaimDocument {
  readonly ok: boolean;
  readonly document: Readonly<Record<string, unknown>> | null;
  readonly claims: readonly ParsedRewardClaim[];
  readonly issues: readonly RewardClaimIssue[];
}

const DOCUMENT_KEYS = new Set(["version", "claims"]);

// Keep this list synchronized with reward-claim.schema.json.  The parser is
// deliberately independent of the schema validator so one unsupported claim
// does not erase valid siblings from a document.
const CLAIM_KEYS = new Set([
  "claim_id",
  "claim_type",
  "name",
  "description",
  "decision",
  "payment_family",
  "instrument_id",
  "subject",
  "scope",
  "eligibility",
  "calculation",
  "output",
  "caps",
  "expiry",
  "validity",
  "conditions",
  "campaign_id",
  "campaign_conditions",
  "source_asset",
  "destination_asset",
  "source_units",
  "destination_units",
  "minimum_source_units",
  "increment_source_units",
  "maximum_source_units_per_request",
  "maximum_source_units_per_period",
  "maximum_period",
  "fee",
  "rounding",
  "processing_time_days_min",
  "processing_time_days_max",
  "cancellation_policy",
  "reward_asset",
  "reward_units",
  "spend_jpy",
  "rate_basis_points",
  "target",
]);

const CLAIM_ID = /^[a-z0-9][a-z0-9_.:-]{2,127}$/u;

function issue(
  code: RewardClaimIssue["code"],
  path: string,
  message: string,
  claim_id?: string,
): RewardClaimIssue {
  return Object.freeze({
    code,
    path,
    message,
    ...(claim_id === undefined ? {} : { claim_id }),
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortedIssues(
  issues: readonly RewardClaimIssue[],
): readonly RewardClaimIssue[] {
  return Object.freeze(
    [...issues].sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.code.localeCompare(right.code) ||
        left.message.localeCompare(right.message),
    ),
  );
}

function syntheticClaimId(index: number): string {
  // '#' is intentionally outside CLAIM_ID so a malformed member can never
  // collide with a caller-owned claim identifier at the same array index.
  return `invalid#claim-index-${index.toString(10).padStart(6, "0")}`;
}

/**
 * Parse only the exact nested reward_claims document.  A hostile value is
 * rejected before any caller-owned getter/proxy can be dereferenced.  Shape
 * errors on individual claims are retained so callers can report a result for
 * each claim while valid siblings continue through compilation.
 */
export function parseRewardClaimDocument(
  value: unknown,
): ParsedRewardClaimDocument {
  const scanned = scanPublicValue(value);
  if (!scanned.valid)
    return Object.freeze({
      ok: false,
      document: null,
      claims: Object.freeze([]),
      issues: sortedIssues(
        scanned.issues.map((item) =>
          issue("hostile_input", item.path, item.message),
        ),
      ),
    });

  if (!record(scanned.value))
    return Object.freeze({
      ok: false,
      document: null,
      claims: Object.freeze([]),
      issues: Object.freeze([
        issue("input_not_object", "", "reward_claims must be an object"),
      ]),
    });

  const root = scanned.value;
  const rootIssues: RewardClaimIssue[] = [];
  for (const key of Object.keys(root))
    if (!DOCUMENT_KEYS.has(key))
      rootIssues.push(issue("unknown_field", `/${key}`, "unknown field"));
  if (root.version !== REWARD_CLAIM_VERSION)
    rootIssues.push(
      issue("document_shape_invalid", "/version", "unsupported claim version"),
    );
  if (!Array.isArray(root.claims))
    rootIssues.push(
      issue("document_shape_invalid", "/claims", "claims must be an array"),
    );
  if (rootIssues.length > 0 || !Array.isArray(root.claims))
    return Object.freeze({
      ok: false,
      document: null,
      claims: Object.freeze([]),
      issues: sortedIssues(rootIssues),
    });

  const claims: ParsedRewardClaim[] = [];
  const issues: RewardClaimIssue[] = [];
  const seen = new Set<string>();
  root.claims.forEach((rawClaim, index) => {
    const path = `/claims/${index}`;
    const syntheticId = syntheticClaimId(index);
    if (!record(rawClaim)) {
      issues.push(
        issue(
          "claim_shape_invalid",
          path,
          "claim must be an object",
          syntheticId,
        ),
      );
      claims.push(
        Object.freeze({
          claim_id: syntheticId,
          claim_type: "invalid",
          value: Object.freeze({
            claim_id: syntheticId,
            claim_type: "invalid",
          }),
        }),
      );
      return;
    }
    const valueRecord = rawClaim;
    const claimId = valueRecord.claim_id;
    const validClaimId = typeof claimId === "string" && CLAIM_ID.test(claimId);
    const memberClaimId = validClaimId ? claimId : syntheticId;
    const claimIdText = memberClaimId;
    for (const key of Object.keys(valueRecord)) {
      if (!CLAIM_KEYS.has(key)) {
        issues.push(
          issue(
            "unknown_field",
            `${path}/${key}`,
            "unknown field",
            claimIdText,
          ),
        );
      }
    }
    if (!validClaimId) {
      issues.push(
        issue(
          "claim_id_invalid",
          `${path}/claim_id`,
          "claim_id must be a 3-128 character identifier",
          memberClaimId,
        ),
      );
    } else if (seen.has(memberClaimId)) {
      issues.push(
        issue(
          "duplicate_claim_id",
          `${path}/claim_id`,
          "claim_id must be unique within the document",
          memberClaimId,
        ),
      );
    } else seen.add(memberClaimId);

    const claimType = valueRecord.claim_type;
    if (typeof claimType !== "string" || claimType.length === 0) {
      issues.push(
        issue(
          "claim_type_invalid",
          `${path}/claim_type`,
          "claim_type must be a non-empty string",
          memberClaimId,
        ),
      );
    }
    const parsedValue = Object.freeze({
      ...valueRecord,
      ...(validClaimId ? {} : { claim_id: memberClaimId }),
      ...(typeof claimType === "string" ? {} : { claim_type: "invalid" }),
    });
    claims.push(
      Object.freeze({
        claim_id: memberClaimId,
        claim_type: typeof claimType === "string" ? claimType : "invalid",
        value: parsedValue,
      }),
    );
  });

  return Object.freeze({
    ok: true,
    document: Object.freeze(root),
    claims: Object.freeze(claims),
    issues: sortedIssues(issues),
  });
}

export function isRewardClaimDocument(value: unknown): value is {
  readonly version: typeof REWARD_CLAIM_VERSION;
  readonly claims: readonly Record<string, unknown>[];
} {
  const parsed = parseRewardClaimDocument(value);
  return parsed.ok && parsed.issues.length === 0;
}
