import type { P0SpendRule } from "./p0-spend-rules.js";

export const PRODUCTION_EXCHANGE_COVERAGE_VERSION =
  "production-exchange-route-coverage.v1" as const;
/** @deprecated Compatibility name for the original package API. */
export const P0_EXCHANGE_COVERAGE_VERSION =
  PRODUCTION_EXCHANGE_COVERAGE_VERSION;

export type P0ExchangeCoverageDisposition =
  | "executable"
  | "research_required"
  | "inactive"
  | "out_of_scope_asset";

export interface P0ExchangeCoverageEntry {
  readonly route_key: string;
  readonly source_asset_id: string;
  readonly destination_asset_id: string;
  readonly source_ids: readonly string[];
  readonly disposition: P0ExchangeCoverageDisposition;
  readonly rule_ids: readonly string[];
  readonly reason: string;
}

export interface P0ExchangeProgramCoverage {
  readonly asset_id: string;
  readonly directory_source_ids: readonly string[];
  readonly directory_status: "catalogued_as_of" | "research_required";
}

export interface ProductionExchangeDirectoryEnumerationTask {
  readonly task_id: string;
  readonly run_group: "production-exchange-directory-enumeration";
  readonly preferred_batch_size: 4;
  readonly snapshot_granularity: "one_per_directory";
  readonly asset_id: string;
  readonly source_role_id: "transfer_partner_directory";
  readonly finding_type: "rewards.transfer_change";
  readonly required_attribute: "exchange_directory_snapshot";
  readonly objective: string;
}

export interface P0ExchangeCoverageIssue {
  readonly code:
    | "duplicate_route_key"
    | "executable_rule_missing"
    | "executable_rule_asset_mismatch"
    | "executable_rule_source_unbound"
    | "programme_directory_missing";
  readonly route_key: string | null;
  readonly message: string;
}

export interface P0ExchangeCoverageAudit {
  readonly version: typeof PRODUCTION_EXCHANGE_COVERAGE_VERSION;
  readonly complete: boolean;
  readonly executable_route_count: number;
  readonly research_required_route_count: number;
  readonly programme_research_required_count: number;
  readonly issues: readonly P0ExchangeCoverageIssue[];
}

const executable = (
  route_key: string,
  source_asset_id: string,
  destination_asset_id: string,
  source_ids: readonly string[],
  rule_ids: readonly string[],
): P0ExchangeCoverageEntry =>
  Object.freeze({
    route_key,
    source_asset_id,
    destination_asset_id,
    source_ids: Object.freeze([...source_ids].sort()),
    disposition: "executable" as const,
    rule_ids: Object.freeze([...rule_ids].sort()),
    reason: "The official directory row is represented by an executable rule.",
  });

const researchRequired = (
  route_key: string,
  source_asset_id: string,
  destination_asset_id: string,
  source_ids: readonly string[],
  reason: string,
): P0ExchangeCoverageEntry =>
  Object.freeze({
    route_key,
    source_asset_id,
    destination_asset_id,
    source_ids: Object.freeze([...source_ids].sort()),
    disposition: "research_required" as const,
    rule_ids: Object.freeze([]),
    reason,
  });

const jr = Object.freeze(["jp.jrkyushu.point-exchange"]);
const moppy = Object.freeze(["jp.moppy.exchange"]);

/**
 * Directory rows observed on official pages whose endpoints already exist in
 * the production asset catalogue. A missing executable rule is an error. A row that
 * cannot yet be represented is retained as research_required rather than
 * silently disappearing from the graph.
 */
