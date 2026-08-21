import type { ErrorObject, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import type {
  AgentFeedDeliveryEvent,
  AgentFeedFinding,
  AgentFeedSchemaName,
  AgentFeedSchemaValidator,
  SchemaIssue,
  SchemaValidationResult,
  SubmittedEvidence,
} from "./types.js";
import {
  hasExactKeys,
  isPlainRecord,
  isRecord,
  normalizeText,
} from "./util.js";

type SchemaDocuments = Partial<Record<AgentFeedSchemaName, unknown>>;

const schemaExportNames: Record<AgentFeedSchemaName, string> = {
  deliveryEvent: "deliveryEventSchema",
  finding: "findingSchema",
  evidence: "evidenceSchema",
  runEnvelope: "runEnvelopeSchema",
  runBundle: "runBundleSchema",
  beginRun: "beginRunSchema",
  completeRun: "completeRunSchema",
  submitBatch: "submitBatchSchema",
  streamExpectation: "streamExpectationSchema",
};

function issueFromAjv(error: ErrorObject): SchemaIssue {
  return {
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? "schema validation failed",
  };
}

export function createAjvSchemaValidator(
  documents: SchemaDocuments,
): AgentFeedSchemaValidator {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
  });
  (formatsPlugin as unknown as (instance: Ajv2020) => Ajv2020)(ajv);
  // Register every public document before compiling any validator so the
  // run-bundle document's relative references resolve against its `$id`.
  for (const schema of Object.values(documents)) {
    if (
      schema !== undefined &&
      isPlainRecord(schema) &&
      typeof schema.$id === "string"
    ) {
      ajv.addSchema(schema);
    }
  }
  const validators = new Map<AgentFeedSchemaName, ValidateFunction>();
  for (const [name, schema] of Object.entries(documents) as [
    AgentFeedSchemaName,
    unknown,
  ][]) {
    if (schema === undefined) continue;
    const id =
      isPlainRecord(schema) && typeof schema.$id === "string"
        ? schema.$id
        : undefined;
    validators.set(
      name,
      id === undefined
        ? ajv.compile(schema as Record<string, unknown>)
        : (ajv.getSchema(id) ?? ajv.compile(schema as Record<string, unknown>)),
    );
  }
  return {
    validate(schemaName, value) {
      const validator = validators.get(schemaName);
      if (validator === undefined)
        return {
          valid: false,
          issues: [{ message: `schema_not_loaded:${schemaName}` }],
        };
      const valid = validator(value) as boolean;
      return valid
        ? { valid: true }
        : { valid: false, issues: (validator.errors ?? []).map(issueFromAjv) };
    },
  };
}

/** Build the production validator from only the published public package exports. */
export function createSchemaValidatorFromPackage(
  moduleExports: Record<string, unknown>,
): AgentFeedSchemaValidator {
  const documents: SchemaDocuments = {};
  for (const [name, exportName] of Object.entries(schemaExportNames) as [
    AgentFeedSchemaName,
    string,
  ][]) {
    documents[name] = moduleExports[exportName];
  }
  return createAjvSchemaValidator(documents);
}

let publishedValidatorPromise: Promise<AgentFeedSchemaValidator> | undefined;

/** Lazily load the pinned @agent-feed/schema artifact at the application boundary. */
export async function loadPublishedSchemaValidator(): Promise<AgentFeedSchemaValidator> {
  publishedValidatorPromise ??= import("@agent-feed/schema").then((module) =>
    createSchemaValidatorFromPackage(
      module as unknown as Record<string, unknown>,
    ),
  );
  return publishedValidatorPromise;
}

export function createPublishedSchemaValidator(): AgentFeedSchemaValidator {
  return {
    async validate(schemaName, value) {
      const validator = await loadPublishedSchemaValidator();
      return validator.validate(schemaName, value);
    },
  };
}

const eventTypes = new Set([
  "run.started",
  "finding.submitted",
  "run.completed",
  "run.partial",
  "run.failed",
]);
const evidenceKinds = new Set([
  "web",
  "document",
  "email",
  "api",
  "social_post",
  "database",
  "human_observation",
  "file",
  "other",
]);
const findingAuthorities = new Set([
  "primary",
  "official_secondary",
  "third_party",
  "unknown",
]);
const findingNovelty = new Set(["new", "known", "uncertain"]);
const evidenceCompleteness = new Set(["complete", "partial", "lead_only"]);

