import type { QueryTarget } from "@jro/agent-feed-postgres";
import {
  isCanonicalProductFamilyId,
  type MerchantAcceptancePort,
  type MerchantAcceptanceQuery,
} from "./contracts.js";

export const MERCHANT_ACCEPTANCE_CURRENT_QUERY = `
select instrument_key, action, acceptance_state, scope, location_key
  from app_api.merchant_acceptance_current
 where merchant_key = $1::text
   and action in ('pay', 'redeem')
   and (scope = 'chain_default' or location_key = $2::text)
 order by case when scope = 'branch' then 0 else 1 end,
          instrument_key asc, action asc
 limit 257
`;

const MAX_ACCEPTANCE_ROWS = 256;
const SAFE_ENTITY_KEY = /^(?:instrument|program)\.[a-z0-9][a-z0-9._-]{0,126}$/u;
const SAFE_LOCATION_KEY = /^location\.[a-z0-9][a-z0-9._-]{0,118}$/u;

interface AcceptanceRow {
  readonly instrument_key: string;
  readonly action: "pay" | "redeem";
  readonly acceptance_state: "yes" | "no" | "unknown" | "conflicting";
  readonly scope: "chain_default" | "branch";
  readonly location_key: string | null;
}

function acceptanceRow(value: unknown): AcceptanceRow {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("merchant_acceptance_row_invalid");
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  const expected = [
    "acceptance_state",
    "action",
    "instrument_key",
    "location_key",
    "scope",
  ];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    typeof row.instrument_key !== "string" ||
    !SAFE_ENTITY_KEY.test(row.instrument_key) ||
    (row.action !== "pay" && row.action !== "redeem") ||
    !["yes", "no", "unknown", "conflicting"].includes(
      String(row.acceptance_state),
    ) ||
    (row.scope !== "chain_default" && row.scope !== "branch") ||
    (row.location_key !== null &&
      (typeof row.location_key !== "string" ||
        !SAFE_LOCATION_KEY.test(row.location_key)))
  )
    throw new TypeError("merchant_acceptance_row_invalid");
  return Object.freeze(row as unknown as AcceptanceRow);
}

const FAMILY_ENTITY_ALIASES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    "card.aupay": ["instrument.card.au-pay-card"],
    "card.paypay": ["instrument.card.paypay-card"],
    "card.rakuten": ["instrument.card.rakuten-card"],
    "card.smbc": ["instrument.card.mitsui-sumitomo-card-nl"],
    "card.view": ["instrument.card.view-card-standard"],
    "emoney.nanaco": ["instrument.jp.nanaco"],
    "storedvalue.nanaco": ["instrument.jp.nanaco"],
    "point.nanaco": ["instrument.jp.nanaco", "program.jp.nanaco"],
    "point.d": ["program.jp.dpoint"],
    "point.jre": ["program.jp.jrepoint"],
    "point.paypay": ["program.jp.paypay"],
    "point.ponta": ["program.jp.ponta"],
    "point.rakuten": ["program.jp.rakutenpoint"],
    "point.v": ["program.jp.vpoint"],
    "point.waon": ["program.jp.waonpoint"],
  });

function candidateEntityKeys(familyId: string): readonly string[] {
  const [kind, suffix] = familyId.split(".", 2);
  if (!kind || !suffix) return Object.freeze([]);
  const aliases = FAMILY_ENTITY_ALIASES[familyId] ?? [];
  if (kind === "card")
    return Object.freeze([
      `instrument.card.${suffix}`,
      ...aliases,
      "instrument.payment.credit_card_general",
      "instrument.payment.cashless_generic",
    ]);
  if (kind === "wallet")
    return Object.freeze([
      `instrument.wallet.${suffix}`,
      ...aliases,
      "instrument.wallet.barcode_generic",
      "instrument.payment.cashless_generic",
    ]);
  if (kind === "emoney" || kind === "storedvalue")
    return Object.freeze([
      `instrument.emoney.${suffix}`,
      ...aliases,
      "instrument.payment.emoney_generic",
      "instrument.payment.ic_generic",
      "instrument.payment.cashless_generic",
    ]);
  if (kind === "point") return Object.freeze([...aliases]);
  return Object.freeze([]);
}

function rowAppliesToFamily(row: AcceptanceRow, familyId: string): boolean {
  if (!candidateEntityKeys(familyId).includes(row.instrument_key)) return false;
  return row.instrument_key.startsWith("program.")
    ? row.action === "redeem"
    : row.action === "pay";
}

/**
 * Resolve selected product families against the live, correction-aware
 * Supabase merchant-acceptance projection. Branch facts override chain
 * defaults; the generated representative branch id naturally uses the chain
 * default because it is not a persisted store location.
 */
export function createPostgresMerchantAcceptancePort(
  target: QueryTarget,
): MerchantAcceptancePort {
  return Object.freeze({
    async listAcceptedFamilies(input: MerchantAcceptanceQuery) {
      const result = await target.query<Record<string, unknown>>(
        MERCHANT_ACCEPTANCE_CURRENT_QUERY,
        [input.merchant_id, input.branch_id],
      );
      if (!result || !Array.isArray(result.rows))
        throw new TypeError("merchant_acceptance_result_invalid");
      if (result.rows.length > MAX_ACCEPTANCE_ROWS)
        throw new TypeError("merchant_acceptance_too_many_rows");
      const rows = result.rows.map(acceptanceRow);
      return Object.freeze(
        input.family_ids
          .filter(isCanonicalProductFamilyId)
          .filter((familyId: string) => {
            const matching = rows.filter((row) =>
              rowAppliesToFamily(row, familyId),
            );
            const branch = matching.find((row) => row.scope === "branch");
            const resolved =
              branch ?? matching.find((row) => row.scope === "chain_default");
            return resolved?.acceptance_state === "yes";
          })
          .sort(),
      );
    },
  });
}
