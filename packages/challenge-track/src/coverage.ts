import { createHash } from "node:crypto";
import YAML from "yaml";
import {
  type AdmittedChallengeCoveragePlan,
  CHALLENGE_COVERAGE_ALPHA_GATE,
  CHALLENGE_COVERAGE_ALPHA_SCOPE,
  CHALLENGE_COVERAGE_CATEGORIES,
  CHALLENGE_COVERAGE_CATEGORY_TOTALS,
  CHALLENGE_COVERAGE_DISTRIBUTION_FIELDS,
  CHALLENGE_COVERAGE_ENTRY_FIELDS,
  CHALLENGE_COVERAGE_GOLDEN_GATE,
  CHALLENGE_COVERAGE_LEVEL_TOTALS,
  CHALLENGE_COVERAGE_LEVELS,
  CHALLENGE_COVERAGE_PURPOSE,
  CHALLENGE_COVERAGE_RELEASE_POLICY_FIELDS,
  CHALLENGE_COVERAGE_RELEASE_TRACKS,
  CHALLENGE_COVERAGE_RESEARCH_CUTOFF,
  CHALLENGE_COVERAGE_REVIEW_MODES,
  CHALLENGE_COVERAGE_SEED_SCENARIO_IDS,
  CHALLENGE_COVERAGE_STATUS_MEANING,
  CHALLENGE_COVERAGE_STATUSES,
  CHALLENGE_COVERAGE_TOP_LEVEL_FIELDS,
  CHALLENGE_COVERAGE_TOTAL,
  CHALLENGE_COVERAGE_VERSION,
  type ChallengeCoverageAdmissionAccepted,
  type ChallengeCoverageAdmissionDenied,
  type ChallengeCoverageAdmissionOptions,
  type ChallengeCoverageAdmissionResult,
  type ChallengeCoverageCategory,
  type ChallengeCoverageDistribution,
  type ChallengeCoverageIssue,
  type ChallengeCoverageIssueCode,
  type ChallengeCoverageLevel,
  type ChallengeCoveragePlan,
  type ChallengeCoverageReleasePolicy,
  type ChallengeCoverageReleaseTrack,
  type ChallengeCoverageResearchCutoff,
  type ChallengeCoverageScenario,
  type ChallengeCoverageSha256,
  type ChallengeCoverageStatus,
  type ChallengeCoverageStatusMeaning,
  ChallengeCoverageValidationError,
  type ChallengeCoverageVersion,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

const LEVEL_SET = new Set<string>(CHALLENGE_COVERAGE_LEVELS);
const CATEGORY_SET = new Set<string>(CHALLENGE_COVERAGE_CATEGORIES);
const RELEASE_TRACK_SET = new Set<string>(CHALLENGE_COVERAGE_RELEASE_TRACKS);
const STATUS_SET = new Set<string>(CHALLENGE_COVERAGE_STATUSES);
const REVIEW_MODE_SET = new Set<string>(CHALLENGE_COVERAGE_REVIEW_MODES);
const ID_PATTERN = /^JP-([A-Z]+)-([0-9]{3})$/u;
const SOURCE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const FEATURE_ID_PATTERN = /^[a-z][a-z0-9_.-]*$/u;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ADMITTED_PLAN_SNAPSHOTS = new WeakSet<object>();

/**
 * Throw one stable issue.  Values are never interpolated into the exception,
 * which keeps hostile plan content out of diagnostics.
 */
function deny(code: ChallengeCoverageIssueCode, path: string): never {
  throw new ChallengeCoverageValidationError([{ code, path }]);
}

function pointer(path: string, key: string | number): string {
  const escaped = String(key).replaceAll("~", "~0").replaceAll("/", "~1");
  return `${path}/${escaped}`;
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function isRecord(value: unknown): value is UnknownRecord {
  return isObject(value) && !Array.isArray(value);
}

function compareLexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Inspect an input graph using descriptors before reading any field value.
 * This is intentionally separate from semantic validation: a getter, hidden
 * field, symbol, proxy, or cycle must fail before the contract dereferences a
 * user-controlled value.
 */
function inspectPlainData(
  value: unknown,
  path: string,
  active: Set<object>,
): void {
  if (value === null) return;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return;
  if (kind === "number") {
    if (!Number.isFinite(value)) deny("unsupported_value", path);
    return;
  }
  if (
    kind === "undefined" ||
    kind === "bigint" ||
    kind === "symbol" ||
    kind === "function"
  )
    deny("unsupported_value", path);
  if (!isObject(value)) deny("unsupported_value", path);
  if (active.has(value)) deny("cyclic_value", path);

  active.add(value);
  try {
    let prototype: object | null;
    let keys: readonly (string | symbol)[];
    try {
      prototype = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
    } catch {
      // A revoked or trapping proxy cannot be inspected safely.
      deny("proxy_not_allowed", path);
    }

    const array = Array.isArray(value);
    if (
      array
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    )
      deny("non_plain_object", path);

    const descriptors = new Map<string, PropertyDescriptor>();
    for (const key of keys) {
      if (typeof key === "symbol")
        deny("symbol_property", pointer(path, "[symbol]"));
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        deny("proxy_not_allowed", pointer(path, key));
      }
      if (!descriptor) deny("proxy_not_allowed", pointer(path, key));
      descriptors.set(key, descriptor);
      if (array && key === "length") {
        if (
          descriptor.get ||
          descriptor.set ||
          typeof descriptor.value !== "number"
        )
          deny("accessor_not_allowed", pointer(path, key));
        continue;
      }
      if (!descriptor.enumerable)
        deny("non_enumerable_property", pointer(path, key));
      if (descriptor.get || descriptor.set)
        deny("accessor_not_allowed", pointer(path, key));
      if (DANGEROUS_KEYS.has(key)) deny("unsafe_object", pointer(path, key));
    }

    if (array) {
      const lengthDescriptor = descriptors.get("length");
      if (!lengthDescriptor || typeof lengthDescriptor.value !== "number")
        deny("unsafe_object", pointer(path, "length"));
      const length = lengthDescriptor.value as number;
      const indices = new Set<number>();
      for (const key of descriptors.keys()) {
        if (key === "length") continue;
        if (!/^\d+$/u.test(key)) deny("unsafe_object", pointer(path, key));
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || index >= length)
          deny("unsafe_object", pointer(path, key));
        if (String(index) !== key) deny("unsafe_object", pointer(path, key));
        indices.add(index);
      }
      for (let index = 0; index < length; index += 1) {
        if (!indices.has(index)) deny("unsafe_object", pointer(path, index));
      }
    }

    for (const [key, descriptor] of descriptors) {
      if (array && key === "length") continue;
      // Accessor descriptors were rejected above, so this read cannot invoke a
      // getter.  It is the only dereference performed during the scan.
      inspectPlainData(descriptor.value, pointer(path, key), active);
    }
  } finally {
    active.delete(value);
  }
}

