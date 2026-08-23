import type {
  ImplementationFactCard,
  ImplementationFactCatalogueSnapshot,
} from "./contracts.js";

const WALLET_CLAIM_TYPES = new Set([
  "expiry_rule",
  "expiry_and_reward_classes",
  "expiry_and_redemption_priority",
  "campaign_expiry",
  "redemption_rule",
  "redemption_value",
  "redemption_priority",
]);

const MERCHANT_CLAIM_TYPES = new Set([
  "merchant_acceptance",
  "merchant_bonus",
  "campaign_rule",
  "campaign_period",
  "campaign_cap",
]);

const MAX_GROUPS = 64;
const MAX_FACTS_PER_GROUP = 64;

export type ConsumerReferenceValidityState =
  | "active"
  | "scheduled"
  | "expired"
  | "unknown";

export interface ConsumerReferenceFact {
  readonly fact_key: string;
  readonly claim_type: string;
  readonly claim: string;
  readonly subject: string;
  readonly predicate: string;
  readonly summary: string;
  readonly source_url: string | null;
  readonly checked_at: string | null;
  readonly effective_from: string | null;
  readonly effective_to: string | null;
  readonly validity_state: ConsumerReferenceValidityState;
  readonly logic_role:
    | "wallet_validity"
    | "wallet_redemption"
    | "merchant_eligibility"
    | "campaign_condition";
}

export interface ConsumerReferenceGroup {
  readonly family_id: string;
  readonly label: string;
  readonly facts: readonly ConsumerReferenceFact[];
}

export interface ConsumerReferenceSnapshot {
  readonly version: "consumer-reference.v1";
  readonly status: "ready" | "partial";
  readonly automatic_application: true;
  readonly manual_promotion_required: false;
  readonly updated_at: string | null;
  readonly effective_at: string;
  readonly coverage: {
    readonly wallet_program_count: number;
    readonly merchant_count: number;
    readonly fact_count: number;
  };
  readonly wallet_programs: readonly ConsumerReferenceGroup[];
  readonly merchants: readonly ConsumerReferenceGroup[];
}

function timestamp(value: string, endOfDate = false): number | null {
  const normalized =
    endOfDate && /^\d{4}-\d{2}-\d{2}$/u.test(value)
      ? `${value}T23:59:59.999Z`
      : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function validityState(
  fact: ImplementationFactCard,
  effectiveAt: number,
): ConsumerReferenceValidityState {
  const from =
    fact.effective_from === null ? null : timestamp(fact.effective_from);
  const to =
    fact.effective_to === null ? null : timestamp(fact.effective_to, true);
  if (
    (fact.effective_from !== null && from === null) ||
    (fact.effective_to !== null && to === null)
  )
    return "unknown";
  if (from !== null && effectiveAt < from) return "scheduled";
  if (to !== null && effectiveAt > to) return "expired";
  return "active";
}

function browserFact(
  fact: ImplementationFactCard,
  effectiveAt: number,
): ConsumerReferenceFact {
  return Object.freeze({
    fact_key: fact.fact_key,
    claim_type: fact.claim_type,
    claim: fact.claim,
    subject: fact.subject,
    predicate: fact.predicate,
    summary: fact.summary,
    source_url: fact.source_url,
    checked_at: fact.checked_at,
    effective_from: fact.effective_from,
    effective_to: fact.effective_to,
    validity_state: validityState(fact, effectiveAt),
    logic_role: fact.family_id.startsWith("merchant.")
      ? fact.claim_type === "merchant_acceptance"
        ? "merchant_eligibility"
        : "campaign_condition"
      : fact.claim_type.includes("expiry")
        ? "wallet_validity"
        : "wallet_redemption",
  });
}

function groups(
  facts: readonly ImplementationFactCard[],
  familyPrefix: string,
  allowedClaimTypes: ReadonlySet<string>,
  effectiveAt: number,
): readonly ConsumerReferenceGroup[] {
  const grouped = new Map<string, ImplementationFactCard[]>();
  for (const fact of facts) {
    if (
      !fact.family_id.startsWith(familyPrefix) ||
      !allowedClaimTypes.has(fact.claim_type)
    )
      continue;
    const existing = grouped.get(fact.family_id) ?? [];
    if (existing.length < MAX_FACTS_PER_GROUP) existing.push(fact);
    grouped.set(fact.family_id, existing);
  }
  return Object.freeze(
    [...grouped.entries()]
      .map(([familyId, familyFacts]) =>
        Object.freeze({
          family_id: familyId,
          label: familyFacts[0]?.family ?? "ポイント情報",
          facts: Object.freeze(
            familyFacts
              .map((fact) => browserFact(fact, effectiveAt))
              .sort(
                (left, right) =>
                  left.claim.localeCompare(right.claim, "ja") ||
                  left.fact_key.localeCompare(right.fact_key),
              ),
          ),
        }),
      )
      .sort(
        (left, right) =>
          left.label.localeCompare(right.label, "ja") ||
          left.family_id.localeCompare(right.family_id),
      )
      .slice(0, MAX_GROUPS),
  );
}

/**
 * Project browser-safe catalogue fields into the wallet/merchant domains that
 * consume them automatically. Reward arithmetic is compiled separately from
 * structured Agent Feed reward claims; this projection never guesses a rate
 * from prose.
 */
export function projectConsumerReference(
  snapshot: ImplementationFactCatalogueSnapshot,
  effectiveAt: string = new Date().toISOString(),
): ConsumerReferenceSnapshot {
  const effectiveTimestamp = timestamp(effectiveAt);
  if (effectiveTimestamp === null)
    throw new TypeError("consumer_reference_effective_at_invalid");
  const walletPrograms = groups(
    snapshot.facts,
    "point.",
    WALLET_CLAIM_TYPES,
    effectiveTimestamp,
  );
  const merchants = groups(
    snapshot.facts,
    "merchant.",
    MERCHANT_CLAIM_TYPES,
    effectiveTimestamp,
  );
  const factCount = [...walletPrograms, ...merchants].reduce(
    (total, group) => total + group.facts.length,
    0,
  );
  return Object.freeze({
    version: "consumer-reference.v1",
    status: snapshot.status,
    automatic_application: true,
    manual_promotion_required: false,
    updated_at: snapshot.updated_at,
    effective_at: new Date(effectiveTimestamp).toISOString(),
    coverage: Object.freeze({
      wallet_program_count: walletPrograms.length,
      merchant_count: merchants.length,
      fact_count: factCount,
    }),
    wallet_programs: walletPrograms,
    merchants,
  });
}
