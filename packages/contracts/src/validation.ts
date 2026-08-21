import type { ErrorObject } from "ajv";
import { Decimal } from "decimal.js";
import { canonicalize, definitionHash } from "./canonical.js";
import {
  getValidator,
  normalizeSchemaName,
  type SchemaInput,
  type SchemaName,
} from "./schema-loader.js";
import type {
  AssetLot,
  RewardRule,
  SourceAccessObservation,
  TrustedSourceRegistry,
} from "./types.js";

export interface ValidationIssue {
  /** JSON Pointer path. The empty string denotes the document root. */
  path: string;
  /** Stable machine-readable semantic or structural code. */
  code: string;
  /** Human-readable explanation; not used for programmatic branching. */
  message: string;
  /** Ajv keyword for structural issues. */
  keyword?: string;
}

export interface ValidationResult<T = unknown> {
  valid: boolean;
  value?: T;
  issues: readonly ValidationIssue[];
  /** Alias retained for callers that conventionally call validation errors `errors`. */
  errors: readonly ValidationIssue[];
}

export interface SemanticValidationOptions {
  /** Path prefix used when a document is nested in another artifact. */
  pathPrefix?: string;
  /** Opening lots available to a candidate plan/result. */
  openingLots?: readonly AssetLot[];
  /** Opening lot IDs are useful when a caller does not have full lot objects. */
  openingLotIds?: ReadonlySet<string> | readonly string[];
  /** Related versions used for bitemporal overlap/replay checks. */
  relatedRules?: readonly RewardRule[];
  transactionTime?: string | Date;
  replayKnowledgeTime?: string | Date;
  /** Registry context used to check source IDs and technical observations. */
  sourceRegistry?: TrustedSourceRegistry;
  accessObservations?: readonly SourceAccessObservation[];
}

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function records(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function pointer(base: string, ...parts: (string | number)[]): string {
  const suffix = parts.map((part) =>
    String(part).replaceAll("~", "~0").replaceAll("/", "~1"),
  );
  return [base.replace(/\/$/, ""), ...suffix]
    .filter((part) => part !== "")
    .join("/")
    ? `/${[base.replace(/^\//, "").replace(/\/$/, ""), ...suffix].filter(Boolean).join("/")}`
    : "";
}

function issuePath(base: string, path: string): string {
  if (!base) return path;
  if (!path) return base;
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseTime(value: unknown): number | undefined {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : undefined;
  }
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function decimal(value: unknown): Decimal | undefined {
  if (
    typeof value !== "string" &&
    (typeof value !== "number" || !Number.isInteger(value))
  )
    return undefined;
  try {
    const parsed = new Decimal(String(value));
    return parsed.isFinite() ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function duplicateValues(values: readonly unknown[]): unknown[] {
  const counts = new Map<string, { value: unknown; count: number }>();
  for (const value of values) {
    const key =
      typeof value === "string" ? `s:${value}` : `j:${JSON.stringify(value)}`;
    const previous = counts.get(key);
    counts.set(key, { value, count: (previous?.count ?? 0) + 1 });
  }
  return [...counts.values()]
    .filter((item) => item.count > 1)
    .map((item) => item.value);
}

class IssueCollector {
  readonly items: ValidationIssue[] = [];

  add(path: string, code: string, message: string, keyword?: string): void {
    const issue: ValidationIssue = { path, code, message };
    if (keyword !== undefined) issue.keyword = keyword;
    this.items.push(issue);
  }

  addAll(issues: readonly ValidationIssue[]): void {
    this.items.push(...issues);
  }

  result<T>(value: T): ValidationResult<T> {
    const issues = this.items.slice();
    if (issues.length === 0)
      return { valid: true, value, issues, errors: issues };
    return { valid: false, issues, errors: issues };
  }
}

function success<T>(value: T): ValidationResult<T> {
  return { valid: true, value, issues: [], errors: [] };
}

function structuralIssue(error: ErrorObject): ValidationIssue {
  let path = error.instancePath || "";
  if (
    error.keyword === "required" &&
    typeof error.params === "object" &&
    error.params !== null
  ) {
    const missing = (error.params as { missingProperty?: unknown })
      .missingProperty;
    if (typeof missing === "string") path = pointer(path, missing);
  }
  return {
    path,
    code: `schema_${error.keyword}`,
    message: error.message ?? `Schema validation failed (${error.keyword})`,
    keyword: error.keyword,
  };
}

function sortIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );
}

export function validateStructure<T = unknown>(
  value: unknown,
  schema: SchemaInput,
): ValidationResult<T> {
  const validator = getValidator(schema);
  const valid = validator(value);
  if (valid) return success(value as T);
  const collector = new IssueCollector();
  for (const error of validator.errors ?? [])
    collector.addAll([structuralIssue(error)]);
  const issues = sortIssues(collector.items);
  return { valid: false, issues, errors: issues };
}

export class ContractValidationError extends Error {
  readonly issues: readonly ValidationIssue[];
  readonly schema?: SchemaName;

  constructor(issues: readonly ValidationIssue[], schema?: SchemaName) {
    const prefix = schema ? `${schema}: ` : "";
    super(
      `${prefix}contract validation failed\n${issues.map((item) => `${item.path || "<root>"} [${item.code}] ${item.message}`).join("\n")}`,
    );
    this.name = "ContractValidationError";
    this.issues = issues;
    if (schema !== undefined) this.schema = schema;
  }
}

function addRangeIssue(
  collector: IssueCollector,
  value: unknown,
  path: string,
): void {
  if (!isRecord(value)) return;
  const minimum = value.minimum_jpy;
  const maximum = value.maximum_jpy;
  const min = typeof minimum === "number" ? minimum : undefined;
  const max = typeof maximum === "number" ? maximum : undefined;
  if (min !== undefined && max !== undefined && min > max) {
    collector.add(
      path,
      "value_range_order",
      "minimum_jpy must not exceed maximum_jpy",
    );
  }
  const expected = value.expected_jpy;
  if (
    typeof expected === "number" &&
    min !== undefined &&
    max !== undefined &&
    (expected < min || expected > max)
  ) {
    collector.add(
      path,
      "value_range_expected_outside",
      "expected_jpy must be within minimum_jpy and maximum_jpy",
    );
  }
}

function validateExpiry(
  expiry: unknown,
  path: string,
  collector: IssueCollector,
): void {
  if (!isRecord(expiry)) return;
  if (expiry.policy === "fixed_date" && expiry.expires_at === null) {
    collector.add(
      pointer(path, "expires_at"),
      "expiry_date_required",
      "fixed_date expiry requires expires_at",
    );
  }
  if (
    expiry.policy === "relative_to_posting" &&
    expiry.duration_days === null
  ) {
    collector.add(
      pointer(path, "duration_days"),
      "expiry_duration_required",
      "relative_to_posting expiry requires duration_days",
    );
  }
  const from = parseTime(expiry.expires_at);
  if (expiry.expires_at !== null && from === undefined) {
    collector.add(
      pointer(path, "expires_at"),
      "invalid_datetime",
      "expires_at must be a valid date-time",
    );
  }
}

function validateLot(
  lot: unknown,
  path: string,
  collector: IssueCollector,
): void {
  if (!isRecord(lot)) return;
  const quantity = isRecord(lot.quantity) ? lot.quantity : undefined;
  const amount = quantity?.amount;
  const parsed = decimal(amount);
  if (parsed && parsed.isNegative())
    collector.add(
      pointer(path, "quantity", "amount"),
      "negative_quantity",
      "asset quantity must not be negative",
    );
  validateExpiry(lot.expiry, pointer(path, "expiry"), collector);
  const settlement = lot.settlement;
  if (isRecord(settlement)) {
    const start = parseTime(settlement.expected_posting_from);
    const end = parseTime(settlement.expected_posting_to);
    if (start !== undefined && end !== undefined && end < start) {
      collector.add(
        pointer(path, "settlement"),
        "posting_window_reversed",
        "expected posting end must not precede start",
      );
    }
  }
}

function comparable(value: unknown): Decimal | undefined {
  if (typeof value === "number" && Number.isInteger(value))
    return decimal(value);
  if (typeof value === "string" && /^-?[0-9]+(?:\.[0-9]+)?$/.test(value))
    return decimal(value);
  return undefined;
}

function validateUserState(
  state: RecordValue,
  path: string,
  collector: IssueCollector,
): void {
  const facts = isRecord(state.facts) ? state.facts : {};
  for (const [key, rawFact] of Object.entries(facts)) {
    if (!isRecord(rawFact)) continue;
    const factPath = pointer(pointer(path, "facts"), key);
    const status = rawFact.status;
    if (status === "known") {
      if (rawFact.value === undefined)
        collector.add(
          factPath,
          "known_value_required",
          "known fact requires value",
        );
      if (rawFact.lower_bound !== undefined && rawFact.lower_bound !== null) {
        collector.add(
          pointer(factPath, "lower_bound"),
          "known_bounds_forbidden",
          "known fact lower_bound must be null or omitted",
        );
      }
      if (rawFact.upper_bound !== undefined && rawFact.upper_bound !== null) {
        collector.add(
          pointer(factPath, "upper_bound"),
          "known_bounds_forbidden",
          "known fact upper_bound must be null or omitted",
        );
      }
      if (rawFact.source === "inferred") {
        collector.add(
          pointer(factPath, "source"),
          "known_inferred_source",
          "known fact source must not be silently changed to inferred",
        );
      }
    } else if (status === "estimated") {
      const lower = comparable(rawFact.lower_bound);
      const upper = comparable(rawFact.upper_bound);
      if (rawFact.lower_bound === null || rawFact.lower_bound === undefined) {
        collector.add(
          pointer(factPath, "lower_bound"),
          "estimated_bound_required",
          "estimated fact requires a lower bound",
        );
      } else if (!lower) {
        collector.add(
          pointer(factPath, "lower_bound"),
          "estimated_bound_not_comparable",
          "estimated lower bound must be an integer or decimal string",
        );
      }
      if (rawFact.upper_bound === null || rawFact.upper_bound === undefined) {
        collector.add(
          pointer(factPath, "upper_bound"),
          "estimated_bound_required",
          "estimated fact requires an upper bound",
        );
      } else if (!upper) {
        collector.add(
          pointer(factPath, "upper_bound"),
          "estimated_bound_not_comparable",
          "estimated upper bound must be an integer or decimal string",
        );
      }
      if (lower && upper && lower.gt(upper)) {
        collector.add(
          factPath,
          "estimated_bounds_order",
          "estimated lower bound must not exceed upper bound",
        );
      }
      if (rawFact.source === "unknown") {
        collector.add(
          pointer(factPath, "source"),
          "estimated_source_required",
          "estimated fact source must identify its origin",
        );
      }
    } else if (status === "unknown" || status === "not_applicable") {
      if (rawFact.confidence !== undefined && rawFact.confidence !== null) {
        collector.add(
          pointer(factPath, "confidence"),
          "unknown_confidence_forbidden",
          `${String(status)} facts must have null confidence`,
        );
      }
      if (rawFact.value !== undefined && rawFact.value !== null) {
        collector.add(
          pointer(factPath, "value"),
          "unknown_value_forbidden",
          `${String(status)} facts must not invent a favorable value`,
        );
      }
    }
  }

  const progressMap = isRecord(state.cap_progress) ? state.cap_progress : {};
  for (const [key, rawProgress] of Object.entries(progressMap)) {
    if (!isRecord(rawProgress)) continue;
    const progressPath = pointer(pointer(path, "cap_progress"), key);
    const start = parseTime(rawProgress.period_start);
    const end = parseTime(rawProgress.period_end);
    if (start !== undefined && end !== undefined && end <= start) {
      collector.add(
        progressPath,
        "cap_period_order",
        "period_end must be strictly after period_start",
      );
    }
    if (rawProgress.status === "known" || rawProgress.status === "estimated") {
      const fields = [
        "eligible_spend_jpy_min",
        "eligible_spend_jpy_max",
        "reward_earned_units_min",
        "reward_earned_units_max",
      ];
      for (const field of fields) {
        if (rawProgress[field] === undefined || rawProgress[field] === null) {
          collector.add(
            pointer(progressPath, field),
            "cap_bound_required",
            `${String(rawProgress.status)} cap progress requires complete bounds`,
          );
        }
      }
      if (
        rawProgress.observed_at === null ||
        rawProgress.observed_at === undefined
      ) {
        collector.add(
          pointer(progressPath, "observed_at"),
          "cap_observation_required",
          `${String(rawProgress.status)} cap progress requires observed_at`,
        );
      }
      if (
        typeof rawProgress.eligible_spend_jpy_min === "number" &&
        typeof rawProgress.eligible_spend_jpy_max === "number" &&
        rawProgress.eligible_spend_jpy_min > rawProgress.eligible_spend_jpy_max
      ) {
        collector.add(
          progressPath,
          "cap_spend_bounds_order",
          "eligible spend lower bound must not exceed upper bound",
        );
      }
      const rewardMin = decimal(rawProgress.reward_earned_units_min);
      const rewardMax = decimal(rawProgress.reward_earned_units_max);
      if (rewardMin && rewardMax && rewardMin.gt(rewardMax)) {
        collector.add(
          progressPath,
          "cap_reward_bounds_order",
          "reward earned lower bound must not exceed upper bound",
        );
      }
      if (
        rawProgress.status === "known" &&
        ((typeof rawProgress.eligible_spend_jpy_min === "number" &&
          typeof rawProgress.eligible_spend_jpy_max === "number" &&
          rawProgress.eligible_spend_jpy_min !==
            rawProgress.eligible_spend_jpy_max) ||
          (rewardMin && rewardMax && !rewardMin.eq(rewardMax)))
      ) {
        collector.add(
          progressPath,
          "known_cap_bounds_unequal",
          "known cap progress must have equal lower and upper bounds",
        );
      }
    }
  }

  const lots = Array.isArray(state.asset_lots) ? state.asset_lots : [];
  const lotIds = lots.map((lot) => (isRecord(lot) ? lot.lot_id : undefined));
  for (const duplicate of duplicateValues(lotIds))
    collector.add(
      pointer(path, "asset_lots"),
      "duplicate_lot_id",
      `duplicate opening asset-lot ID ${String(duplicate)}`,
    );
  lots.forEach((lot, index) => {
    validateLot(lot, pointer(path, "asset_lots", index), collector);
  });

  const valuationEntries =
    isRecord(state.valuation_profile) &&
    Array.isArray(state.valuation_profile.entries)
      ? state.valuation_profile.entries
      : [];
  const valuationKeys = valuationEntries.map((entry) => {
    if (!isRecord(entry)) return undefined;
    return `${String(entry.asset_id)}\u0000${String(entry.reward_class)}\u0000${String(entry.expiry_horizon_days)}`;
  });
  for (const duplicate of duplicateValues(valuationKeys))
    collector.add(
      pointer(path, "valuation_profile", "entries"),
      "duplicate_valuation_entry",
      `duplicate valuation entry ${String(duplicate)}`,
    );
  valuationEntries.forEach((entry, index) => {
    if (isRecord(entry) && !decimal(entry.jpy_per_unit))
      collector.add(
        pointer(path, "valuation_profile", "entries", index, "jpy_per_unit"),
        "invalid_decimal",
        "jpy_per_unit must be a finite decimal string",
      );
  });
}

function openingIds(options: SemanticValidationOptions): Set<string> {
  const ids = new Set<string>();
  for (const lot of options.openingLots ?? [])
    if (isRecord(lot)) {
      const id = asString(lot.lot_id);
      if (id) ids.add(id);
    }
  for (const id of options.openingLotIds ?? []) ids.add(id);
  return ids;
}

function validatePlan(
  plan: RecordValue,
  path: string,
  collector: IssueCollector,
  options: SemanticValidationOptions,
): void {
  const operations = records(plan.operations);
  const operationIds = operations.map((operation) => operation.operation_id);
  for (const duplicate of duplicateValues(operationIds))
    collector.add(
      pointer(path, "operations"),
      "duplicate_operation_id",
      `duplicate operation ID ${String(duplicate)}`,
    );
  const sequenceValues = operations.map((operation) => operation.sequence);
  for (const duplicate of duplicateValues(sequenceValues))
    collector.add(
      pointer(path, "operations"),
      "duplicate_operation_sequence",
      `duplicate operation sequence ${String(duplicate)}`,
    );
  const byId = new Map<string, RecordValue>();
  const sequenceById = new Map<string, number>();
  operations.forEach((operation) => {
    const id = asString(operation.operation_id);
    if (id) byId.set(id, operation);
    if (id && typeof operation.sequence === "number")
      sequenceById.set(id, operation.sequence);
  });
  const ordered = operations
    .slice()
    .sort((left, right) => Number(left.sequence) - Number(right.sequence));
  const timestamps = ordered.map((operation) =>
    parseTime(operation.occurred_at),
  );
  for (let index = 1; index < timestamps.length; index += 1) {
    const previousTimestamp = timestamps[index - 1];
    const currentTimestamp = timestamps[index];
    if (
      previousTimestamp !== undefined &&
      currentTimestamp !== undefined &&
      previousTimestamp > currentTimestamp
    ) {
      collector.add(
        pointer(path, "operations", index),
        "operation_timestamp_backwards",
        "operation timestamps must not move backward relative to sequence",
      );
    }
  }

  records(plan.dependencies).forEach((dependency, index) => {
    const from = asString(dependency.from_operation_id);
    const to = asString(dependency.to_operation_id);
    const depPath = pointer(path, "dependencies", index);
    if (!from || !to || !byId.has(from) || !byId.has(to)) {
      collector.add(
        depPath,
        "dependency_unknown_operation",
        "dependency must reference existing operations",
      );
    } else if ((sequenceById.get(from) ?? 0) >= (sequenceById.get(to) ?? 0)) {
      collector.add(
        depPath,
        "dependency_order",
        "dependency must point from an earlier operation to a later operation",
      );
    }
  });

  const initialLots = openingIds(options);
  const allOutputLots = new Map<string, number>();
  for (const operation of operations) {
    for (const output of records(operation.output_requests)) {
      const lotId = asString(output.created_lot_id);
      if (lotId && typeof operation.sequence === "number")
        allOutputLots.set(lotId, operation.sequence);
    }
  }
  const createdLots = new Set<string>();
  const seenInputs = new Set<string>();
  const seenOutputs = new Set<string>();
  for (const operation of ordered) {
    const operationPath = pointer(
      path,
      "operations",
      operations.indexOf(operation),
    );
    const original = operation.original_operation_id;
    if (
      original !== null &&
      (typeof original !== "string" || !byId.has(original))
    )
      collector.add(
        pointer(operationPath, "original_operation_id"),
        "original_operation_unknown",
        "original_operation_id must reference an operation in the plan",
      );
    else if (
      typeof original === "string" &&
      (sequenceById.get(original) ?? 0) >= Number(operation.sequence)
    )
      collector.add(
        pointer(operationPath, "original_operation_id"),
        "original_operation_order",
        "original operation must occur earlier",
      );

    if (
      operation.operation_type === "refund" ||
      operation.operation_type === "reversal"
    ) {
      const originalOperation =
        typeof original === "string" ? byId.get(original) : undefined;
      const outputs = records(operation.output_requests);
      const output = outputs[0];
      const operationAmount = decimal(operation.amount_jpy);
      const originalAmount = decimal(originalOperation?.amount_jpy);
      const outputAmount = output
        ? decimal(output.requested_amount ?? operation.amount_jpy)
        : undefined;
      if (outputs.length !== 1 || output?.role !== "refund")
        collector.add(
          pointer(operationPath, "output_requests"),
          "lifecycle_return_output_required",
          "refund/reversal requires exactly one refund-role return output",
        );
      if (operationAmount && outputAmount && !operationAmount.eq(outputAmount))
        collector.add(
          pointer(operationPath, "output_requests", 0, "requested_amount"),
          "lifecycle_return_amount_mismatch",
          "returned principal quantity must equal the declared refund/reversal amount",
        );
      if (
        operationAmount &&
        originalAmount &&
        (operationAmount.lte(0) || operationAmount.gt(originalAmount))
      )
        collector.add(
          pointer(operationPath, "amount_jpy"),
          "lifecycle_amount_exceeds_original",
          "refund/reversal amount must be positive and no greater than the original amount",
        );
      if (
        operation.operation_type === "reversal" &&
        operationAmount &&
        originalAmount &&
        !operationAmount.eq(originalAmount)
      )
        collector.add(
          pointer(operationPath, "amount_jpy"),
          "partial_reversal_forbidden",
          "a reversal must return the full original amount",
        );
      if (originalOperation && output) {
        const outputBucket = bucket({ asset: output.asset });
        const matchingTender = records(originalOperation.asset_inputs).filter(
          (input) =>
            input.role !== "fee" &&
            input.role !== "refund_source" &&
            bucket(input.quantity) === outputBucket,
        );
        if (matchingTender.length === 0)
          collector.add(
            pointer(operationPath, "output_requests", 0, "asset"),
            "lifecycle_return_asset_mismatch",
            "refund/reversal output asset and reward class must match original tender",
          );
        else {
          const originalTender = matchingTender.reduce(
            (sum, input) =>
              sum.plus(
                isRecord(input.quantity)
                  ? (decimal(input.quantity.amount) ?? new Decimal(0))
                  : new Decimal(0),
              ),
            new Decimal(0),
          );
          const cumulativeReturn = ordered
            .filter(
              (candidate) =>
                Number(candidate.sequence) <= Number(operation.sequence) &&
                candidate.original_operation_id === original &&
                (candidate.operation_type === "refund" ||
                  candidate.operation_type === "reversal"),
            )
            .flatMap((candidate) =>
              records(candidate.output_requests).map((candidateOutput) => ({
                candidateOutput,
                operationAmountJpy: candidate.amount_jpy,
              })),
            )
            .filter(
              ({ candidateOutput }) =>
                bucket({ asset: candidateOutput.asset }) === outputBucket,
            )
            .reduce(
              (sum, { candidateOutput, operationAmountJpy }) =>
                sum.plus(
                  decimal(
                    candidateOutput.requested_amount ?? operationAmountJpy,
                  ) ?? new Decimal(0),
                ),
              new Decimal(0),
            );
          if (cumulativeReturn.gt(originalTender))
            collector.add(
              pointer(operationPath, "output_requests", 0, "requested_amount"),
              "cumulative_lifecycle_return_exceeds_tender",
              "cumulative returned principal exceeds the original matching tender",
            );
          if (
            operation.operation_type === "reversal" &&
            outputAmount &&
            !outputAmount.eq(originalTender)
          )
            collector.add(
              pointer(operationPath, "output_requests", 0, "requested_amount"),
              "reversal_return_quantity_mismatch",
              "a reversal must return the full original matching tender quantity",
            );
        }
      }
      if (originalAmount) {
        const cumulativeJpy = ordered
          .filter(
            (candidate) =>
              Number(candidate.sequence) <= Number(operation.sequence) &&
              candidate.original_operation_id === original &&
              (candidate.operation_type === "refund" ||
                candidate.operation_type === "reversal"),
          )
          .reduce(
            (sum, candidate) =>
              sum.plus(decimal(candidate.amount_jpy) ?? new Decimal(0)),
            new Decimal(0),
          );
        if (cumulativeJpy.gt(originalAmount))
          collector.add(
            pointer(operationPath, "amount_jpy"),
            "cumulative_lifecycle_amount_exceeds_original",
            "cumulative refunds/reversals exceed the original operation amount",
          );
      }
    }

    for (const [inputIndex, rawInput] of records(
      operation.asset_inputs,
    ).entries()) {
      const inputPath = pointer(operationPath, "asset_inputs", inputIndex);
      const inputId = asString(rawInput.input_id);
      if (inputId && seenInputs.has(inputId))
        collector.add(
          pointer(inputPath, "input_id"),
          "duplicate_asset_input_id",
          `duplicate asset input ID ${inputId}`,
        );
      if (inputId) seenInputs.add(inputId);
      const sourceLot = rawInput.source_lot_id;
      if (rawInput.role === "external_funding" && sourceLot !== null)
        collector.add(
          pointer(inputPath, "source_lot_id"),
          "external_funding_lot_forbidden",
          "external funding must not masquerade as an internal reusable lot",
        );
      if (typeof sourceLot === "string") {
        const declaredAt = allOutputLots.get(sourceLot);
        if (
          declaredAt !== undefined &&
          declaredAt >= Number(operation.sequence)
        )
          collector.add(
            pointer(inputPath, "source_lot_id"),
            "asset_consumption_before_creation",
            "asset lot is consumed before it is created",
          );
        else if (
          declaredAt === undefined &&
          initialLots.size > 0 &&
          !initialLots.has(sourceLot)
        )
          collector.add(
            pointer(inputPath, "source_lot_id"),
            "unknown_source_lot",
            `unknown source lot ${sourceLot}`,
          );
      }
      const amount = isRecord(rawInput.quantity)
        ? decimal(rawInput.quantity.amount)
        : undefined;
      if (amount && amount.isNegative())
        collector.add(
          pointer(inputPath, "quantity", "amount"),
          "negative_quantity",
          "asset input quantity must not be negative",
        );
    }

    for (const [outputIndex, rawOutput] of records(
      operation.output_requests,
    ).entries()) {
      const outputPath = pointer(operationPath, "output_requests", outputIndex);
      const requestId = asString(rawOutput.request_id);
      const lotId = asString(rawOutput.created_lot_id);
      if (requestId && seenOutputs.has(requestId))
        collector.add(
          pointer(outputPath, "request_id"),
          "duplicate_output_request_id",
          `duplicate output request ID ${requestId}`,
        );
      if (requestId) seenOutputs.add(requestId);
      if (lotId && (createdLots.has(lotId) || initialLots.has(lotId)))
        collector.add(
          pointer(outputPath, "created_lot_id"),
          "duplicate_created_lot_id",
          `duplicate created asset-lot ID ${lotId}`,
        );
      if (lotId) createdLots.add(lotId);
      const amount =
        rawOutput.requested_amount === null
          ? undefined
          : decimal(rawOutput.requested_amount);
      if (amount && amount.isNegative())
        collector.add(
          pointer(outputPath, "requested_amount"),
          "negative_quantity",
          "requested output quantity must not be negative",
        );
    }

    if (operation.operation_type === "merchant_purchase") {
      const lineItems = records(operation.line_items);
      lineItems.forEach((item, lineIndex) => {
        const taxExclusive = item.tax_exclusive_amount_jpy;
        if (
          taxExclusive !== undefined &&
          taxExclusive !== null &&
          (typeof taxExclusive !== "number" ||
            !Number.isSafeInteger(taxExclusive) ||
            taxExclusive < 0 ||
            (typeof item.amount_jpy === "number" &&
              taxExclusive > item.amount_jpy))
        )
          collector.add(
            pointer(
              operationPath,
              "line_items",
              lineIndex,
              "tax_exclusive_amount_jpy",
            ),
            "invalid_tax_exclusive_amount",
            "tax-exclusive line amount must be a safe non-negative integer no greater than the line tender amount",
          );
      });
      const total = lineItems.reduce(
        (sum, item) =>
          sum + (typeof item.amount_jpy === "number" ? item.amount_jpy : 0),
        0,
      );
      if (
        typeof operation.amount_jpy === "number" &&
        total !== operation.amount_jpy
      )
        collector.add(
          operationPath,
          "line_item_amount_mismatch",
          "line-item amounts must reconcile to operation amount",
        );
    }
  }

  const presentments = records(plan.loyalty_presentments);
  const presentmentKeys = presentments.map(
    (presentment) =>
      `${String(presentment.operation_id)}\u0000${String(presentment.loyalty_program_id)}\u0000${String(presentment.sequence)}`,
  );
  for (const duplicate of duplicateValues(presentmentKeys))
    collector.add(
      pointer(path, "loyalty_presentments"),
      "duplicate_loyalty_presentment",
      `duplicate loyalty presentment ${String(duplicate)}`,
    );
  presentments.forEach((presentment, index) => {
    if (
      typeof presentment.operation_id === "string" &&
      !byId.has(presentment.operation_id)
    )
      collector.add(
        pointer(path, "loyalty_presentments", index, "operation_id"),
        "presentment_unknown_operation",
        "loyalty presentment references an unknown operation",
      );
  });
}

function validateReview(
  review: unknown,
  path: string,
  collector: IssueCollector,
  approved: boolean,
): void {
  if (!isRecord(review)) return;
  const required = new Set(strings(review.required_review_modes));
  if (
    Array.isArray(review.required_review_modes) &&
    review.required_review_modes.length === 0
  )
    collector.add(
      pointer(path, "required_review_modes"),
      "required_review_modes_empty",
      "required_review_modes must not be empty",
    );
  const completed = new Set<string>();
  for (const [index, event] of records(review.review_events).entries()) {
    if (event.decision === "approved" && typeof event.mode === "string")
      completed.add(event.mode);
    if (
      event.decision === "approved" &&
      event.mode === "agent_challenged" &&
      required.has("human_second_review")
    ) {
      // The event is retained as a challenge, but it cannot satisfy a distinct
      // human mode; the missing-mode check below remains authoritative.
      completed.delete("human_second_review");
    }
    if (event.decision === "approved" && event.mode === undefined)
      collector.add(
        pointer(path, "review_events", index, "mode"),
        "review_event_mode_required",
        "approved review event requires a mode",
      );
  }
  if (approved) {
    const missing = [...required].filter((mode) => !completed.has(mode));
    if (missing.length > 0)
      collector.add(
        pointer(path, "required_review_modes"),
        "required_review_mode_missing",
        `required review modes not completed: ${missing.sort().join(", ")}`,
      );
    if (
      typeof review.review_mode === "string" &&
      !completed.has(review.review_mode)
    )
      collector.add(
        pointer(path, "review_mode"),
        "primary_review_mode_missing",
        "primary review mode has no approved completion event",
      );
  }
}

function validateRule(
  rule: RecordValue,
  path: string,
  collector: IssueCollector,
  options: SemanticValidationOptions,
): void {
  const validity = isRecord(rule.validity) ? rule.validity : undefined;
  const validFrom = parseTime(validity?.valid_from);
  const validTo = parseTime(validity?.valid_to);
  const recordedAt = parseTime(validity?.recorded_at);
  const supersededAt = parseTime(validity?.superseded_at);
  if (validFrom !== undefined && validTo !== undefined && validTo <= validFrom)
    collector.add(
      pointer(path, "validity"),
      "economic_interval_order",
      "valid_to must be strictly after valid_from",
    );
  if (
    recordedAt !== undefined &&
    supersededAt !== undefined &&
    supersededAt <= recordedAt
  )
    collector.add(
      pointer(path, "validity"),
      "system_interval_order",
      "superseded_at must be strictly after recorded_at",
    );

  const calculation = isRecord(rule.calculation) ? rule.calculation : undefined;
  const scope = isRecord(rule.scope) ? rule.scope : undefined;
  const eligibility = isRecord(rule.eligibility) ? rule.eligibility : undefined;
  const transactionConditions = isRecord(eligibility?.transaction_conditions)
    ? eligibility.transaction_conditions
    : undefined;
  if (
    scope?.tax_basis === "tax_exclusive" &&
    transactionConditions?.eligible_amount_basis !== "eligible_line_items"
  )
    collector.add(
      pointer(
        path,
        "eligibility",
        "transaction_conditions",
        "eligible_amount_basis",
      ),
      "tax_exclusive_basis_requires_eligible_line_items",
      "tax-exclusive rules must calculate from explicit eligible line-item amounts",
    );
  if (
    calculation?.model === "points_per_unit" &&
    isRecord(calculation.rounding) &&
    calculation.rounding.eligible_spend_quantum_jpy === null
  )
    collector.add(
      pointer(path, "calculation", "rounding", "eligible_spend_quantum_jpy"),
      "points_quantum_required",
      "points_per_unit calculation requires eligible_spend_quantum_jpy",
    );
  if (calculation?.model === "transfer_ratio") {
    const minimum = decimal(calculation.minimum_source_units);
    const increment = decimal(calculation.increment_source_units);
    const requestMax = decimal(calculation.maximum_source_units_per_request);
    if (minimum && !minimum.gt(0))
      collector.add(
        pointer(path, "calculation", "minimum_source_units"),
        "transfer_minimum_positive",
        "transfer minimum must be positive",
      );
    if (increment && !increment.gt(0))
      collector.add(
        pointer(path, "calculation", "increment_source_units"),
        "transfer_increment_positive",
        "transfer increment must be positive",
      );
    if (minimum && requestMax && requestMax.lt(minimum))
      collector.add(
        pointer(path, "calculation", "maximum_source_units_per_request"),
        "transfer_max_below_minimum",
        "transfer per-request maximum must not be below minimum",
      );
  }

  records(rule.caps).forEach((cap, index) => {
    if (cap.max_reward_units === null && cap.max_eligible_spend_jpy === null)
      collector.add(
        pointer(path, "caps", index),
        "cap_limit_required",
        "cap must define a reward or spend maximum",
      );
    const reset = isRecord(cap.reset) ? cap.reset : undefined;
    if (
      reset?.period !== "never" &&
      typeof reset?.timezone === "string" &&
      reset.timezone.length === 0
    )
      collector.add(
        pointer(path, "caps", index, "reset", "timezone"),
        "cap_timezone_required",
        "resetting cap requires timezone",
      );
  });

  const output = isRecord(rule.output) ? rule.output : undefined;
  const certainty = isRecord(output?.certainty) ? output.certainty : undefined;
  if (certainty?.type === "probabilistic") {
    if (
      certainty.probability_source === null ||
      certainty.probability_source === undefined
    )
      collector.add(
        pointer(path, "output", "certainty", "probability_source"),
        "probability_source_required",
        "probabilistic reward requires probability_source",
      );
    if (
      (certainty.probability_source === "official_disclosed" ||
        certainty.probability_source === "historical_estimate") &&
      (certainty.probability === null || certainty.probability === undefined)
    )
      collector.add(
        pointer(path, "output", "certainty", "probability"),
        "probability_required",
        "disclosed or historical probability source requires probability",
      );
  }
  const status = rule.status;
  validateReview(
    rule.audit,
    pointer(path, "audit"),
    collector,
    status === "published",
  );
  if (options.relatedRules)
    collectBitemporalVersionIssues(options.relatedRules, collector, path);
}

function intervalOverlaps(
  leftStart: number | undefined,
  leftEnd: number | undefined,
  rightStart: number | undefined,
  rightEnd: number | undefined,
): boolean {
  const a = leftStart ?? Number.NEGATIVE_INFINITY;
  const b = leftEnd ?? Number.POSITIVE_INFINITY;
  const c = rightStart ?? Number.NEGATIVE_INFINITY;
  const d = rightEnd ?? Number.POSITIVE_INFINITY;
  return a < d && c < b;
}

function collectBitemporalVersionIssues(
  rules: readonly RewardRule[],
  collector: IssueCollector,
  path: string,
): void {
  for (let leftIndex = 0; leftIndex < rules.length; leftIndex += 1) {
    const left = rules[leftIndex] as unknown;
    if (
      !isRecord(left) ||
      left.status !== "published" ||
      !isRecord(left.validity)
    )
      continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < rules.length;
      rightIndex += 1
    ) {
      const right = rules[rightIndex] as unknown;
      if (
        !isRecord(right) ||
        right.status !== "published" ||
        right.rule_id !== left.rule_id ||
        !isRecord(right.validity)
      )
        continue;
      const economicOverlap = intervalOverlaps(
        parseTime(left.validity.valid_from),
        parseTime(left.validity.valid_to),
        parseTime(right.validity.valid_from),
        parseTime(right.validity.valid_to),
      );
      const systemOverlap = intervalOverlaps(
        parseTime(left.validity.recorded_at),
        parseTime(left.validity.superseded_at),
        parseTime(right.validity.recorded_at),
        parseTime(right.validity.superseded_at),
      );
      if (economicOverlap && systemOverlap)
        collector.add(
          path,
          "approved_bitemporal_overlap",
          `approved rule versions at indexes ${leftIndex} and ${rightIndex} overlap in economic and system time`,
        );
    }
  }
}

/** Validate the full bitemporal non-overlap rule for a set of approved versions. */
export function validateBitemporalVersions(
  rules: readonly RewardRule[],
): ValidationResult<readonly RewardRule[]> {
  const collector = new IssueCollector();
  collectBitemporalVersionIssues(rules, collector, "");
  const issues = sortIssues(collector.items);
  if (issues.length > 0) return { valid: false, issues, errors: issues };
  return success(rules);
}

export function validateBitemporalReplay(
  rules: readonly RewardRule[],
  transactionTime: string | Date,
  replayKnowledgeTime: string | Date,
): ValidationResult<readonly RewardRule[]> {
  const collector = new IssueCollector();
  const tx = parseTime(transactionTime);
  const replay = parseTime(replayKnowledgeTime);
  if (tx === undefined)
    collector.add(
      "",
      "invalid_transaction_time",
      "transactionTime must be a valid date-time",
    );
  if (replay === undefined)
    collector.add(
      "",
      "invalid_replay_knowledge_time",
      "replayKnowledgeTime must be a valid date-time",
    );
  const matches = new Map<string, number[]>();
  if (tx !== undefined && replay !== undefined) {
    rules.forEach((rule, index) => {
      if (
        !isRecord(rule) ||
        rule.status !== "published" ||
        !isRecord(rule.validity)
      )
        return;
      const validFrom = parseTime(rule.validity.valid_from);
      const validTo = parseTime(rule.validity.valid_to);
      const recordedAt = parseTime(rule.validity.recorded_at);
      const supersededAt = parseTime(rule.validity.superseded_at);
      const inEconomic =
        validFrom !== undefined &&
        tx >= validFrom &&
        (validTo === undefined || tx < validTo);
      const inSystem =
        recordedAt !== undefined &&
        replay >= recordedAt &&
        (supersededAt === undefined || replay < supersededAt);
      if (inEconomic && inSystem) {
        const key = String(rule.rule_id);
        matches.set(key, [...(matches.get(key) ?? []), index]);
      }
    });
  }
  for (const [ruleId, indexes] of matches) {
    if (indexes.length > 1)
      collector.add(
        "",
        "ambiguous_bitemporal_replay",
        `replay point matches ${indexes.length} approved versions of ${ruleId}`,
      );
  }
  return collector.result(rules);
}

function bucket(quantity: unknown): string | undefined {
  if (!isRecord(quantity) || !isRecord(quantity.asset)) return undefined;
  return `${String(quantity.asset.asset_id)}\u0000${String(quantity.asset.reward_class)}`;
}

function validateConservation(
  result: RecordValue,
  openingLots: readonly unknown[],
  path: string,
  collector: IssueCollector,
): void {
  const opening = new Map<string, Decimal>();
  for (const lot of openingLots) {
    if (!isRecord(lot)) continue;
    const key = bucket(lot.quantity);
    const amount = isRecord(lot.quantity)
      ? decimal(lot.quantity.amount)
      : undefined;
    if (key && amount)
      opening.set(key, (opening.get(key) ?? new Decimal(0)).plus(amount));
  }
  const movementNet = new Map<string, Decimal>();
  const affected = new Set<string>();
  for (const [index, movement] of records(result.asset_movements).entries()) {
    const movementPath = pointer(path, "asset_movements", index);
    if (movement.direction === "adjust")
      collector.add(
        movementPath,
        "generic_adjust_forbidden",
        "generic adjust movements are forbidden in v0.4.1",
      );
    if (
      movement.movement_role === "external_funding" ||
      movement.movement_role === "fee"
    )
      continue;
    const key = bucket(movement.quantity);
    const amount = isRecord(movement.quantity)
      ? decimal(movement.quantity.amount)
      : undefined;
    if (!key || !amount) continue;
    affected.add(key);
    if (amount.isNegative())
      collector.add(
        pointer(movementPath, "quantity", "amount"),
        "negative_quantity",
        "movement quantity must not be negative",
      );
    const signed =
      movement.direction === "consume" || movement.direction === "expire"
        ? amount.neg()
        : movement.direction === "create" || movement.direction === "return"
          ? amount
          : undefined;
    if (signed === undefined) {
      collector.add(
        pointer(movementPath, "direction"),
        "unsupported_movement_direction",
        `unsupported movement direction ${String(movement.direction)}`,
      );
    } else {
      movementNet.set(
        key,
        (movementNet.get(key) ?? new Decimal(0)).plus(signed),
      );
    }
  }
  const ending = new Map<string, Decimal>();
  for (const lot of records(result.ending_asset_lots)) {
    const key = bucket(lot.quantity);
    const amount = isRecord(lot.quantity)
      ? decimal(lot.quantity.amount)
      : undefined;
    if (key && amount) {
      ending.set(key, (ending.get(key) ?? new Decimal(0)).plus(amount));
      affected.add(key);
    }
  }
  for (const key of affected) {
    const expected = (opening.get(key) ?? new Decimal(0)).plus(
      movementNet.get(key) ?? new Decimal(0),
    );
    const actual = ending.get(key) ?? new Decimal(0);
    if (!expected.eq(actual)) {
      const [assetId, rewardClass] = key.split("\u0000");
      collector.add(
        path,
        "asset_conservation_failed",
        `asset conservation failed for ${assetId}/${rewardClass}: expected ending ${expected.toString()}, found ${actual.toString()}`,
      );
    }
  }
}

function validateResult(
  result: RecordValue,
  path: string,
  plan: RecordValue,
  openingLots: readonly unknown[],
  objective: unknown,
  collector: IssueCollector,
): void {
  const operationIds = new Set(
    records(plan.operations).map((operation) => operation.operation_id),
  );
  const movementIds = records(result.asset_movements).map(
    (movement) => movement.movement_id,
  );
  for (const duplicate of duplicateValues(movementIds))
    collector.add(
      pointer(path, "asset_movements"),
      "duplicate_movement_id",
      `duplicate movement ID ${String(duplicate)}`,
    );
  records(result.asset_movements).forEach((movement, index) => {
    const movementPath = pointer(path, "asset_movements", index);
    if (
      typeof movement.operation_id === "string" &&
      !operationIds.has(movement.operation_id)
    )
      collector.add(
        pointer(movementPath, "operation_id"),
        "movement_unknown_operation",
        "movement references an operation outside its plan",
      );
    const amount = isRecord(movement.quantity)
      ? decimal(movement.quantity.amount)
      : undefined;
    if (amount && amount.isNegative())
      collector.add(
        pointer(movementPath, "quantity", "amount"),
        "negative_quantity",
        "movement quantity must not be negative",
      );
  });
  const componentIds = records(result.reward_components).map(
    (component) => component.component_id,
  );
  for (const duplicate of duplicateValues(componentIds))
    collector.add(
      pointer(path, "reward_components"),
      "duplicate_reward_component_id",
      `duplicate reward component ID ${String(duplicate)}`,
    );
  records(result.reward_components).forEach((component, index) => {
    const componentPath = pointer(path, "reward_components", index);
    if (
      typeof component.operation_id === "string" &&
      !operationIds.has(component.operation_id)
    )
      collector.add(
        pointer(componentPath, "operation_id"),
        "component_unknown_operation",
        "reward component references an operation outside its plan",
      );
    addRangeIssue(
      collector,
      component.value_jpy,
      pointer(componentPath, "value_jpy"),
    );
    const certainty = isRecord(component.certainty)
      ? component.certainty
      : undefined;
    if (certainty?.type === "probabilistic") {
      if (
        certainty.probability_source === null ||
        certainty.probability_source === undefined
      )
        collector.add(
          pointer(componentPath, "certainty", "probability_source"),
          "probability_source_required",
          "probabilistic reward requires probability_source",
        );
      if (
        (certainty.probability_source === "official_disclosed" ||
          certainty.probability_source === "historical_estimate") &&
        (certainty.probability === null || certainty.probability === undefined)
      )
        collector.add(
          pointer(componentPath, "certainty", "probability"),
          "probability_required",
          "disclosed or historical probability source requires probability",
        );
    }
  });
  const endingIds = records(result.ending_asset_lots).map((lot) => lot.lot_id);
  for (const duplicate of duplicateValues(endingIds))
    collector.add(
      pointer(path, "ending_asset_lots"),
      "duplicate_ending_lot_id",
      `duplicate ending asset-lot ID ${String(duplicate)}`,
    );
  records(result.ending_asset_lots).forEach((lot, index) => {
    validateLot(lot, pointer(path, "ending_asset_lots", index), collector);
  });
  validateConservation(result, openingLots, path, collector);

  const economics = isRecord(result.economics) ? result.economics : undefined;
  if (economics) {
    for (const [field, value] of Object.entries(economics))
      addRangeIssue(collector, value, pointer(path, "economics", field));
    addRangeIssue(
      collector,
      result.objective_score_jpy,
      pointer(path, "objective_score_jpy"),
    );
    const exact = new Map<string, number | undefined>();
    for (const [field, value] of Object.entries(economics)) {
      exact.set(
        field,
        isRecord(value) &&
          value.minimum_jpy === value.maximum_jpy &&
          typeof value.minimum_jpy === "number"
          ? value.minimum_jpy
          : undefined,
      );
    }
    const guaranteedFields = [
      "merchant_value_received_jpy",
      "ending_asset_value_jpy",
      "guaranteed_reward_value_jpy",
      "external_funding_jpy",
      "opening_asset_value_consumed_jpy",
      "fee_value_jpy",
      "guaranteed_net_value_change_jpy",
    ];
    if (guaranteedFields.every((field) => exact.get(field) !== undefined)) {
      const guaranteed =
        (exact.get("merchant_value_received_jpy") ?? 0) +
        (exact.get("ending_asset_value_jpy") ?? 0) +
        (exact.get("guaranteed_reward_value_jpy") ?? 0) -
        (exact.get("external_funding_jpy") ?? 0) -
        (exact.get("opening_asset_value_consumed_jpy") ?? 0) -
        (exact.get("fee_value_jpy") ?? 0);
      if (exact.get("guaranteed_net_value_change_jpy") !== guaranteed)
        collector.add(
          pointer(path, "economics", "guaranteed_net_value_change_jpy"),
          "economic_reconciliation_failed",
          "guaranteed economics do not reconcile",
        );
      const expected = exact.get("probabilistic_expected_reward_value_jpy");
      const expectedNet = exact.get("expected_net_value_change_jpy");
      if (
        expected !== undefined &&
        expectedNet !== undefined &&
        expectedNet !== guaranteed + expected
      )
        collector.add(
          pointer(path, "economics", "expected_net_value_change_jpy"),
          "economic_reconciliation_failed",
          "expected economics do not reconcile",
        );
      let guaranteedComponents = 0;
      let probabilisticComponents = 0;
      let allComponentExact = true;
      for (const component of records(result.reward_components)) {
        const value =
          isRecord(component.value_jpy) &&
          component.value_jpy.minimum_jpy === component.value_jpy.maximum_jpy &&
          typeof component.value_jpy.minimum_jpy === "number"
            ? component.value_jpy.minimum_jpy
            : undefined;
        if (value === undefined) {
          allComponentExact = false;
          break;
        }
        const signed = component.sign === "debit" ? -value : value;
        const certainty = isRecord(component.certainty)
          ? component.certainty.type
          : undefined;
        if (certainty === "guaranteed") guaranteedComponents += signed;
        else if (certainty === "probabilistic")
          probabilisticComponents += signed;
      }
      if (allComponentExact) {
        if (exact.get("guaranteed_reward_value_jpy") !== guaranteedComponents)
          collector.add(
            pointer(path, "economics", "guaranteed_reward_value_jpy"),
            "reward_reconciliation_failed",
            "guaranteed reward components do not reconcile to economics",
          );
        if (
          exact.get("probabilistic_expected_reward_value_jpy") !==
          probabilisticComponents
        )
          collector.add(
            pointer(
              path,
              "economics",
              "probabilistic_expected_reward_value_jpy",
            ),
            "reward_reconciliation_failed",
            "probabilistic reward components do not reconcile to economics",
          );
      }
    }
    const score =
      isRecord(result.objective_score_jpy) &&
      result.objective_score_jpy.minimum_jpy ===
        result.objective_score_jpy.maximum_jpy &&
      typeof result.objective_score_jpy.minimum_jpy === "number"
        ? result.objective_score_jpy.minimum_jpy
        : undefined;
    const primary = isRecord(objective) ? objective.primary : undefined;
    if (score !== undefined && primary === "maximize_guaranteed_net_value") {
      const guaranteed = exact.get("guaranteed_net_value_change_jpy");
      if (guaranteed !== undefined && score !== guaranteed)
        collector.add(
          pointer(path, "objective_score_jpy"),
          "objective_score_mismatch",
          "objective score must equal guaranteed net value",
        );
    }
    if (score !== undefined && primary === "maximize_expected_net_value") {
      const expected = exact.get("expected_net_value_change_jpy");
      if (expected !== undefined && score !== expected)
        collector.add(
          pointer(path, "objective_score_jpy"),
          "objective_score_mismatch",
          "objective score must equal expected net value",
        );
    }
  }
}

function purchaseSignature(plan: RecordValue): string {
  const signatures = records(plan.operations)
    .filter((operation) => operation.operation_type === "merchant_purchase")
    .map((operation) => ({
      merchant_id: operation.merchant_id,
      merchant_location_id: operation.merchant_location_id,
      channel: operation.channel,
      amount_jpy: operation.amount_jpy,
      line_items: records(operation.line_items)
        .map((item) => [
          item.product_class,
          item.amount_jpy,
          item.tax_exclusive_amount_jpy ?? null,
          item.quantity,
        ])
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        ),
    }));
  return canonicalize(signatures);
}

