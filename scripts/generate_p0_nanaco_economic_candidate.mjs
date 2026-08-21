import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const AUTHORITATIVE_MANIFEST = path.join(
  root,
  "fixtures/m3/real-data/jp-cvs-006/golden-scenario.v1.manifest.json",
);
const BASE_COVERAGE = path.join(
  root,
  "fixtures/m3/provisional/p0-coverage-index.v0.1.json",
);
const CANDIDATE_OUTPUT = path.join(
  root,
  "fixtures/m3/provisional/p0-nanaco-economic-candidate.v0.1.json",
);
const COVERAGE_OUTPUT = path.join(
  root,
  "fixtures/m3/provisional/p0-coverage-index.v0.2.json",
);
const GENERATED_MODULE_OUTPUT = path.join(
  root,
  "packages/provisional-rules/src/nanaco-pilot.generated.ts",
);

const RULE_ID = "rr_jp_cvs_006_nanaco_purchase_reward";
const EXPECTED_DEFINITION_HASH =
  "sha256:9f8cb5de0af689ee8ca751a3ae6a34c2d974eb1c79c29c60bd555da4db116746";
const FAMILY_ID = "point.nanaco";
const SOURCE_ROLE_ID = "earn_rules";
const SOURCE_ID = "jp.nanaco.shopping-earning";
const EVIDENCE_ID = "ev_m3_nanaco_shopping_earning_20260820";
const OBSERVATION_ID = "so_p0_nanaco_earn_rules_20260821";
const CHECKED_AT = "2026-08-21T00:05:00Z";
const CANDIDATE_ID = "candidate_p0_nanaco_shopping_earning_20260821_v0_1";