/**
 * Structured clone is used only after descriptor inspection.  Node refuses to
 * clone Proxy objects, including transparent proxies whose traps otherwise
 * look like a plain object.  The cloned graph is then the sole graph used by
 * semantic validation and output construction.
 */
function cloneAdmissibleInput(input: unknown): unknown {
  inspectPlainData(input, "", new Set<object>());
  try {
    return structuredClone(input);
  } catch {
    deny("proxy_not_allowed", "/");
  }
}

function decodeInput(input: unknown): unknown {
  if (typeof input !== "string") return cloneAdmissibleInput(input);
  if (input.trim().length === 0) deny("invalid_yaml", "/");
  let parsed: unknown;
  try {
    parsed = YAML.parse(input);
  } catch {
    deny("invalid_yaml", "/");
  }
  return cloneAdmissibleInput(parsed);
}

function record(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) deny("invalid_type", path);
  return value;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) deny("invalid_type", path);
  return value;
}

function exactKeys(
  value: UnknownRecord,
  expected: readonly string[],
  path: string,
): void {
  const expectedSet = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) deny("unknown_field", pointer(path, key));
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) deny("missing_field", pointer(path, key));
  }
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    deny("invalid_type", path);
  if (value !== value.trim()) deny("invalid_value", path);
  return value;
}

function exactString(value: unknown, expected: string, path: string): string {
  const actual = requiredString(value, path);
  if (actual !== expected) deny("invalid_value", path);
  return actual;
}

function safeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    deny("invalid_type", path);
  return value;
}

function uniqueStringArray(
  value: unknown,
  path: string,
  pattern: RegExp,
  emptyCode: ChallengeCoverageIssueCode,
  duplicateCode: ChallengeCoverageIssueCode,
): readonly string[] {
  const values = array(value, path);
  if (values.length === 0) deny(emptyCode, path);
  const output: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const itemPath = pointer(path, index);
    const item = requiredString(values[index], itemPath);
    if (!pattern.test(item)) deny("invalid_value", itemPath);
    if (seen.has(item)) deny(duplicateCode, itemPath);
    seen.add(item);
    output.push(item);
  }
  return output;
}

function exactStringArray(
  value: unknown,
  expected: readonly string[],
  path: string,
  code: ChallengeCoverageIssueCode,
): readonly string[] {
  const values = array(value, path);
  if (values.length !== expected.length) deny(code, path);
  const actual = values.map((item, index) =>
    requiredString(item, pointer(path, index)),
  );
  const actualSet = new Set(actual);
  if (
    actualSet.size !== expected.length ||
    expected.some((item) => !actualSet.has(item))
  )
    deny(code, path);
  return actual;
}

function asEnum<T extends string>(
  value: unknown,
  path: string,
  values: ReadonlySet<string>,
  code: ChallengeCoverageIssueCode,
): T {
  const item = requiredString(value, path);
  if (!values.has(item)) deny(code, path);
  return item as T;
}

function sameFixedMap(
  actual: UnknownRecord,
  expected: Readonly<Record<string, number>>,
  path: string,
): Readonly<Record<string, number>> {
  const keys = Object.keys(expected);
  exactKeys(actual, keys, path);
  const output: Record<string, number> = {};
  for (const key of keys) {
    const number = safeInteger(actual[key], pointer(path, key));
    if (number !== expected[key])
      deny("distribution_mismatch", pointer(path, key));
    output[key] = number;
  }
  return output;
}

function normalizeOptionCollection(
  options: ChallengeCoverageAdmissionOptions | undefined,
  key: keyof ChallengeCoverageAdmissionOptions,
): unknown {
  if (options === undefined) return undefined;
  if (!isObject(options)) deny("invalid_input", "/options");
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(options, key);
  } catch {
    deny("proxy_not_allowed", pointer("/options", String(key)));
  }
  if (!descriptor) return undefined;
  if (descriptor.get || descriptor.set)
    deny("accessor_not_allowed", pointer("/options", String(key)));
  return descriptor.value;
}

function toOptionIds(
  value: unknown,
  path: string,
  code: "known" | "seed",
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" || value === null)
    deny("invalid_seed_ids", path);
  let values: unknown[];
  try {
    values = Array.from(value as Iterable<unknown>);
  } catch {
    deny("invalid_seed_ids", path);
  }
  const output: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const itemPath = pointer(path, index);
    const item = requiredString(values[index], itemPath);
    if (!ID_PATTERN.test(item) && code === "seed")
      deny("invalid_seed_ids", itemPath);
    if (!SOURCE_ID_PATTERN.test(item) && code === "known")
      deny("invalid_source_ids", itemPath);
    if (seen.has(item))
      deny(
        code === "seed" ? "invalid_seed_ids" : "duplicate_source_id",
        itemPath,
      );
    seen.add(item);
    output.push(item);
  }
  return output;
}

