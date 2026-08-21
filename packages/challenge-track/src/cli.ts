import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { types as utilTypes } from "node:util";
import YAML from "yaml";
import {
  admitSyntheticChallengeSet,
  SYNTHETIC_CASE_SET_VERSION,
} from "./cases.js";
import {
  type AdmittedChallengeCoveragePlan,
  admitChallengeCoveragePlan,
  tryAdmitChallengeCoveragePlan,
} from "./coverage.js";
import {
  buildChallengeTrackReport,
  type ChallengeTrackReport,
  stableJson,
} from "./report.js";

export const DEFAULT_COVERAGE_PLAN_PATH =
  "scenarios/scenario-coverage-plan.v0.3.yaml" as const;
export const DEFAULT_TRUSTED_SOURCE_REGISTRY_PATH =
  "registry/trusted-sources.v0.3.yaml" as const;

export interface TrustedSourceRegistryInput {
  readonly registry_version?: unknown;
  readonly sources?: readonly unknown[];
  readonly [key: string]: unknown;
}

export interface SourceValidationAudit {
  readonly valid: true;
  readonly registry_source_count: number;
  readonly referenced_source_count: number;
  readonly referenced_source_ids: readonly string[];
  readonly admitted_plan_sha256: string;
}

export interface ChallengeTrackCliAudit extends ChallengeTrackReport {
  readonly audit_version: "m7.challenge-track-cli-audit.v1";
  readonly plan_version: string;
  readonly registry_version: string;
  readonly source_validation: SourceValidationAudit;
}

export interface CliInputOptions {
  readonly plan_path?: string;
  readonly registry_path?: string;
  readonly cwd?: string;
}

export interface CanonicalCliInputs {
  readonly plan: unknown;
  readonly registry: unknown;
}

export class ChallengeTrackCliError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("Challenge-track CLI input was rejected");
    this.name = "ChallengeTrackCliError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  try {
    return (
      Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null
    );
  } catch {
    return false;
  }
}

function clonePlainData(
  value: unknown,
  active = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new ChallengeTrackCliError("invalid_registry");
    return Object.is(value, -0) ? 0 : value;
  }
  if (
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    active.has(value)
  )
    throw new ChallengeTrackCliError("invalid_registry");
  active.add(value);
  try {
    let prototype: object | null;
    let keys: readonly PropertyKey[];
    try {
      prototype = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
    } catch {
      throw new ChallengeTrackCliError("invalid_registry");
    }
    if (keys.some((key) => typeof key !== "string"))
      throw new ChallengeTrackCliError("invalid_registry");
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype)
        throw new ChallengeTrackCliError("invalid_registry");
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        !lengthDescriptor ||
        typeof lengthDescriptor.value !== "number" ||
        keys.length !== lengthDescriptor.value + 1
      )
        throw new ChallengeTrackCliError("invalid_registry");
      const output: unknown[] = [];
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
          throw new ChallengeTrackCliError("invalid_registry");
        output.push(clonePlainData(descriptor.value, active));
      }
      return Object.freeze(output);
    }
    if (prototype !== Object.prototype && prototype !== null)
      throw new ChallengeTrackCliError("invalid_registry");
    const output: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw new ChallengeTrackCliError("invalid_registry");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
        throw new ChallengeTrackCliError("invalid_registry");
      output[key] = clonePlainData(descriptor.value, active);
    }
    return Object.freeze(output);
  } finally {
    active.delete(value);
  }
}

function exactCliInputs(value: unknown): CanonicalCliInputs {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value))
    throw new ChallengeTrackCliError("invalid_inputs");
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    keys.some(
      (key) => typeof key !== "string" || !["plan", "registry"].includes(key),
    )
  )
    throw new ChallengeTrackCliError("invalid_inputs");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of ["plan", "registry"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
      throw new ChallengeTrackCliError("invalid_inputs");
    result[key] = descriptor.value;
  }
  return result as unknown as CanonicalCliInputs;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function resolveRepositoryRoot(): string {
  const candidates = [
    process.cwd(),
    resolve(process.cwd(), "../.."),
    resolve(process.cwd(), "../../.."),
  ];
  return (
    candidates.find((candidate) =>
      existsSync(resolve(candidate, DEFAULT_COVERAGE_PLAN_PATH)),
    ) ?? process.cwd()
  );
}

function resolveInputPath(
  pathValue: string | undefined,
  defaultPath: string,
  cwd: string,
): string {
  if (pathValue === undefined)
    return resolve(resolveRepositoryRoot(), defaultPath);
  return isAbsolute(pathValue) ? pathValue : resolve(cwd, pathValue);
}

function parseYamlFile(pathValue: string): unknown {
  let text: string;
  try {
    text = readFileSync(pathValue, "utf8");
  } catch {
    throw new ChallengeTrackCliError("input_read_failed");
  }
  try {
    return YAML.parse(text) as unknown;
  } catch {
    throw new ChallengeTrackCliError("input_parse_failed");
  }
}

function sourceId(value: unknown): string | null {
  if (!isPlainRecord(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "id");
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
    return null;
  return typeof descriptor.value === "string" &&
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(descriptor.value)
    ? descriptor.value
    : null;
}

function registryIds(registry: unknown): readonly string[] {
  const admitted = clonePlainData(registry);
  if (!isPlainRecord(admitted) || !Array.isArray(admitted.sources))
    throw new ChallengeTrackCliError("invalid_registry");
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const source of admitted.sources) {
    const id = sourceId(source);
    if (id === null)
      throw new ChallengeTrackCliError("invalid_registry_source");
    if (seen.has(id))
      throw new ChallengeTrackCliError("duplicate_registry_source");
    seen.add(id);
    ids.push(id);
  }
  return ids.sort(compareStrings);
}