function sameStringSet(left: unknown, right: unknown): boolean {
  const leftValues = strings(left);
  const rightValues = strings(right);
  return (
    leftValues.length === rightValues.length &&
    new Set(leftValues).size === leftValues.length &&
    new Set(rightValues).size === rightValues.length &&
    leftValues.every((value) => rightValues.includes(value))
  );
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  try {
    return canonicalize(left) === canonicalize(right);
  } catch {
    return false;
  }
}

function ruleBindingKey(ruleId: unknown, version: unknown): string | undefined {
  if (typeof ruleId !== "string" || !Number.isInteger(version))
    return undefined;
  return `${ruleId}\u0000${String(version)}`;
}

function validateRuleVersionBindings(
  scenario: RecordValue,
  path: string,
  collector: IssueCollector,
  options: SemanticValidationOptions,
): Map<string, RecordValue[]> {
  const bindings = records(scenario.rule_version_bindings);
  const topEvidenceIds = new Set(strings(scenario.evidence_ids));
  const byRule = new Map<string, RecordValue[]>();
  const byVersion = new Map<string, RecordValue>();

  bindings.forEach((binding, index) => {
    const bindingPath = pointer(path, "rule_version_bindings", index);
    const ruleId = binding.rule_id;
    const version = binding.version;
    const key = ruleBindingKey(ruleId, version);
    if (key !== undefined) {
      const previous = byVersion.get(key);
      if (previous !== undefined) {
        collector.add(
          bindingPath,
          "duplicate_rule_version_binding",
          `duplicate rule binding for ${String(ruleId)} version ${String(version)}`,
        );
      } else {
        byVersion.set(key, binding);
      }
      const entries = byRule.get(String(ruleId)) ?? [];
      entries.push(binding);
      byRule.set(String(ruleId), entries);
    }

    for (const evidenceId of strings(binding.evidence_ids)) {
      if (!topEvidenceIds.has(evidenceId))
        collector.add(
          pointer(bindingPath, "evidence_ids"),
          "binding_evidence_missing",
          `binding evidence ${evidenceId} is absent from top-level evidence_ids`,
        );
    }

    if (!options.relatedRules) return;
    const related = options.relatedRules.find(
      (rule) =>
        isRecord(rule) && rule.rule_id === ruleId && rule.version === version,
    );
    if (!related) {
      collector.add(
        bindingPath,
        "rule_binding_missing_related_rule",
        `no related rule matches ${String(ruleId)} version ${String(version)}`,
      );
      return;
    }
    const expectedDefinitionHash = definitionHash(related);
    if (binding.definition_hash !== expectedDefinitionHash)
      collector.add(
        pointer(bindingPath, "definition_hash"),
        "rule_binding_definition_hash_mismatch",
        "rule binding definition_hash does not match the related rule definition",
      );
    if (!sameCanonicalValue(binding.validity, related.validity))
      collector.add(
        pointer(bindingPath, "validity"),
        "rule_binding_validity_mismatch",
        "rule binding validity does not match the related rule",
      );
    if (binding.source_candidate_status !== related.status)
      collector.add(
        pointer(bindingPath, "source_candidate_status"),
        "rule_binding_status_mismatch",
        "rule binding source_candidate_status does not match the related rule",
      );
    const relatedProvenance = isRecord(related.provenance)
      ? related.provenance
      : undefined;
    if (!sameStringSet(binding.evidence_ids, relatedProvenance?.evidence_ids))
      collector.add(
        pointer(bindingPath, "evidence_ids"),
        "rule_binding_evidence_mismatch",
        "rule binding evidence_ids do not match the related rule provenance",
      );
  });

  for (const [ruleId, entries] of byRule) {
    if (new Set(entries.map((entry) => entry.version)).size > 1)
      collector.add(
        pointer(path, "rule_version_bindings"),
        "multiple_rule_versions_binding",
        `rule ${ruleId} has more than one bound version; result rule IDs would be ambiguous`,
      );
  }

  return byRule;
}