function normalize(value, valuePath = "") {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError(`Cannot canonicalize non-finite number at ${valuePath || "<root>"}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value))
    return value.map((item, index) => normalize(item, `${valuePath}/${index}`));
  if (typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item !== undefined) output[key] = normalize(item, `${valuePath}/${key}`);
    }
    return output;
  }
  if (value === undefined)
    throw new TypeError(`Cannot canonicalize undefined at ${valuePath || "<root>"}`);
  throw new TypeError(`Cannot canonicalize value at ${valuePath || "<root>"}`);
}

function canonicalize(value) {
  return JSON.stringify(normalize(value));
}

function canonicalSha256(value) {
  return `sha256:${createHash("sha256").update(canonicalize(value), "utf8").digest("hex")}`;
}

function definitionHash(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return canonicalSha256(value);
  const copy = { ...value };
  for (const key of [
    "version",
    "status",
    "validity",
    "provenance",
    "audit",
    "definition_hash",
  ])
    delete copy[key];
  return canonicalSha256(copy);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function findAuthoritativeRule(manifest) {
  const rules = manifest?.replay_input_projection?.base_context?.rules;
  assert(Array.isArray(rules), "authoritative manifest rule projection is missing");
  const matches = rules.filter((rule) => rule?.rule_id === RULE_ID);
  assert(matches.length === 1, `expected one authoritative ${RULE_ID} projection`);
  const rule = matches[0];
  assert(
    definitionHash(rule) === EXPECTED_DEFINITION_HASH,
    `authoritative ${RULE_ID} definition hash drifted`,
  );
  return rule;
}

function observationFingerprint() {
  // This is a deterministic binding placeholder for the future Agent Feed
  // observation.  It intentionally contains source/role/status metadata only;
  // no reward rate, spend denominator, rounding, or scope value is read from
  // an Agent Feed payload.
  return canonicalSha256({
    observation_id: OBSERVATION_ID,
    p0_family_id: FAMILY_ID,
    source_authority_claim: "primary",
    source_ids: [SOURCE_ID],
    source_role_id: SOURCE_ROLE_ID,
    status: "needs_review",
  });
}

function provisionalRule(authoritativeRule) {
  const rule = structuredClone(authoritativeRule);
  rule.status = "under_review";
  rule.provenance = {
    ...rule.provenance,
    evidence_ids: [EVIDENCE_ID],
    human_verified: false,
    review_notes:
      "Source-bound provisional candidate; no human verification or publication claim is made.",
  };
  rule.audit = {
    ...rule.audit,
    created_at: "2026-08-21T00:04:00Z",
    created_by: "p0-nanaco-economic-extractor",
    review_events: [],
    required_review_modes: ["solo_dual_pass", "agent_challenged"],
    review_mode: null,
    reviewed_at: null,
    reviewed_by: null,
    change_reason:
      "Deterministic provisional candidate copied from the checked-in economic definition; not a publication decision.",
  };
  return rule;
}

function buildCandidate(authoritativeRule) {
  const rule = provisionalRule(authoritativeRule);
  assert(
    definitionHash(rule) === EXPECTED_DEFINITION_HASH,
    "provisional metadata changed the economic definition",
  );
  return {
    version: "provisional-rule-candidate.v1",
    candidate_id: CANDIDATE_ID,
    observation_id: OBSERVATION_ID,
    observation_fingerprint: observationFingerprint(),
    p0_family_id: FAMILY_ID,
    source_role_id: SOURCE_ROLE_ID,
    source_authority_role: "primary",
    source_ids: [SOURCE_ID],
    rule,
    extractor: {
      name: "p0-nanaco-economic-extractor",
      version: "0.1",
    },
    machine_check: {
      checker: "p0-nanaco-economic-semantic-check",
      checker_version: "0.1",
      checked_at: CHECKED_AT,
      checks: {
        representation_safe: true,
        rule_structure: true,
        rule_semantics: true,
        observation_binding: true,
        p0_coverage: true,
      },
    },
  };
}

function buildCoverage(base) {
  assert(base?.version === "p0-coverage-index.v0.1", "unexpected P0 coverage base version");
  const expectedBaseEntries = [
    {
      family_id: "merchant.7eleven",
      source_role_id: "accepted_payment_methods",
      known_source_ids: ["merchant.seveneleven.payment-methods"],
    },
  ];
  assert(
    canonicalize(base.entries) === canonicalize(expectedBaseEntries),
    "P0 coverage v0.1 changed; refusing to infer additional coverage",
  );
  const addedEntry = {
    family_id: FAMILY_ID,
    source_role_id: SOURCE_ROLE_ID,
    known_source_ids: [SOURCE_ID],
  };
  return {
    version: "p0-coverage-index.v0.2",
    entries: [...base.entries, addedEntry],
  };
}

function generatedModuleSource(candidate, coverage) {
  const coverageHash = canonicalSha256(coverage);
  const candidateHash = canonicalSha256(candidate);
  const candidateJson = JSON.stringify(candidate)
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'");
  const coverageJson = JSON.stringify(coverage)
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'");
  return `/* eslint-disable */
/**
 * Generated by scripts/generate_p0_nanaco_economic_candidate.mjs.
 * Do not edit by hand: this module is the sealed nanaco pilot artifact.
 */
import { hashCanonical, hashDefinition } from "./canonical.js";
import { deepFreeze } from "./security.js";
import type { P0CoverageIndex, ProvisionalRuleCandidate } from "./types.js";

const candidate = JSON.parse(
  '${candidateJson}',
) as unknown as ProvisionalRuleCandidate;
const coverage = JSON.parse(
  '${coverageJson}',
) as unknown as P0CoverageIndex;

export const NANACO_PILOT_RULE_ID =
  ${JSON.stringify(RULE_ID)} as const;
export const NANACO_PILOT_FAMILY_ID = ${JSON.stringify(FAMILY_ID)} as const;
export const NANACO_PILOT_SOURCE_ROLE_ID = ${JSON.stringify(SOURCE_ROLE_ID)} as const;
export const NANACO_PILOT_SOURCE_ID = ${JSON.stringify(SOURCE_ID)} as const;
export const NANACO_PILOT_CANONICAL_EVIDENCE_ID =
  ${JSON.stringify(EVIDENCE_ID)} as const;
export const NANACO_PILOT_DEFINITION_HASH =
  ${JSON.stringify(EXPECTED_DEFINITION_HASH)} as const;
export const NANACO_PILOT_COVERAGE_HASH =
  ${JSON.stringify(coverageHash)} as const;
export const NANACO_PILOT_CANDIDATE_ARTIFACT_HASH =
  ${JSON.stringify(candidateHash)} as const;
export const NANACO_PILOT_CANDIDATE = deepFreeze(candidate);
export const NANACO_PILOT_COVERAGE = deepFreeze(coverage);

if (
  hashDefinition(NANACO_PILOT_CANDIDATE.rule) !== NANACO_PILOT_DEFINITION_HASH
)
  throw new Error("nanaco pilot definition artifact drift");
if (hashCanonical(NANACO_PILOT_COVERAGE) !== NANACO_PILOT_COVERAGE_HASH)
  throw new Error("nanaco pilot coverage artifact drift");
if (
  hashCanonical(NANACO_PILOT_CANDIDATE) !== NANACO_PILOT_CANDIDATE_ARTIFACT_HASH
)
  throw new Error("nanaco pilot candidate artifact drift");
`;
}

async function expectedOutputs() {
  const manifest = await readJson(AUTHORITATIVE_MANIFEST);
  const baseCoverage = await readJson(BASE_COVERAGE);
  const authoritativeRule = findAuthoritativeRule(manifest);
  const candidate = buildCandidate(authoritativeRule);
  const coverage = buildCoverage(baseCoverage);
  return {
    candidate,
    coverage,
    generatedModule: generatedModuleSource(candidate, coverage),
  };
}

async function assertFileMatches(filePath, expected) {
  const actual = await fs.readFile(filePath, "utf8");
  const expectedText = `${JSON.stringify(expected, null, 2)}\n`;
  assert(actual === expectedText, `${path.relative(root, filePath)} is stale; run generator without --check`);
}

async function assertTextFileMatches(filePath, expected) {
  const actual = await fs.readFile(filePath, "utf8");
  assert(actual === expected, `${path.relative(root, filePath)} is stale; run generator without --check`);
}

const outputs = await expectedOutputs();
if (process.argv.includes("--check")) {
  await assertFileMatches(CANDIDATE_OUTPUT, outputs.candidate);
  await assertFileMatches(COVERAGE_OUTPUT, outputs.coverage);
  await assertTextFileMatches(GENERATED_MODULE_OUTPUT, outputs.generatedModule);
  console.log("p0 nanaco economic candidate: checked");
} else {
  await fs.writeFile(
    CANDIDATE_OUTPUT,
    `${JSON.stringify(outputs.candidate, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    COVERAGE_OUTPUT,
    `${JSON.stringify(outputs.coverage, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(GENERATED_MODULE_OUTPUT, outputs.generatedModule, "utf8");
  console.log("p0 nanaco economic candidate: generated");
}