export const PRODUCTION_EXCHANGE_DIRECTORY_COVERAGE = Object.freeze([
  executable(
    "recruit:ponta",
    "asset.point.recruit",
    "asset.point.ponta",
    ["jp.recruitpoint.exchange-partners", "src.point.ponta.exchange-directory"],
    ["p0.transfer.recruit.ponta"],
  ),
  executable(
    "recruit:d",
    "asset.point.recruit",
    "asset.point.d",
    ["jp.recruitpoint.d-transfer", "jp.recruitpoint.exchange-partners"],
    ["p0.transfer.recruit-to-d"],
  ),
  executable(
    "ponta:jal",
    "asset.point.ponta",
    "asset.mile.jal",
    [
      "jp.ponta.jal-transfer",
      "src.point.ponta.exchange-directory",
      "src.point.ponta.jal-transfer",
    ],
    ["p0.transfer.ponta.jal"],
  ),
  executable(
    "jal:ponta",
    "asset.mile.jal",
    "asset.point.ponta",
    ["jp.jal.ponta-benefit"],
    ["p0.transfer.jal-to-ponta-high-tier", "p0.transfer.jal-to-ponta-low-tier"],
  ),
  executable("v:jr-kyupo", "asset.point.v", "asset.point.jr-kyupo", jr, [
    "p0.transfer.v-to-jr-kyupo",
  ]),
  executable(
    "saison:jr-kyupo",
    "asset.point.saison-permanent",
    "asset.point.jr-kyupo",
    jr,
    ["p0.transfer.saison-permanent-to-jr-kyupo"],
  ),
  executable("bic:jr-kyupo", "asset.point.bic", "asset.point.jr-kyupo", jr, [
    "p0.transfer.bic-to-jr-kyupo",
  ]),
  executable("waon:jr-kyupo", "asset.point.waon", "asset.point.jr-kyupo", jr, [
    "p0.transfer.waon-to-jr-kyupo",
  ]),
  executable("jr-kyupo:v", "asset.point.jr-kyupo", "asset.point.v", jr, [
    "p0.transfer.jr-kyupo-to-v",
  ]),
  executable(
    "jr-kyupo:saison",
    "asset.point.jr-kyupo",
    "asset.point.saison-permanent",
    jr,
    ["p0.transfer.jr-kyupo-to-saison-permanent"],
  ),
  executable("jr-kyupo:bic", "asset.point.jr-kyupo", "asset.point.bic", jr, [
    "p0.transfer.jr-kyupo-to-bic",
  ]),
  executable("jr-kyupo:jal", "asset.point.jr-kyupo", "asset.mile.jal", jr, [
    "p0.transfer.jr-kyupo-to-jal",
  ]),
  executable("jr-kyupo:ana", "asset.point.jr-kyupo", "asset.mile.ana", jr, [
    "p0.transfer.jr-kyupo-to-ana",
  ]),
  executable(
    "jal:jr-kyupo",
    "asset.mile.jal",
    "asset.point.jr-kyupo",
    ["jp.jal.jr-kyupo-benefit"],
    [
      "p0.transfer.jal-to-jr-kyupo-high-tier",
      "p0.transfer.jal-to-jr-kyupo-low-tier",
    ],
  ),
  executable(
    "ana:jr-kyupo",
    "asset.mile.ana",
    "asset.point.jr-kyupo",
    ["jp.ana.jr-kyupo-benefit", "jp.ana.partner-exchange-rules"],
    [
      "p0.transfer.ana-to-jr-kyupo-full-tier",
      "p0.transfer.ana-to-jr-kyupo-reduced-tier",
    ],
  ),
  executable(
    "moppy:jal",
    "asset.point.moppy",
    "asset.mile.jal",
    ["jp.jal.moppy-standard-transfer", "jp.moppy.exchange-directory"],
    ["p0.transfer.moppy-to-jal-standard"],
  ),
  executable("moppy:d", "asset.point.moppy", "asset.point.d", moppy, [
    "p0.transfer.moppy-to-d",
  ]),
  executable("moppy:nanaco", "asset.point.moppy", "asset.point.nanaco", moppy, [
    "p0.transfer.moppy-to-nanaco",
  ]),
  researchRequired(
    "moppy:ponta",
    "asset.point.moppy",
    "asset.point.ponta",
    [
      "jp.moppy.exchange",
      "jp.moppy.exchange-fee-help",
      "jp.moppy.ponta-exchange",
    ],
    "The exact 315-to-300 minimum transaction is executable; the fee above that minimum is still published only as 15 points and up.",
  ),
  executable(
    "moppy:waon",
    "asset.point.moppy",
    "asset.point.waon",
    ["jp.moppy.exchange", "jp.moppy.waon-launch"],
    ["p0.transfer.moppy-to-waon"],
  ),
  executable(
    "moppy:v",
    "asset.point.moppy",
    "asset.point.v",
    ["jp.moppy.exchange", "jp.moppy.v-fee-update"],
    ["p0.transfer.moppy-to-v"],
  ),
  executable(
    "moppy:rakuten",
    "asset.point.moppy",
    "asset.point.rakuten",
    ["jp.moppy.exchange", "jp.moppy.rakuten-fee-update"],
    ["p0.transfer.moppy-to-rakuten"],
  ),
  researchRequired(
    "moppy:paypay",
    "asset.point.moppy",
    "asset.point.paypay",
    [
      "jp.moppy.exchange",
      "jp.moppy.exchange-fee-help",
      "jp.moppy.paypay-exchange",
    ],
    "The exact 550-to-500 minimum transaction is executable; the fee above that minimum is still published only as 50 points and up.",
  ),
  executable(
    "moppy:ana",
    "asset.point.moppy",
    "asset.mile.ana",
    ["jp.moppy.ana-exchange", "jp.moppy.exchange"],
    ["p0.transfer.moppy-to-ana"],
  ),
] satisfies readonly P0ExchangeCoverageEntry[]);

/** @deprecated Compatibility alias; new callers should use production scope. */
export const P0_EXCHANGE_DIRECTORY_COVERAGE =
  PRODUCTION_EXCHANGE_DIRECTORY_COVERAGE;