function validateReplayProvenance(
  scenario: RecordValue,
  path: string,
  collector: IssueCollector,
): void {
  const replay = isRecord(scenario.replay_provenance)
    ? scenario.replay_provenance
    : undefined;
  if (
    replay?.rule_admission === "ephemeral_published_clone" &&
    replay.publication_authorized !== false
  )
    collector.add(
      pointer(path, "replay_provenance", "publication_authorized"),
      "ephemeral_publication_authorized",
      "ephemeral_published_clone replay admission must not be publication-authorized",
    );
}

function validateResultProvenance(
  result: RecordValue,
  path: string,
  collector: IssueCollector,
): void {
  const origin = result.result_origin;
  const rejection = result.preflight_rejection;
  if (origin === "engine") {
    if (rejection !== null)
      collector.add(
        pointer(path, "preflight_rejection"),
        "engine_preflight_rejection_forbidden",
        "engine results must have a null preflight_rejection",
      );
    return;
  }
  if (origin !== "preflight") return;

  const rejectionKeys = isRecord(rejection)
    ? Object.keys(rejection).sort()
    : [];
  const validRejection =
    isRecord(rejection) &&
    rejectionKeys.length === 2 &&
    rejectionKeys[0] === "rejection_code" &&
    rejectionKeys[1] === "reward_calculation_performed" &&
    typeof rejection.rejection_code === "string" &&
    rejection.rejection_code.length > 0 &&
    rejection.reward_calculation_performed === false;
  const emptyLedger =
    Array.isArray(result.asset_movements) &&
    result.asset_movements.length === 0 &&
    Array.isArray(result.reward_components) &&
    result.reward_components.length === 0 &&
    Array.isArray(result.ending_asset_lots) &&
    result.ending_asset_lots.length === 0;
  if (result.eligible !== false || !emptyLedger || !validRejection)
    collector.add(
      path,
      "preflight_result_invalid",
      "preflight results must be ineligible, have empty movement/reward/lot ledgers, and carry the exact rejection metadata",
    );
}