function validDateTime(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

function fail(message: string, instancePath = ""): SchemaValidationResult {
  return { valid: false, issues: [{ instancePath, message }] };
}

function requireArray(
  value: unknown,
  path: string,
  minItems = 0,
): SchemaValidationResult | null {
  if (!Array.isArray(value)) return fail("must be an array", path);
  if (value.length < minItems)
    return fail(`must NOT have fewer than ${minItems} items`, path);
  return null;
}

function validSubject(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["type", "id", "name"]) &&
    typeof value.type === "string" &&
    value.type.length > 0 &&
    (typeof value.id === "string" || value.id === null) &&
    (typeof value.name === "string" || value.name === null)
  );
}

function validateDeliveryEvent(value: unknown): SchemaValidationResult {
  if (!isRecord(value)) return fail("must be an object");
  if (
    !hasExactKeys(value, [
      "protocol_version",
      "event_id",
      "event_type",
      "stream_id",
      "run_id",
      "finding_id",
      "occurred_at",
      "attempt",
      "payload",
    ])
  )
    return fail("must contain exactly the protocol event fields");
  if (value.protocol_version !== "0.1")
    return fail("must be equal to 0.1", "/protocol_version");
  if (typeof value.event_id !== "string" || value.event_id.length < 8)
    return fail("must be a string of at least 8 characters", "/event_id");
  if (typeof value.event_type !== "string" || !eventTypes.has(value.event_type))
    return fail("must be a supported event type", "/event_type");
  if (typeof value.stream_id !== "string")
    return fail("must be a string", "/stream_id");
  if (typeof value.run_id !== "string")
    return fail("must be a string", "/run_id");
  if (typeof value.finding_id !== "string" && value.finding_id !== null)
    return fail("must be a string or null", "/finding_id");
  if (!validDateTime(value.occurred_at))
    return fail("must be a date-time", "/occurred_at");
  if (!Number.isSafeInteger(value.attempt) || (value.attempt as number) < 1)
    return fail("must be a positive integer", "/attempt");
  if (!isPlainRecord(value.payload))
    return fail("must be an object", "/payload");
  return { valid: true };
}

function validateFinding(value: unknown): SchemaValidationResult {
  if (!isRecord(value)) return fail("must be an object");
  const required = [
    "finding_id",
    "finding_type",
    "title",
    "summary",
    "subjects",
    "effective_time",
    "assessment",
    "evidence_refs",
    "producer_dedupe_key",
    "routing_tags",
    "attributes",
    "security_flags",
  ] as const;
  if (!hasExactKeys(value, required))
    return fail("must contain exactly the finding fields");
  if (typeof value.finding_id !== "string" || value.finding_id.length < 3)
    return fail("invalid finding_id", "/finding_id");
  if (
    typeof value.finding_type !== "string" ||
    !/^[a-z0-9][a-z0-9._-]+$/u.test(value.finding_type)
  )
    return fail("invalid finding_type", "/finding_type");
  if (
    typeof value.title !== "string" ||
    value.title.length < 3 ||
    value.title.length > 300
  )
    return fail("invalid title", "/title");
  if (
    typeof value.summary !== "string" ||
    value.summary.length < 3 ||
    value.summary.length > 5000
  )
    return fail("invalid summary", "/summary");
  const subjects = requireArray(value.subjects, "/subjects", 1);
  if (subjects) return subjects;
  const subjectValues = value.subjects as unknown[];
  if (!subjectValues.every(validSubject))
    return fail("invalid subject", "/subjects");
  if (
    !isRecord(value.effective_time) ||
    !hasExactKeys(value.effective_time, [
      "occurred_at",
      "effective_from",
      "effective_to",
    ])
  )
    return fail("invalid effective_time", "/effective_time");
  for (const field of [
    "occurred_at",
    "effective_from",
    "effective_to",
  ] as const) {
    if (
      value.effective_time[field] !== null &&
      !validDateTime(value.effective_time[field])
    )
      return fail("must be a date-time or null", `/effective_time/${field}`);
  }
  if (
    !isRecord(value.assessment) ||
    !hasExactKeys(value.assessment, [
      "novelty",
      "source_authority_claim",
      "evidence_completeness",
      "agent_confidence",
    ])
  )
    return fail("invalid assessment", "/assessment");
  if (
    typeof value.assessment.novelty !== "string" ||
    !findingNovelty.has(value.assessment.novelty)
  )
    return fail("invalid novelty", "/assessment/novelty");
  if (
    typeof value.assessment.source_authority_claim !== "string" ||
    !findingAuthorities.has(value.assessment.source_authority_claim)
  )
    return fail(
      "invalid source authority claim",
      "/assessment/source_authority_claim",
    );
  if (
    typeof value.assessment.evidence_completeness !== "string" ||
    !evidenceCompleteness.has(value.assessment.evidence_completeness)
  )
    return fail(
      "invalid evidence completeness",
      "/assessment/evidence_completeness",
    );
  if (
    value.assessment.agent_confidence !== null &&
    (typeof value.assessment.agent_confidence !== "number" ||
      !Number.isFinite(value.assessment.agent_confidence) ||
      value.assessment.agent_confidence < 0 ||
      value.assessment.agent_confidence > 1)
  )
    return fail("invalid agent confidence", "/assessment/agent_confidence");
  for (const [field, itemType] of [
    ["evidence_refs", "string"],
    ["routing_tags", "string"],
    ["security_flags", "string"],
  ] as const) {
    const result = requireArray(value[field], `/${field}`);
    if (result) return result;
    if (
      !(value[field] as unknown[]).every(
        (item: unknown) => typeof item === itemType,
      )
    )
      return fail("array items must be strings", `/${field}`);
  }
  if (!isPlainRecord(value.attributes))
    return fail("must be an object", "/attributes");
  if (
    value.producer_dedupe_key !== null &&
    typeof value.producer_dedupe_key !== "string"
  )
    return fail("must be a string or null", "/producer_dedupe_key");
  return { valid: true };
}