export const PRODUCTION_EXCHANGE_PROGRAM_COVERAGE = Object.freeze([
  {
    asset_id: "asset.point.recruit",
    directory_source_ids: Object.freeze([
      "jp.recruitpoint.d-transfer",
      "jp.recruitpoint.exchange-partners",
    ]),
    directory_status: "catalogued_as_of" as const,
  },
  {
    asset_id: "asset.point.jr-kyupo",
    directory_source_ids: jr,
    directory_status: "catalogued_as_of" as const,
  },
  {
    asset_id: "asset.point.moppy",
    directory_source_ids: moppy,
    directory_status: "catalogued_as_of" as const,
  },
  {
    asset_id: "asset.point.ponta",
    directory_source_ids: Object.freeze([
      "jp.jal.ponta-benefit",
      "jp.ponta.exchange-hub",
      "jp.ponta.jal-transfer",
    ]),
    directory_status: "catalogued_as_of" as const,
  },
  ...[
    "asset.mile.ana",
    "asset.mile.jal",
    "asset.point.bic",
    "asset.point.d",
    "asset.point.jre",
    "asset.point.nanaco",
    "asset.point.paypay",
    "asset.point.rakuten",
    "asset.point.saison-permanent",
    "asset.point.seven-mile",
    "asset.point.v",
    "asset.point.waon",
  ].map((asset_id) =>
    Object.freeze({
      asset_id,
      directory_source_ids: Object.freeze([]),
      directory_status: "research_required" as const,
    }),
  ),
] satisfies readonly P0ExchangeProgramCoverage[]);

/** @deprecated Compatibility alias; new callers should use production scope. */
export const P0_EXCHANGE_PROGRAM_COVERAGE =
  PRODUCTION_EXCHANGE_PROGRAM_COVERAGE;

/**
 * Bounded discovery/enumeration work for programmes whose complete official
 * outbound directory has not yet been reconciled. These tasks identify work;
 * they contain no representative URL or invented exchange relationship.
 */
export const PRODUCTION_EXCHANGE_DIRECTORY_ENUMERATION_TASKS = Object.freeze(
  PRODUCTION_EXCHANGE_PROGRAM_COVERAGE.filter(
    (programme) => programme.directory_status === "research_required",
  ).map((programme) =>
    Object.freeze({
      task_id: `exchange-directory-enumeration:${programme.asset_id}`,
      run_group: "production-exchange-directory-enumeration" as const,
      preferred_batch_size: 4 as const,
      snapshot_granularity: "one_per_directory" as const,
      asset_id: programme.asset_id,
      source_role_id: "transfer_partner_directory" as const,
      finding_type: "rewards.transfer_change" as const,
      required_attribute: "exchange_directory_snapshot" as const,
      objective:
        "Enumerate every current outbound row in the programme-owned official exchange directory and emit exactly one disposition per row.",
    }),
  ),
) satisfies readonly ProductionExchangeDirectoryEnumerationTask[];

export function auditProductionExchangeRouteCoverage(
  rules: readonly P0SpendRule[],
): P0ExchangeCoverageAudit {
  const issues: P0ExchangeCoverageIssue[] = [];
  const routeKeys = new Set<string>();
  const ruleById = new Map(rules.map((rule) => [rule.rule_id, rule]));
  for (const entry of PRODUCTION_EXCHANGE_DIRECTORY_COVERAGE) {
    if (routeKeys.has(entry.route_key))
      issues.push({
        code: "duplicate_route_key",
        route_key: entry.route_key,
        message: `duplicate exchange coverage route: ${entry.route_key}`,
      });
    routeKeys.add(entry.route_key);
    if (entry.disposition !== "executable") continue;
    for (const ruleId of entry.rule_ids) {
      const rule = ruleById.get(ruleId);
      if (!rule) {
        issues.push({
          code: "executable_rule_missing",
          route_key: entry.route_key,
          message: `expected executable rule is missing: ${ruleId}`,
        });
        continue;
      }
      if (
        rule.source_asset.asset_id !== entry.source_asset_id ||
        rule.destination_asset.asset_id !== entry.destination_asset_id
      )
        issues.push({
          code: "executable_rule_asset_mismatch",
          route_key: entry.route_key,
          message: `rule asset tuple differs from official directory row: ${ruleId}`,
        });
      if (
        !entry.source_ids.some((sourceId) => rule.source_ids.includes(sourceId))
      )
        issues.push({
          code: "executable_rule_source_unbound",
          route_key: entry.route_key,
          message: `rule is not bound to the directory source: ${ruleId}`,
        });
    }
  }
  const missingProgrammes = PRODUCTION_EXCHANGE_PROGRAM_COVERAGE.filter(
    (programme) => programme.directory_status === "research_required",
  );
  for (const programme of missingProgrammes)
    issues.push({
      code: "programme_directory_missing",
      route_key: null,
      message: `official exchange directory still requires enumeration: ${programme.asset_id}`,
    });
  const researchCount = PRODUCTION_EXCHANGE_DIRECTORY_COVERAGE.filter(
    (entry) => entry.disposition === "research_required",
  ).length;
  return Object.freeze({
    version: PRODUCTION_EXCHANGE_COVERAGE_VERSION,
    complete: issues.length === 0 && researchCount === 0,
    executable_route_count: PRODUCTION_EXCHANGE_DIRECTORY_COVERAGE.filter(
      (entry) => entry.disposition === "executable",
    ).length,
    research_required_route_count: researchCount,
    programme_research_required_count: missingProgrammes.length,
    issues: Object.freeze(issues),
  });
}

/** @deprecated Compatibility wrapper for the original package API. */
export const auditP0ExchangeRouteCoverage =
  auditProductionExchangeRouteCoverage;