function validateGolden(
  scenario: RecordValue,
  path: string,
  collector: IssueCollector,
  options: SemanticValidationOptions,
): void {
  const ruleBindingsByRule = validateRuleVersionBindings(
    scenario,
    path,
    collector,
    options,
  );
  validateReplayProvenance(scenario, path, collector);
  const assetDefinitions = records(scenario.asset_definitions);
  const assetIds = assetDefinitions
    .map((asset) => asset.asset_id)
    .filter((assetId): assetId is string => typeof assetId === "string");
  for (const duplicate of duplicateValues(assetIds))
    collector.add(
      pointer(path, "asset_definitions"),
      "duplicate_asset_definition_id",
      `duplicate asset definition ID ${String(duplicate)}`,
    );
  validateUserState(
    isRecord(scenario.user_state) ? scenario.user_state : {},
    pointer(path, "user_state"),
    collector,
  );
  validateReview(
    scenario.review,
    pointer(path, "review"),
    collector,
    scenario.status === "golden" ||
      (isRecord(scenario.review) && scenario.review.decision === "approved"),
  );
  const openingLots =
    isRecord(scenario.user_state) &&
    Array.isArray(scenario.user_state.asset_lots)
      ? scenario.user_state.asset_lots
      : [];
  const openingLotIds = openingLots
    .filter(isRecord)
    .map((lot) => lot.lot_id)
    .filter((id): id is string => typeof id === "string");
  const plans = records(scenario.candidate_plans);
  const planIds = plans.map((plan) => plan.plan_id);
  for (const duplicate of duplicateValues(planIds))
    collector.add(
      pointer(path, "candidate_plans"),
      "duplicate_plan_id",
      `duplicate plan ID ${String(duplicate)}`,
    );
  plans.forEach((plan, index) => {
    validatePlan(plan, pointer(path, "candidate_plans", index), collector, {
      ...options,
      openingLots,
      openingLotIds,
    });
  });
  if (plans.length > 1) {
    const signatures = plans.map(purchaseSignature);
    if (
      signatures.every((signature) => signature !== canonicalize([])) &&
      new Set(signatures).size !== 1
    )
      collector.add(
        pointer(path, "candidate_plans"),
        "frozen_purchase_mismatch",
        "candidate plans must complete the same frozen purchase",
      );
  }
  const expected = isRecord(scenario.expected) ? scenario.expected : {};
  const results = records(expected.plan_results);
  const resultIds = results.map((result) => result.plan_id);
  if (
    new Set(resultIds).size !== new Set(planIds).size ||
    resultIds.some((id) => !planIds.includes(id)) ||
    planIds.some((id) => !resultIds.includes(id))
  )
    collector.add(
      pointer(path, "expected", "plan_results"),
      "plan_results_mismatch",
      "plan results must contain every candidate plan exactly once",
    );
  const mode = expected.outcome_mode;
  const winner = expected.definite_winner_plan_id;
  const safe = expected.safe_plan_id;
  const conditional = Array.isArray(expected.conditional_winners)
    ? expected.conditional_winners
    : [];
  if (
    mode === "definite" &&
    (typeof winner !== "string" ||
      typeof safe !== "string" ||
      conditional.length > 0)
  )
    collector.add(
      pointer(path, "expected"),
      "definite_outcome_incomplete",
      "definite outcome requires winner, safe plan, and no conditional winners",
    );
  if (mode === "conditional" && (winner !== null || conditional.length === 0))
    collector.add(
      pointer(path, "expected"),
      "conditional_outcome_incomplete",
      "conditional outcome requires conditional winners and no definite winner",
    );
  if (
    mode === "no_valid_plan" &&
    [winner, safe, expected.runner_up_plan_id].some((value) => value !== null)
  )
    collector.add(
      pointer(path, "expected"),
      "no_valid_plan_named",
      "no_valid_plan cannot name winner, safe plan, or runner-up",
    );
  if (typeof safe === "string" && !planIds.includes(safe))
    collector.add(
      pointer(path, "expected", "safe_plan_id"),
      "unknown_safe_plan",
      "safe plan references an unknown plan",
    );
  if (typeof winner === "string" && !planIds.includes(winner))
    collector.add(
      pointer(path, "expected", "definite_winner_plan_id"),
      "unknown_winner_plan",
      "winner references an unknown plan",
    );
  if (
    typeof expected.runner_up_plan_id === "string" &&
    (!planIds.includes(expected.runner_up_plan_id) ||
      expected.runner_up_plan_id === winner)
  )
    collector.add(
      pointer(path, "expected", "runner_up_plan_id"),
      "invalid_runner_up",
      "runner-up must reference a distinct candidate plan",
    );
  const planById = new Map(plans.map((plan) => [String(plan.plan_id), plan]));
  results.forEach((result, index) => {
    const resultPath = pointer(path, "expected", "plan_results", index);
    validateResultProvenance(result, resultPath, collector);
    for (const [field, code] of [
      ["applied_rule_ids", "applied_rule_binding_missing"],
      ["rejected_rule_ids", "rejected_rule_binding_missing"],
    ] as const) {
      strings(result[field]).forEach((ruleId, ruleIndex) => {
        const bindings = ruleBindingsByRule.get(ruleId);
        if (!bindings)
          collector.add(
            pointer(resultPath, field, ruleIndex),
            code,
            `${field} references rule ${ruleId}, which has no rule_version_binding`,
          );
        else {
          const role = field === "applied_rule_ids" ? "applied" : "rejected";
          if (
            !bindings.some((binding) => strings(binding.roles).includes(role))
          )
            collector.add(
              pointer(resultPath, field, ruleIndex),
              `${field === "applied_rule_ids" ? "applied" : "rejected"}_rule_binding_role_missing`,
              `${field} references rule ${ruleId}, but no binding carries the ${role} role`,
            );
        }
      });
    }
    const plan =
      typeof result.plan_id === "string"
        ? planById.get(result.plan_id)
        : undefined;
    if (plan)
      validateResult(
        result,
        resultPath,
        plan,
        openingLots,
        scenario.objective,
        collector,
      );
  });
  if (mode === "definite") {
    const exactScores = new Map<string, number>();
    results.forEach((result) => {
      const score =
        isRecord(result.objective_score_jpy) &&
        result.objective_score_jpy.minimum_jpy ===
          result.objective_score_jpy.maximum_jpy &&
        typeof result.objective_score_jpy.minimum_jpy === "number"
          ? result.objective_score_jpy.minimum_jpy
          : undefined;
      if (typeof result.plan_id === "string" && score !== undefined)
        exactScores.set(result.plan_id, score);
    });
    if (exactScores.size === plans.length && typeof winner === "string") {
      const best = Math.max(...exactScores.values());
      if (exactScores.get(winner) !== best)
        collector.add(
          pointer(path, "expected", "definite_winner_plan_id"),
          "winner_score_mismatch",
          "definite winner does not have the highest exact objective score",
        );
    }
  }
  const sensitivities = Array.isArray(expected.valuation_sensitivities)
    ? expected.valuation_sensitivities
    : [];
  if (
    sensitivities.length > 0 &&
    isRecord(scenario.user_state) &&
    isRecord(scenario.user_state.valuation_profile)
  ) {
    for (const [index, sensitivity] of records(sensitivities).entries()) {
      const sensitivityPath = pointer(
        path,
        "expected",
        "valuation_sensitivities",
        index,
      );
      const entries = Array.isArray(
        scenario.user_state.valuation_profile.entries,
      )
        ? records(scenario.user_state.valuation_profile.entries)
        : [];
      const match = entries.find(
        (entry) =>
          entry.asset_id === sensitivity.asset_id &&
          entry.reward_class === sensitivity.reward_class,
      );
      if (!match) {
        collector.add(
          sensitivityPath,
          "valuation_entry_missing",
          "valuation sensitivity references no matching valuation entry",
        );
        continue;
      }
      if (match.jpy_per_unit !== sensitivity.current_jpy_per_unit)
        collector.add(
          pointer(sensitivityPath, "current_jpy_per_unit"),
          "valuation_current_mismatch",
          "current valuation does not match the valuation profile",
        );
      const low =
        typeof sensitivity.winner_at_or_below_threshold_plan_id === "string"
          ? results.find(
              (result) =>
                result.plan_id ===
                sensitivity.winner_at_or_below_threshold_plan_id,
            )
          : undefined;
      const high =
        typeof sensitivity.winner_above_threshold_plan_id === "string"
          ? results.find(
              (result) =>
                result.plan_id === sensitivity.winner_above_threshold_plan_id,
            )
          : undefined;
      if (!low || !high || low.plan_id === high.plan_id) {
        collector.add(
          sensitivityPath,
          "valuation_sensitivity_plans",
          "valuation sensitivity must reference two distinct candidate plans",
        );
        continue;
      }
      const lowEconomics = isRecord(low.economics)
        ? low.economics.guaranteed_net_value_change_jpy
        : undefined;
      const highEconomics = isRecord(high.economics)
        ? high.economics.guaranteed_net_value_change_jpy
        : undefined;
      const lowNet =
        isRecord(lowEconomics) &&
        lowEconomics.minimum_jpy === lowEconomics.maximum_jpy
          ? decimal(lowEconomics.minimum_jpy)
          : undefined;
      const highNet =
        isRecord(highEconomics) &&
        highEconomics.minimum_jpy === highEconomics.maximum_jpy
          ? decimal(highEconomics.minimum_jpy)
          : undefined;
      if (!lowNet || !highNet) continue;
      const quantity = (result: RecordValue): Decimal =>
        records(result.ending_asset_lots).reduce((sum, lot) => {
          const q = isRecord(lot.quantity) ? lot.quantity : undefined;
          const a = isRecord(q?.asset) ? q.asset : undefined;
          return a?.asset_id === sensitivity.asset_id &&
            a?.reward_class === sensitivity.reward_class
            ? sum.plus(decimal(q?.amount) ?? 0)
            : sum;
        }, new Decimal(0));
      const lowQuantity = quantity(low);
      const highQuantity = quantity(high);
      const delta = highQuantity.minus(lowQuantity);
      const current = decimal(sensitivity.current_jpy_per_unit);
      const declared = decimal(sensitivity.break_even_jpy_per_unit);
      if (current && declared && !delta.isZero()) {
        const computed = lowNet
          .minus(lowQuantity.times(current))
          .minus(highNet.minus(highQuantity.times(current)))
          .div(delta);
        if (computed.minus(declared).abs().gt(new Decimal("1e-18")))
          collector.add(
            pointer(sensitivityPath, "break_even_jpy_per_unit"),
            "break_even_mismatch",
            "declared break-even valuation does not match native economics",
          );
        const expectedWinner = current.lte(declared)
          ? low.plan_id
          : high.plan_id;
        if (winner !== expectedWinner)
          collector.add(
            sensitivityPath,
            "valuation_winner_mismatch",
            "current valuation implies a different winner",
          );
      }
    }
  }
}