function resolveOptions(
  options: ChallengeCoverageAdmissionOptions | undefined,
): {
  readonly knownSourceIds?: ReadonlySet<string>;
  readonly requiredSeedIds?: readonly string[];
} {
  const known = toOptionIds(
    normalizeOptionCollection(options, "knownSourceIds"),
    "/options/knownSourceIds",
    "known",
  );
  const required = toOptionIds(
    normalizeOptionCollection(options, "requiredSeedIds"),
    "/options/requiredSeedIds",
    "seed",
  );
  const seedIds = toOptionIds(
    normalizeOptionCollection(options, "seedIds"),
    "/options/seedIds",
    "seed",
  );
  const seedScenarioIds = toOptionIds(
    normalizeOptionCollection(options, "seedScenarioIds"),
    "/options/seedScenarioIds",
    "seed",
  );
  const requireSeedIds = normalizeOptionCollection(options, "requireSeedIds");
  if (requireSeedIds !== undefined && typeof requireSeedIds !== "boolean") {
    const supplied = toOptionIds(
      requireSeedIds,
      "/options/requireSeedIds",
      "seed",
    );
    if (required || seedIds || seedScenarioIds)
      deny("invalid_seed_ids", "/options");
    return {
      ...(known ? { knownSourceIds: new Set(known) } : {}),
      ...(supplied ? { requiredSeedIds: supplied } : {}),
    };
  }
  const seedLists = [required, seedIds, seedScenarioIds].filter(
    (item): item is readonly string[] => item !== undefined,
  );
  if (seedLists.length > 1) {
    const first = seedLists[0];
    if (
      first &&
      seedLists.some((item) => item.join("\u0000") !== first.join("\u0000"))
    )
      deny("invalid_seed_ids", "/options");
  }
  const selected =
    seedLists[0] ??
    (requireSeedIds === true
      ? CHALLENGE_COVERAGE_SEED_SCENARIO_IDS
      : undefined);
  return {
    ...(known ? { knownSourceIds: new Set(known) } : {}),
    ...(selected ? { requiredSeedIds: selected } : {}),
  };
}