function validateEvidence(value: unknown): SchemaValidationResult {
  if (!isRecord(value)) return fail("must be an object");
  const required = [
    "evidence_id",
    "kind",
    "source",
    "captured_at",
    "published_at",
    "locator",
    "excerpt",
    "content_hash",
    "artifact",
    "handling",
    "metadata",
  ] as const;
  if (!hasExactKeys(value, required))
    return fail("must contain exactly the evidence fields");
  if (typeof value.evidence_id !== "string" || value.evidence_id.length < 3)
    return fail("invalid evidence_id", "/evidence_id");
  if (typeof value.kind !== "string" || !evidenceKinds.has(value.kind))
    return fail("invalid kind", "/kind");
  if (
    !isRecord(value.source) ||
    !hasExactKeys(value.source, ["uri", "title", "publisher", "source_id"])
  )
    return fail("invalid source", "/source");
  for (const field of ["uri", "title", "publisher", "source_id"] as const)
    if (value.source[field] !== null && typeof value.source[field] !== "string")
      return fail("must be a string or null", `/source/${field}`);
  if (!validDateTime(value.captured_at))
    return fail("invalid captured_at", "/captured_at");
  if (value.published_at !== null && !validDateTime(value.published_at))
    return fail("invalid published_at", "/published_at");
  if (value.locator !== null) {
    const locator = value.locator;
    if (
      !isRecord(locator) ||
      !hasExactKeys(locator, ["type", "value", "page"]) ||
      typeof locator.type !== "string" ||
      typeof locator.value !== "string" ||
      (locator.page !== null &&
        (!Number.isSafeInteger(locator.page) || (locator.page as number) < 1))
    )
      return fail("invalid locator", "/locator");
  }
  if (
    value.excerpt !== null &&
    (typeof value.excerpt !== "string" || value.excerpt.length > 5000)
  )
    return fail("invalid excerpt", "/excerpt");
  if (
    value.content_hash !== null &&
    (typeof value.content_hash !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(value.content_hash))
  )
    return fail("invalid content_hash", "/content_hash");
  if (
    !isRecord(value.artifact) ||
    !hasExactKeys(value.artifact, ["uri", "media_type", "size_bytes"])
  )
    return fail("invalid artifact", "/artifact");
  if (
    !isRecord(value.handling) ||
    !hasExactKeys(value.handling, [
      "contains_personal_data",
      "contains_secrets",
      "redistribution_restricted",
    ])
  )
    return fail("invalid handling", "/handling");
  const handling = value.handling;
  if (
    !(
      [
        "contains_personal_data",
        "contains_secrets",
        "redistribution_restricted",
      ] as const
    ).every((field) => typeof handling[field] === "boolean")
  )
    return fail("handling flags must be boolean", "/handling");
  if (!isPlainRecord(value.metadata))
    return fail("must be an object", "/metadata");
  return { valid: true };
}