function validateAsset(
  asset: RecordValue,
  path: string,
  collector: IssueCollector,
): void {
  validateExpiry(
    asset.default_expiry,
    pointer(path, "default_expiry"),
    collector,
  );
}

function validateEvidence(
  evidence: RecordValue,
  path: string,
  collector: IssueCollector,
): void {
  const validTime = isRecord(evidence.valid_time)
    ? evidence.valid_time
    : undefined;
  const from = parseTime(validTime?.valid_from);
  const to = parseTime(validTime?.valid_to);
  if (from !== undefined && to !== undefined && to <= from)
    collector.add(
      pointer(path, "valid_time"),
      "evidence_interval_order",
      "valid_to must be strictly after valid_from",
    );
  validateReview(
    evidence.review,
    pointer(path, "review"),
    collector,
    evidence.status === "verified",
  );
}

function validateExtraction(
  candidate: RecordValue,
  path: string,
  collector: IssueCollector,
): void {
  const flags = records(candidate.security_flags);
  const hostile = flags.some(
    (flag) =>
      flag.flag_type === "embedded_instruction" ||
      flag.flag_type === "script_content",
  );
  if (
    hostile &&
    Array.isArray(candidate.candidate_rules) &&
    candidate.candidate_rules.length > 0
  )
    collector.add(
      pointer(path, "candidate_rules"),
      "hostile_candidate_rules_forbidden",
      "security-flagged extraction must not contain candidate rules",
    );
}