function validateAndNormalize(
  input: unknown,
  options: ChallengeCoverageAdmissionOptions | undefined,
): ChallengeCoveragePlan {
  const root = record(input, "");
  exactKeys(root, CHALLENGE_COVERAGE_TOP_LEVEL_FIELDS, "");
  exactString(root.version, CHALLENGE_COVERAGE_VERSION, "/version");
  exactString(
    root.research_cutoff,
    CHALLENGE_COVERAGE_RESEARCH_CUTOFF,
    "/research_cutoff",
  );
  exactString(root.purpose, CHALLENGE_COVERAGE_PURPOSE, "/purpose");

  const distribution = record(root.distribution, "/distribution");
  exactKeys(
    distribution,
    CHALLENGE_COVERAGE_DISTRIBUTION_FIELDS,
    "/distribution",
  );
  const total = safeInteger(distribution.total, "/distribution/total");
  if (total !== CHALLENGE_COVERAGE_TOTAL)
    deny("distribution_mismatch", "/distribution/total");
  const declaredLevels = sameFixedMap(
    record(distribution.by_level, "/distribution/by_level"),
    CHALLENGE_COVERAGE_LEVEL_TOTALS,
    "/distribution/by_level",
  );
  const declaredCategories = sameFixedMap(
    record(distribution.by_category, "/distribution/by_category"),
    CHALLENGE_COVERAGE_CATEGORY_TOTALS,
    "/distribution/by_category",
  );

  const statusMeaning = record(root.status_meaning, "/status_meaning");
  exactKeys(
    statusMeaning,
    Object.keys(CHALLENGE_COVERAGE_STATUS_MEANING),
    "/status_meaning",
  );
  for (const status of CHALLENGE_COVERAGE_STATUSES) {
    exactString(
      statusMeaning[status],
      CHALLENGE_COVERAGE_STATUS_MEANING[status],
      pointer("/status_meaning", status),
    );
  }

  const policy = record(root.release_policy, "/release_policy");
  exactKeys(
    policy,
    CHALLENGE_COVERAGE_RELEASE_POLICY_FIELDS,
    "/release_policy",
  );
  exactString(
    policy.alpha_scope,
    CHALLENGE_COVERAGE_ALPHA_SCOPE,
    "/release_policy/alpha_scope",
  );
  exactString(
    policy.alpha_gate,
    CHALLENGE_COVERAGE_ALPHA_GATE,
    "/release_policy/alpha_gate",
  );
  const reviewModes = exactStringArray(
    policy.review_modes,
    CHALLENGE_COVERAGE_REVIEW_MODES,
    "/release_policy/review_modes",
    "invalid_release_policy",
  );
  for (const mode of reviewModes) {
    if (!REVIEW_MODE_SET.has(mode))
      deny("invalid_release_policy", "/release_policy/review_modes");
  }

  const scenarioValues = array(root.scenarios, "/scenarios");
  if (scenarioValues.length !== CHALLENGE_COVERAGE_TOTAL)
    deny("distribution_mismatch", "/scenarios");
  const ids = new Set<string>();
  const actualLevels: Record<string, number> = {};
  const actualCategories: Record<string, number> = {};
  const normalizedScenarios: ChallengeCoverageScenario[] = [];
  const resolved = resolveOptions(options);

  for (let index = 0; index < scenarioValues.length; index += 1) {
    const path = pointer("/scenarios", index);
    const entry = record(scenarioValues[index], path);
    exactKeys(entry, CHALLENGE_COVERAGE_ENTRY_FIELDS, path);
    const scenarioId = requiredString(
      entry.scenario_id,
      pointer(path, "scenario_id"),
    );
    const idMatch = ID_PATTERN.exec(scenarioId);
    if (!idMatch) deny("invalid_scenario_id", pointer(path, "scenario_id"));
    const category = asEnum<ChallengeCoverageCategory>(
      entry.category,
      pointer(path, "category"),
      CATEGORY_SET,
      "invalid_category",
    );
    if (idMatch[1] !== category)
      deny("scenario_category_mismatch", pointer(path, "category"));
    if (ids.has(scenarioId))
      deny("duplicate_scenario_id", pointer(path, "scenario_id"));
    ids.add(scenarioId);

    const title = requiredString(entry.title, pointer(path, "title"));
    const target = requiredString(entry.target, pointer(path, "target"));
    const behavior = requiredString(
      entry.behavior_under_test,
      pointer(path, "behavior_under_test"),
    );
    const level = asEnum<ChallengeCoverageLevel>(
      entry.level,
      pointer(path, "level"),
      LEVEL_SET,
      "invalid_level",
    );
    const releaseTrack = asEnum<ChallengeCoverageReleaseTrack>(
      entry.release_track,
      pointer(path, "release_track"),
      RELEASE_TRACK_SET,
      "invalid_release_track",
    );
    const status = asEnum<ChallengeCoverageStatus>(
      entry.status,
      pointer(path, "status"),
      STATUS_SET,
      "invalid_status",
    );
    if (status !== "planned")
      deny("golden_status_not_allowed", pointer(path, "status"));

    const sourceIds = uniqueStringArray(
      entry.primary_source_ids,
      pointer(path, "primary_source_ids"),
      SOURCE_ID_PATTERN,
      "invalid_source_ids",
      "duplicate_source_id",
    );
    if (resolved.knownSourceIds) {
      for (
        let sourceIndex = 0;
        sourceIndex < sourceIds.length;
        sourceIndex += 1
      ) {
        const sourceId = sourceIds[sourceIndex];
        if (sourceId === undefined || !resolved.knownSourceIds.has(sourceId))
          deny(
            "unknown_source_id",
            pointer(pointer(path, "primary_source_ids"), sourceIndex),
          );
      }
    }
    const contractFeatures = uniqueStringArray(
      entry.contract_features,
      pointer(path, "contract_features"),
      FEATURE_ID_PATTERN,
      "invalid_feature_ids",
      "duplicate_feature_id",
    );
    const domainFeatures = uniqueStringArray(
      entry.required_domain_features,
      pointer(path, "required_domain_features"),
      FEATURE_ID_PATTERN,
      "invalid_feature_ids",
      "duplicate_feature_id",
    );
    const negativeAssertion = requiredString(
      entry.required_negative_assertion,
      pointer(path, "required_negative_assertion"),
    );
    exactStringArray(
      entry.golden_gate,
      CHALLENGE_COVERAGE_GOLDEN_GATE,
      pointer(path, "golden_gate"),
      "invalid_golden_gate",
    );

    actualLevels[level] = (actualLevels[level] ?? 0) + 1;
    actualCategories[category] = (actualCategories[category] ?? 0) + 1;
    normalizedScenarios.push({
      scenario_id: scenarioId,
      category,
      title,
      target,
      level,
      behavior_under_test: behavior,
      primary_source_ids: Object.freeze([...sourceIds].sort(compareLexical)),
      required_negative_assertion: negativeAssertion,
      status,
      golden_gate: Object.freeze([...CHALLENGE_COVERAGE_GOLDEN_GATE]),
      contract_features: Object.freeze(
        [...contractFeatures].sort(compareLexical),
      ),
      release_track: releaseTrack,
      required_domain_features: Object.freeze(
        [...domainFeatures].sort(compareLexical),
      ),
    });
  }

  for (const level of CHALLENGE_COVERAGE_LEVELS) {
    if ((actualLevels[level] ?? 0) !== declaredLevels[level])
      deny("distribution_mismatch", `/distribution/by_level/${level}`);
  }
  for (const category of CHALLENGE_COVERAGE_CATEGORIES) {
    if ((actualCategories[category] ?? 0) !== declaredCategories[category])
      deny("distribution_mismatch", `/distribution/by_category/${category}`);
  }
  if (
    Object.values(actualLevels).reduce((sum, count) => sum + count, 0) !==
      total ||
    Object.values(actualCategories).reduce((sum, count) => sum + count, 0) !==
      total
  )
    deny("distribution_mismatch", "/distribution");

  // The queue is a versioned, fixed challenge set, not merely a bag with the
  // right cardinalities.  Require the complete stable ID roster so replacing
  // one scenario with another valid-looking ID cannot silently preserve the
  // declared totals.
  for (const category of CHALLENGE_COVERAGE_CATEGORIES) {
    const expectedCount = CHALLENGE_COVERAGE_CATEGORY_TOTALS[category];
    for (let number = 1; number <= expectedCount; number += 1) {
      const expectedId = `JP-${category}-${String(number).padStart(3, "0")}`;
      if (!ids.has(expectedId)) deny("distribution_mismatch", "/scenarios");
    }
  }

  if (resolved.requiredSeedIds) {
    for (const seedId of resolved.requiredSeedIds) {
      if (!ids.has(seedId)) deny("missing_seed_id", "/scenarios");
    }
  }

  normalizedScenarios.sort((left, right) =>
    compareLexical(left.scenario_id, right.scenario_id),
  );
  return {
    version: CHALLENGE_COVERAGE_VERSION,
    research_cutoff: CHALLENGE_COVERAGE_RESEARCH_CUTOFF,
    purpose: CHALLENGE_COVERAGE_PURPOSE,
    distribution: {
      total,
      by_level:
        declaredLevels as ChallengeCoveragePlan["distribution"]["by_level"],
      by_category:
        declaredCategories as ChallengeCoveragePlan["distribution"]["by_category"],
    },
    status_meaning: {
      planned: CHALLENGE_COVERAGE_STATUS_MEANING.planned,
      candidate: CHALLENGE_COVERAGE_STATUS_MEANING.candidate,
      golden: CHALLENGE_COVERAGE_STATUS_MEANING.golden,
    },
    scenarios: normalizedScenarios,
    release_policy: {
      alpha_scope: CHALLENGE_COVERAGE_ALPHA_SCOPE,
      alpha_gate: CHALLENGE_COVERAGE_ALPHA_GATE,
      review_modes: Object.freeze([...CHALLENGE_COVERAGE_REVIEW_MODES]),
    },
  };
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!isObject(value) || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) deny("unsupported_value", "/");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort(compareLexical)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  deny("unsupported_value", "/");
}

