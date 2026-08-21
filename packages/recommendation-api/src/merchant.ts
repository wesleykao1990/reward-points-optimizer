/**
 * Small, immutable merchant catalogue used by the recommendation boundary.
 *
 * This module deliberately does not perform fuzzy search.  A merchant name is
 * user input and must resolve to one canonical id (and, where applicable, one
 * branch id) before a plan is allowed into the rule engine.
 */

export interface MerchantBranch {
  readonly branch_id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly address?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Merchant {
  readonly merchant_id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly branches: readonly MerchantBranch[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MerchantCatalog {
  readonly version: string;
  readonly merchants: readonly Merchant[];
}

export interface MerchantQuery {
  readonly merchant_id?: string;
  readonly merchant_alias?: string;
  readonly branch_id?: string;
  readonly branch_alias?: string;
}

export interface ResolvedMerchant {
  readonly merchant_id: string;
  readonly merchant_name: string;
  readonly merchant_alias: string | null;
  readonly branch_id: string;
  readonly branch_name: string;
  readonly branch_alias: string | null;
}

export class MerchantResolutionError extends Error {
  readonly code:
    | "merchant_query_missing"
    | "merchant_not_found"
    | "merchant_ambiguous"
    | "branch_query_missing"
    | "branch_not_found"
    | "branch_ambiguous"
    | "merchant_branch_mismatch"
    | "catalog_invalid";

  constructor(code: MerchantResolutionError["code"], message: string) {
    super(message);
    this.name = "MerchantResolutionError";
    this.code = code;
  }
}

/** Normalize only for exact alias matching; never use this for fuzzy search. */
export function normalizeMerchantAlias(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ");
}

function aliasesFor(
  name: string,
  aliases: readonly string[] | undefined,
): readonly string[] {
  return [name, ...(aliases ?? [])].map(normalizeMerchantAlias);
}

function uniqueMatches<T>(
  values: readonly T[],
  getAliases: (value: T) => readonly string[],
  query: string,
): readonly T[] {
  const normalized = normalizeMerchantAlias(query);
  return values.filter((value) => getAliases(value).includes(normalized));
}

function requireUnique<T>(
  matches: readonly T[],
  missingCode: MerchantResolutionError["code"],
  ambiguousCode: MerchantResolutionError["code"],
  label: string,
): T {
  if (matches.length === 0)
    throw new MerchantResolutionError(missingCode, `${label}_not_found`);
  if (matches.length > 1)
    throw new MerchantResolutionError(ambiguousCode, `${label}_ambiguous`);
  const match = matches[0];
  if (!match)
    throw new MerchantResolutionError(missingCode, `${label}_not_found`);
  return match;
}

function checkCatalog(catalog: MerchantCatalog): void {
  if (
    !catalog ||
    typeof catalog.version !== "string" ||
    catalog.version.length === 0
  )
    throw new MerchantResolutionError(
      "catalog_invalid",
      "catalog_version_required",
    );
  if (!Array.isArray(catalog.merchants) || catalog.merchants.length === 0)
    throw new MerchantResolutionError(
      "catalog_invalid",
      "catalog_merchants_required",
    );
  const merchantIds = new Set<string>();
  for (const merchant of catalog.merchants) {
    if (
      !merchant ||
      typeof merchant.merchant_id !== "string" ||
      merchant.merchant_id.length === 0
    )
      throw new MerchantResolutionError(
        "catalog_invalid",
        "merchant_id_required",
      );
    if (merchantIds.has(merchant.merchant_id))
      throw new MerchantResolutionError(
        "catalog_invalid",
        `duplicate_merchant:${merchant.merchant_id}`,
      );
    merchantIds.add(merchant.merchant_id);
    if (!Array.isArray(merchant.branches) || merchant.branches.length === 0)
      throw new MerchantResolutionError(
        "catalog_invalid",
        `merchant_branches_required:${merchant.merchant_id}`,
      );
    const branchIds = new Set<string>();
    for (const branch of merchant.branches) {
      if (
        !branch ||
        typeof branch.branch_id !== "string" ||
        branch.branch_id.length === 0
      )
        throw new MerchantResolutionError(
          "catalog_invalid",
          `branch_id_required:${merchant.merchant_id}`,
        );
      if (branchIds.has(branch.branch_id))
        throw new MerchantResolutionError(
          "catalog_invalid",
          `duplicate_branch:${branch.branch_id}`,
        );
      branchIds.add(branch.branch_id);
    }
  }
}

/**
 * Resolve a merchant and branch by canonical id or normalized exact alias.
 * A branch selector is mandatory: inferring an arbitrary branch from a chain
 * query would make the frozen comparison facts ambiguous.
 */
export function resolveMerchant(
  query: MerchantQuery,
  catalog: MerchantCatalog,
): ResolvedMerchant {
  checkCatalog(catalog);
  if (!query || (!query.merchant_id && !query.merchant_alias))
    throw new MerchantResolutionError(
      "merchant_query_missing",
      "merchant_query_required",
    );
  if (!query.branch_id && !query.branch_alias)
    throw new MerchantResolutionError(
      "branch_query_missing",
      "branch_query_required_no_chain_inference",
    );

  let merchant: Merchant;
  if (query.merchant_id) {
    merchant = requireUnique(
      catalog.merchants.filter(
        (candidate) => candidate.merchant_id === query.merchant_id,
      ),
      "merchant_not_found",
      "merchant_ambiguous",
      "merchant_id",
    );
  } else {
    merchant = requireUnique(
      uniqueMatches(
        catalog.merchants,
        (candidate) => aliasesFor(candidate.name, candidate.aliases),
        query.merchant_alias ?? "",
      ),
      "merchant_not_found",
      "merchant_ambiguous",
      "merchant_alias",
    );
  }
  if (query.merchant_alias) {
    const normalizedAlias = normalizeMerchantAlias(query.merchant_alias);
    if (!aliasesFor(merchant.name, merchant.aliases).includes(normalizedAlias))
      throw new MerchantResolutionError(
        "merchant_branch_mismatch",
        "merchant_id_alias_mismatch",
      );
  }

  let branch: MerchantBranch;
  if (query.branch_id) {
    const branchExistsElsewhere = catalog.merchants.some(
      (candidate) =>
        candidate.merchant_id !== merchant.merchant_id &&
        candidate.branches.some(
          (branchCandidate) => branchCandidate.branch_id === query.branch_id,
        ),
    );
    if (branchExistsElsewhere)
      throw new MerchantResolutionError(
        "merchant_branch_mismatch",
        "branch_belongs_to_different_merchant",
      );
    branch = requireUnique(
      merchant.branches.filter(
        (candidate) => candidate.branch_id === query.branch_id,
      ),
      "branch_not_found",
      "branch_ambiguous",
      "branch_id",
    );
  } else {
    branch = requireUnique(
      uniqueMatches(
        merchant.branches,
        (candidate) => aliasesFor(candidate.name, candidate.aliases),
        query.branch_alias ?? "",
      ),
      "branch_not_found",
      "branch_ambiguous",
      "branch_alias",
    );
  }
  if (query.branch_alias) {
    const normalizedAlias = normalizeMerchantAlias(query.branch_alias);
    if (!aliasesFor(branch.name, branch.aliases).includes(normalizedAlias))
      throw new MerchantResolutionError(
        "merchant_branch_mismatch",
        "branch_id_alias_mismatch",
      );
  }
  return Object.freeze({
    merchant_id: merchant.merchant_id,
    merchant_name: merchant.name,
    merchant_alias: query.merchant_alias ?? null,
    branch_id: branch.branch_id,
    branch_name: branch.name,
    branch_alias: query.branch_alias ?? null,
  });
}

export const resolveMerchantBranch = resolveMerchant;