function validateSource(
  source: RecordValue,
  path: string,
  collector: IssueCollector,
  options: SemanticValidationOptions,
): void {
  const access = isRecord(source.access) ? source.access : undefined;
  const technical = isRecord(access?.technical_feasibility)
    ? access.technical_feasibility
    : undefined;
  const observationIds = Array.isArray(technical?.observation_ids)
    ? technical.observation_ids.filter(
        (id): id is string => typeof id === "string",
      )
    : [];
  if (
    technical &&
    technical.current_classification !== "unknown" &&
    observationIds.length === 0
  )
    collector.add(
      pointer(path, "access", "technical_feasibility", "observation_ids"),
      "technical_observation_required",
      "non-unknown technical classification requires an observation",
    );
  if (observationIds.length > 0 && technical?.last_observed_at === null)
    collector.add(
      pointer(path, "access", "technical_feasibility", "last_observed_at"),
      "last_observed_at_required",
      "observation references require last_observed_at",
    );
  const observations = options.accessObservations;
  const sourceId = asString(source.id);
  if (observations) {
    for (const id of observationIds) {
      const observation = observations.find(
        (item) => item.observation_id === id,
      ) as unknown as RecordValue | undefined;
      if (!observation)
        collector.add(
          pointer(path, "access", "technical_feasibility", "observation_ids"),
          "unknown_observation_id",
          `source references unknown observation ${id}`,
        );
      else if (
        Array.isArray(observation.source_ids) &&
        observation.source_ids.length > 0 &&
        sourceId &&
        !observation.source_ids.includes(sourceId)
      )
        collector.add(
          pointer(path, "access", "technical_feasibility", "observation_ids"),
          "observation_source_mismatch",
          `source ${sourceId} is not covered by observation ${id}`,
        );
    }
  }
}