function freezePlan(plan: ChallengeCoveragePlan): ChallengeCoveragePlan {
  return deepFreeze(plan);
}

/** Parse and semantically validate either YAML text or a plain data object. */
export function parseChallengeCoveragePlan(
  input: unknown,
  options?: ChallengeCoverageAdmissionOptions,
): ChallengeCoveragePlan {
  const decoded = decodeInput(input);
  return freezePlan(validateAndNormalize(decoded, options));
}

/**
 * Admit a plan and return its deterministic canonical snapshot.  Admission
 * does not read or create evidence and cannot promote a scenario to golden.
 */
export function admitChallengeCoveragePlan(
  input: unknown,
  options?: ChallengeCoverageAdmissionOptions,
): AdmittedChallengeCoveragePlan {
  const value = parseChallengeCoveragePlan(input, options);
  const canonical_json = canonicalJson(value);
  const digest = createHash("sha256")
    .update(canonical_json, "utf8")
    .digest("hex");
  const snapshot = deepFreeze({
    value,
    canonical_json,
    sha256: `sha256:${digest}` as ChallengeCoverageSha256,
  });
  ADMITTED_PLAN_SNAPSHOTS.add(snapshot);
  return snapshot;
}

/**
 * Return whether a value is the exact host-admitted snapshot created by this
 * module in this process. A structurally identical object and a recomputed
 * public hash are not admission authority.
 */