function registryVersion(registry: unknown): string {
  const admitted = clonePlainData(registry);
  if (!isPlainRecord(admitted))
    throw new ChallengeTrackCliError("invalid_registry");
  const value = admitted.registry_version;
  if (typeof value !== "string" || value.length === 0)
    throw new ChallengeTrackCliError("invalid_registry_version");
  return value;
}

/** Validate every declared source reference against the canonical registry. */
export function validateTrustedSourceIds(
  plan: unknown,
  registry: unknown,
): SourceValidationAudit {
  const ids = registryIds(registry);
  const result = tryAdmitChallengeCoveragePlan(plan, { knownSourceIds: ids });
  if (!result.ok) throw new ChallengeTrackCliError("plan_admission_failed");
  const referenced = new Set<string>();
  for (const scenario of result.snapshot.value.scenarios) {
    for (const id of scenario.primary_source_ids) referenced.add(id);
  }
  return Object.freeze({
    valid: true as const,
    registry_source_count: ids.length,
    referenced_source_count: referenced.size,
    referenced_source_ids: Object.freeze([...referenced].sort(compareStrings)),
    admitted_plan_sha256: result.snapshot.sha256,
  });
}

export function readCanonicalCliInputs(
  options: CliInputOptions = {},
): CanonicalCliInputs {
  const cwd = options.cwd ?? process.cwd();
  const plan = parseYamlFile(
    resolveInputPath(options.plan_path, DEFAULT_COVERAGE_PLAN_PATH, cwd),
  );
  const registry = parseYamlFile(
    resolveInputPath(
      options.registry_path,
      DEFAULT_TRUSTED_SOURCE_REGISTRY_PATH,
      cwd,
    ),
  );
  if (!isPlainRecord(plan)) throw new ChallengeTrackCliError("invalid_plan");
  if (!isPlainRecord(registry))
    throw new ChallengeTrackCliError("invalid_registry");
  return Object.freeze({ plan, registry });
}

export function buildChallengeTrackCliAudit(
  inputs: CanonicalCliInputs,
): ChallengeTrackCliAudit {
  const admittedInputs = exactCliInputs(inputs);
  const sourceValidation = validateTrustedSourceIds(
    admittedInputs.plan,
    admittedInputs.registry,
  );
  const admittedPlan: AdmittedChallengeCoveragePlan =
    admitChallengeCoveragePlan(admittedInputs.plan, {
      knownSourceIds: registryIds(admittedInputs.registry),
    });
  const emptySetAdmission = admitSyntheticChallengeSet(
    { version: SYNTHETIC_CASE_SET_VERSION, cases: [] },
    admittedPlan,
  );
  if (!emptySetAdmission.ok)
    throw new ChallengeTrackCliError("empty_case_set_admission_failed");
  // No case or attempt port is connected at this checkpoint.  This deliberately
  // reports the declarations as planned and nothing as executed or golden.
  const report = buildChallengeTrackReport({
    plan: admittedPlan,
    case_set: emptySetAdmission.challenge_set,
    attempt_port_available: false,
  });
  const registryVersionValue = registryVersion(admittedInputs.registry);
  return Object.freeze({
    ...report,
    audit_version: "m7.challenge-track-cli-audit.v1" as const,
    plan_version: admittedPlan.value.version,
    registry_version: registryVersionValue,
    source_validation: Object.freeze({
      ...sourceValidation,
      admitted_plan_sha256: admittedPlan.sha256,
    }),
  });
}

export function buildCliAudit(
  inputs: CanonicalCliInputs,
): ChallengeTrackCliAudit {
  return buildChallengeTrackCliAudit(inputs);
}

export function readAndBuildChallengeTrackCliAudit(
  options: CliInputOptions = {},
): ChallengeTrackCliAudit {
  return buildChallengeTrackCliAudit(readCanonicalCliInputs(options));
}

export function cliJson(audit: ChallengeTrackCliAudit): string {
  return `${stableJson(audit)}\n`;
}

export function runCli(options: CliInputOptions = {}): string {
  return cliJson(readAndBuildChallengeTrackCliAudit(options));
}

function parseArgs(argv: readonly string[]): CliInputOptions {
  let planPath: string | undefined;
  let registryPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--plan") {
      const value = argv[index + 1];
      if (value === undefined)
        throw new ChallengeTrackCliError("missing_argument");
      planPath = value;
      index += 1;
    } else if (argument === "--registry") {
      const value = argv[index + 1];
      if (value === undefined)
        throw new ChallengeTrackCliError("missing_argument");
      registryPath = value;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      throw new ChallengeTrackCliError("help");
    } else {
      throw new ChallengeTrackCliError("unknown_argument");
    }
  }
  return {
    ...(planPath === undefined ? {} : { plan_path: planPath }),
    ...(registryPath === undefined ? {} : { registry_path: registryPath }),
  };
}

/** Process entry point. It performs only reads and stable JSON output. */
export function main(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    process.stdout.write(runCli(parseArgs(argv)));
    return 0;
  } catch (error) {
    const code =
      error instanceof ChallengeTrackCliError ? error.code : "cli_failure";
    process.stderr.write(`${stableJson({ error_code: code })}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  ["cli.ts", "cli.js"].includes(basename(resolve(invokedPath)))
) {
  process.exitCode = main();
}