function validateSourceObservation(
  observation: RecordValue,
  path: string,
  collector: IssueCollector,
): void {
  const feed = isRecord(observation.agent_feed)
    ? observation.agent_feed
    : undefined;
  if (feed?.protocol_version !== "0.1")
    collector.add(
      pointer(path, "agent_feed", "protocol_version"),
      "agent_feed_protocol_version",
      "Agent Feed protocol version must be 0.1",
    );
  if (
    observation.status === "rejected" &&
    Array.isArray(observation.canonical_evidence_ids) &&
    observation.canonical_evidence_ids.length > 0
  )
    collector.add(
      pointer(path, "canonical_evidence_ids"),
      "rejected_canonical_evidence_forbidden",
      "rejected observations must not create canonical evidence",
    );
}

function inferSchema(value: unknown): SchemaName | undefined {
  if (!isRecord(value)) return undefined;
  if ("asset_id" in value && "asset_kind" in value && "display_name" in value)
    return "asset";
  if ("evidence_id" in value && "source_snapshot_id" in value)
    return "evidence-record";
  if ("candidate_id" in value && "candidate_rules" in value)
    return "extraction-candidate";
  if ("scenario_id" in value && "candidate_plans" in value)
    return "golden-scenario";
  if ("plan_id" in value && "operations" in value) return "purchase-plan";
  if ("rule_id" in value && "rule_type" in value) return "reward-rule";
  if ("observation_id" in value && "summary_counts" in value)
    return "source-access-observation";
  if ("observation_id" in value && "agent_feed" in value)
    return "source-observation";
  if ("registry_version" in value && "sources" in value)
    return "trusted-source-registry";
  if ("source_url" in value && "publisher" in value) return "trusted-source";
  if ("owned_instrument_ids" in value && "cap_progress" in value)
    return "user-state";
  return undefined;
}