export function isAdmittedChallengeCoveragePlan(
  value: unknown,
): value is AdmittedChallengeCoveragePlan {
  return (typeof value === "object" && value !== null) ||
    typeof value === "function"
    ? ADMITTED_PLAN_SNAPSHOTS.has(value)
    : false;
}

/** Return a stable denial rather than throwing for boundary adapters. */
export function tryAdmitChallengeCoveragePlan(
  input: unknown,
  options?: ChallengeCoverageAdmissionOptions,
): ChallengeCoverageAdmissionResult {
  try {
    return Object.freeze({
      ok: true as const,
      snapshot: admitChallengeCoveragePlan(input, options),
    });
  } catch (error) {
    if (!(error instanceof ChallengeCoverageValidationError)) throw error;
    const admissionError = error as ChallengeCoverageValidationError;
    return Object.freeze({
      ok: false as const,
      denial: Object.freeze({
        code: admissionError.code,
        issues: admissionError.issues,
      }),
    });
  }
}

export const validateChallengeCoveragePlan = parseChallengeCoveragePlan;
export const assertChallengeCoveragePlan = parseChallengeCoveragePlan;
export const createChallengeCoverageSnapshot = admitChallengeCoveragePlan;
export const parseCoveragePlan = parseChallengeCoveragePlan;
export const admitCoveragePlan = admitChallengeCoveragePlan;

export {
  CHALLENGE_COVERAGE_ALPHA_GATE,
  CHALLENGE_COVERAGE_ALPHA_SCOPE,
  CHALLENGE_COVERAGE_CATEGORIES,
  CHALLENGE_COVERAGE_CATEGORY_TOTALS,
  CHALLENGE_COVERAGE_DISTRIBUTION_FIELDS,
  CHALLENGE_COVERAGE_ENTRY_FIELDS,
  CHALLENGE_COVERAGE_GOLDEN_GATE,
  CHALLENGE_COVERAGE_LEVELS,
  CHALLENGE_COVERAGE_LEVEL_TOTALS,
  CHALLENGE_COVERAGE_PURPOSE,
  CHALLENGE_COVERAGE_RELEASE_POLICY_FIELDS,
  CHALLENGE_COVERAGE_RELEASE_TRACKS,
  CHALLENGE_COVERAGE_REVIEW_MODES,
  CHALLENGE_COVERAGE_RESEARCH_CUTOFF,
  CHALLENGE_COVERAGE_SEED_SCENARIO_IDS,
  CHALLENGE_COVERAGE_STATUSES,
  CHALLENGE_COVERAGE_STATUS_MEANING,
  CHALLENGE_COVERAGE_TOP_LEVEL_FIELDS,
  CHALLENGE_COVERAGE_TOTAL,
  CHALLENGE_COVERAGE_VERSION,
};

export type {
  AdmittedChallengeCoveragePlan,
  ChallengeCoverageAdmissionAccepted,
  ChallengeCoverageAdmissionDenied,
  ChallengeCoverageAdmissionOptions,
  ChallengeCoverageAdmissionResult,
  ChallengeCoverageCategory,
  ChallengeCoverageDistribution,
  ChallengeCoverageIssue,
  ChallengeCoverageIssueCode,
  ChallengeCoverageLevel,
  ChallengeCoveragePlan,
  ChallengeCoverageReleaseTrack,
  ChallengeCoverageReleasePolicy,
  ChallengeCoverageResearchCutoff,
  ChallengeCoverageScenario,
  ChallengeCoverageSha256,
  ChallengeCoverageStatus,
  ChallengeCoverageStatusMeaning,
  ChallengeCoverageVersion,
};
export { ChallengeCoverageValidationError } from "./types.js";