const terminalPayloadKeys = [
  "status",
  "completed_at",
  "actual_scope",
  "expected_scope",
  "stats",
  "error_summary",
] as const;
const terminalScopeKeys = [
  "source_ids",
  "subjects",
  "queries",
  "metadata",
] as const;
const terminalStatsKeys = [
  "sources_attempted",
  "sources_succeeded",
  "findings_submitted",
  "evidence_submitted",
  "batches_submitted",
] as const;
const terminalStatuses = new Set([
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

function validStringArray(
  value: unknown,
  path: string,
  unique: boolean,
): SchemaValidationResult | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    return fail("must be an array of strings", path);
  if (unique && new Set(value).size !== value.length)
    return fail("must not contain duplicate items", path);
  return null;
}

function validateTerminalScope(
  value: unknown,
  path: string,
): SchemaValidationResult | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, terminalScopeKeys))
    return fail("must be the exact run scope shape", path);
  for (const [field, unique] of [
    ["source_ids", true],
    ["subjects", true],
    ["queries", false],
  ] as const) {
    const issue = validStringArray(value[field], `${path}/${field}`, unique);
    if (issue !== null) return issue;
  }
  if (!isPlainRecord(value.metadata))
    return fail("must be an object", `${path}/metadata`);
  return null;
}

function validateTerminalStats(value: unknown): SchemaValidationResult | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, terminalStatsKeys))
    return fail("must be the exact run stats shape", "/stats");
  for (const field of terminalStatsKeys) {
    if (!Number.isSafeInteger(value[field]) || (value[field] as number) < 0)
      return fail("must be a non-negative integer", `/stats/${field}`);
  }
  return null;
}

/**
 * The v0.1.1 producer emits terminal delivery payloads as a compact, exact
 * six-field object rather than a run envelope. Keep this validator local to
 * the consumer boundary because it is not one of the published schema docs.
 */
export function validateTerminalDeliveryPayload(
  value: unknown,
  eventType: AgentFeedDeliveryEvent["event_type"],
): SchemaValidationResult {
  if (
    eventType !== "run.completed" &&
    eventType !== "run.partial" &&
    eventType !== "run.failed"
  ) {
    return fail("must be used with a terminal delivery event", "/event_type");
  }
  if (!isPlainRecord(value) || !hasExactKeys(value, terminalPayloadKeys))
    return fail("must be the exact terminal delivery payload shape");
  if (typeof value.status !== "string" || !terminalStatuses.has(value.status))
    return fail("must be a terminal status", "/status");
  const eventDefault =
    eventType === "run.completed"
      ? "completed"
      : eventType === "run.partial"
        ? "partial"
        : "failed";
  // The pinned producer maps its cancelled terminal status through the
  // run.failed event selector; run.completed is reserved for completed.
  if (
    value.status === "cancelled"
      ? eventType !== "run.failed"
      : value.status !== eventDefault
  ) {
    return fail("status does not match event type", "/status");
  }
  if (!validDateTime(value.completed_at))
    return fail("must be a date-time", "/completed_at");
  const actualScopeIssue = validateTerminalScope(
    value.actual_scope,
    "/actual_scope",
  );
  if (actualScopeIssue !== null) return actualScopeIssue;
  const expectedScopeIssue = validateTerminalScope(
    value.expected_scope,
    "/expected_scope",
  );
  if (expectedScopeIssue !== null) return expectedScopeIssue;
  const statsIssue = validateTerminalStats(value.stats);
  if (statsIssue !== null) return statsIssue;
  if (value.error_summary !== null && typeof value.error_summary !== "string")
    return fail("must be a string or null", "/error_summary");
  return { valid: true };
}

/** Local validator seam used by focused package tests before the release artifact is installed. */
export function createFallbackSchemaValidator(): AgentFeedSchemaValidator {
  return {
    validate(schemaName, value) {
      switch (schemaName) {
        case "deliveryEvent":
          return validateDeliveryEvent(value);
        case "finding":
          return validateFinding(value);
        case "evidence":
          return validateEvidence(value);
        default:
          return { valid: true };
      }
    },
  };
}

export function assertFinding(
  value: unknown,
): asserts value is AgentFeedFinding {
  const result = createFallbackSchemaValidator().validate("finding", value);
  const resolved = result as SchemaValidationResult;
  if (!resolved.valid)
    throw new TypeError(
      `invalid_finding_schema:${resolved.issues?.[0]?.message ?? "unknown"}`,
    );
}

export function assertSubmittedEvidence(
  value: unknown,
): asserts value is SubmittedEvidence {
  const result = createFallbackSchemaValidator().validate("evidence", value);
  const resolved = result as SchemaValidationResult;
  if (!resolved.valid)
    throw new TypeError(
      `invalid_evidence_schema:${resolved.issues?.[0]?.message ?? "unknown"}`,
    );
}

export function summarizeSchemaIssues(result: SchemaValidationResult): string {
  return (result.issues ?? [])
    .slice(0, 3)
    .map(
      (issue) => `${issue.instancePath ?? ""}:${normalizeText(issue.message)}`,
    )
    .join("; ");
}