function semanticDispatch(
  value: unknown,
  schema: SchemaName,
  collector: IssueCollector,
  options: SemanticValidationOptions,
): void {
  const path = options.pathPrefix ?? "";
  if (!isRecord(value)) {
    collector.add(
      path,
      "document_not_object",
      "contract documents must be JSON objects",
    );
    return;
  }
  switch (schema) {
    case "asset":
      validateAsset(value, path, collector);
      break;
    case "user-state":
      validateUserState(value, path, collector);
      break;
    case "purchase-plan":
      validatePlan(value, path, collector, options);
      break;
    case "reward-rule":
      validateRule(value, path, collector, options);
      break;
    case "golden-scenario":
      validateGolden(value, path, collector, options);
      break;
    case "evidence-record":
      validateEvidence(value, path, collector);
      break;
    case "extraction-candidate":
      validateExtraction(value, path, collector);
      break;
    case "trusted-source":
      validateSource(value, path, collector, options);
      break;
    case "source-observation":
      validateSourceObservation(value, path, collector);
      break;
    case "source-access-observation":
      break;
    case "trusted-source-registry":
      break;
  }
}

export function validateSemantics<T = unknown>(
  value: T,
  schema?: SchemaInput,
  options: SemanticValidationOptions = {},
): ValidationResult<T> {
  const collector = new IssueCollector();
  let resolved: SchemaName | undefined;
  try {
    resolved =
      schema === undefined ? inferSchema(value) : normalizeSchemaName(schema);
  } catch {
    collector.add(
      options.pathPrefix ?? "",
      "schema_name_unknown",
      `unknown contract schema ${String(schema)}`,
    );
  }
  if (!resolved) {
    collector.add(
      options.pathPrefix ?? "",
      "schema_name_required",
      "unable to infer contract schema; provide schema explicitly",
    );
  } else {
    semanticDispatch(value, resolved, collector, options);
  }
  const issues = sortIssues(collector.items);
  if (issues.length === 0) return success(value);
  return { valid: false, issues, errors: issues };
}

export function validateDocument<T = unknown>(
  value: unknown,
  schema: SchemaInput,
  options: SemanticValidationOptions = {},
): T {
  const normalized = normalizeSchemaName(schema);
  const structure = validateStructure<T>(value, normalized);
  const collector = new IssueCollector();
  if (!structure.valid) collector.addAll(structure.issues);
  if (structure.valid)
    collector.addAll(validateSemantics(value as T, schema, options).issues);
  const issues = sortIssues(collector.items);
  if (issues.length > 0) throw new ContractValidationError(issues, normalized);
  return value as T;
}

export function tryValidateDocument<T = unknown>(
  value: unknown,
  schema: SchemaInput,
  options: SemanticValidationOptions = {},
): ValidationResult<T> {
  const normalized = normalizeSchemaName(schema);
  const structure = validateStructure<T>(value, normalized);
  if (!structure.valid) return structure;
  const semantics = validateSemantics(value as T, normalized, options);
  if (!semantics.valid) return semantics;
  return success(value as T);
}

export function assertValidDocument<T = unknown>(
  value: unknown,
  schema: SchemaInput,
  options: SemanticValidationOptions = {},
): asserts value is T {
  validateDocument<T>(value, schema, options);
}

export function validateRegistrySources(
  registry: TrustedSourceRegistry,
  observations: readonly SourceAccessObservation[] = [],
): ValidationResult<TrustedSourceRegistry> {
  const collector = new IssueCollector();
  const sources = records((registry as unknown as RecordValue).sources);
  const ids = sources.map((source) => source.id);
  const urls = sources.map((source) => source.source_url);
  for (const duplicate of duplicateValues(ids))
    collector.add(
      "/sources",
      "duplicate_source_id",
      `duplicate source ID ${String(duplicate)}`,
    );
  for (const duplicate of duplicateValues(urls))
    collector.add(
      "/sources",
      "duplicate_source_url",
      `duplicate source URL ${String(duplicate)}`,
    );
  const observationById = new Map(
    observations.map((observation) => [
      observation.observation_id,
      observation,
    ]),
  );
  const sourceIds = new Set(
    ids.filter((id): id is string => typeof id === "string"),
  );
  sources.forEach((source, index) => {
    const sourcePath = pointer("/sources", index);
    validateSource(source, sourcePath, collector, {
      accessObservations: observations,
    });
    const technical = isRecord(
      isRecord(source.access) ? source.access.technical_feasibility : undefined,
    )
      ? ((source.access as RecordValue).technical_feasibility as RecordValue)
      : undefined;
    for (const observationId of Array.isArray(technical?.observation_ids)
      ? technical.observation_ids
      : []) {
      if (
        typeof observationId === "string" &&
        !observationById.has(observationId)
      )
        collector.add(
          pointer(
            sourcePath,
            "access",
            "technical_feasibility",
            "observation_ids",
          ),
          "unknown_observation_id",
          `unknown observation ${observationId}`,
        );
    }
    if (typeof source.id === "string" && !sourceIds.has(source.id))
      collector.add(
        pointer(sourcePath, "id"),
        "source_id_missing",
        "source ID must be present in registry",
      );
  });
  observations.forEach((observation, index) => {
    if (observation.scope === ("aggregate" as never)) return;
    for (const sourceId of observation.source_ids)
      if (!sourceIds.has(sourceId))
        collector.add(
          pointer(`/observations`, index, "source_ids"),
          "unknown_source_id",
          `observation references unknown source ${sourceId}`,
        );
  });
  const issues = sortIssues(collector.items);
  if (issues.length > 0) return { valid: false, issues, errors: issues };
  return success(registry);
}
