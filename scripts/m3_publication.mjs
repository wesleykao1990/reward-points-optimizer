#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const publicationDirectory = resolve(root, "fixtures/m3/publication");
const candidatePath = resolve(
  publicationDirectory,
  "m3-real-data-alpha-publication-candidate.v0.1.json",
);
const decisionPath = resolve(
  publicationDirectory,
  "m3-real-data-alpha-publication-decision.v0.1.json",
);
const publicationSqlPath = resolve(root, "db/seeds/002_m3_real_data_publication.sql");
const selfTestSqlPath = "/tmp/jro-m3-publication-self-test.sql";
const evidenceIndexPath = resolve(root, "fixtures/m3/real-data-alpha-evidence-index.v0.1.json");
const scenarioIds = ["JP-CVS-002", "JP-CVS-006"];
const nonPublishableRules = new Map([
  [
    "rr_jp_cvs_002_a_deny_unsupported_tender",
    "Deliberately synthetic negative-test tender; retained only in the immutable golden fixture.",
  ],
]);
const requiredConfirmationIds = [
  "official_source_facts_match",
  "calculation_and_boundaries_match",
  "five_rule_scope_only",
  "correction_and_rollback_understood",
];

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalHash(value) {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function jsonBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlTextArray(values) {
  return `array[${values.map(sqlText).join(", ")}]::text[]`;
}

function riskFlags(ruleId) {
  const flags = ["financial_rule"];
  if (ruleId.includes("accept") || ruleId.includes("payment") || ruleId.includes("tender")) {
    flags.push("funding_source_or_tender_acceptance");
  }
  if (ruleId.includes("credit_topup") || ruleId.includes("credit_acceptance")) {
    flags.push("material_spend_commitment");
  }
  if (ruleId.includes("reward")) flags.push("reward_rate");
  return flags.sort();
}

function buildCandidate() {
  const evidenceIndex = loadJson(evidenceIndexPath);
  const evidenceById = new Map(
    evidenceIndex.records.map((record) => [record.evidence_id, record]),
  );
  const rules = new Map();
  const excludedRules = new Map();
  const scenarios = [];

  for (const scenarioId of scenarioIds) {
    const directory = resolve(root, `fixtures/m3/real-data/${scenarioId.toLowerCase()}`);
    const fixture = loadJson(resolve(directory, "golden-scenario.v1.json"));
    const manifest = loadJson(resolve(directory, "golden-scenario.v1.manifest.json"));
    assert(fixture.scenario_id === scenarioId, `${scenarioId}: fixture identity mismatch`);
    assert(manifest.scenario_id === scenarioId, `${scenarioId}: manifest identity mismatch`);
    assert(
      canonicalHash(fixture) === manifest.canonical_fixture_hash,
      `${scenarioId}: canonical fixture hash mismatch`,
    );
    scenarios.push({
      scenario_id: scenarioId,
      fixture_version: fixture.version,
      fixture_hash: manifest.canonical_fixture_hash,
      replay_input_hash: fixture.replay_provenance.input_hash,
      replay_output_hash: fixture.replay_provenance.output_hash,
      scenario_reviewed_at: fixture.review.verified_at,
      evidence_ids: [...fixture.evidence_ids].sort(),
      publication_authorized: fixture.replay_provenance.publication_authorized,
    });

    for (const binding of fixture.rule_version_bindings) {
      assert(
        binding.source_candidate_status === "under_review",
        `${binding.rule_id}: source candidate is not under_review`,
      );
      for (const evidenceId of binding.evidence_ids) {
        assert(evidenceById.has(evidenceId), `${binding.rule_id}: unknown evidence ${evidenceId}`);
      }
      if (nonPublishableRules.has(binding.rule_id)) {
        excludedRules.set(binding.rule_id, {
          rule_id: binding.rule_id,
          source_version: binding.version,
          definition_hash: binding.definition_hash,
          scenario_ids: [scenarioId],
          reason: nonPublishableRules.get(binding.rule_id),
        });
        continue;
      }
      const existing = rules.get(binding.rule_id);
      if (existing) {
        assert(
          existing.source_version === binding.version &&
            existing.definition_hash === binding.definition_hash &&
            canonicalize(existing.evidence_ids) === canonicalize([...binding.evidence_ids].sort()),
          `${binding.rule_id}: conflicting scenario bindings`,
        );
        existing.scenario_ids.push(scenarioId);
        existing.roles.push(...binding.roles);
      } else {
        rules.set(binding.rule_id, {
          rule_id: binding.rule_id,
          source_version: binding.version,
          publication_version: binding.version + 1,
          definition_hash: binding.definition_hash,
          valid_from: binding.validity.valid_from,
          valid_to: binding.validity.valid_to,
          source_recorded_at: binding.validity.recorded_at,
          evidence_ids: [...binding.evidence_ids].sort(),
          scenario_ids: [scenarioId],
          roles: [...binding.roles],
          risk_flags: riskFlags(binding.rule_id),
        });
      }
    }
  }

  const normalizedRules = [...rules.values()]
    .map((rule) => ({
      ...rule,
      scenario_ids: [...new Set(rule.scenario_ids)].sort(),
      roles: [...new Set(rule.roles)].sort(),
    }))
    .sort((left, right) => left.rule_id.localeCompare(right.rule_id));
  assert(normalizedRules.length === 5, `expected five publication rules, found ${normalizedRules.length}`);
  assert(excludedRules.size === 1, `expected one non-publishable rule, found ${excludedRules.size}`);
  assert(
    scenarios.every((scenario) => scenario.publication_authorized === false),
    "golden replay unexpectedly authorizes publication",
  );

  const core = {
    candidate_version: "m3.real-data-alpha-publication-candidate.v0.1",
    generated_from: {
      evidence_index: relative(root, evidenceIndexPath),
      scenario_manifests: scenarioIds.map(
        (scenarioId) =>
          `fixtures/m3/real-data/${scenarioId.toLowerCase()}/golden-scenario.v1.manifest.json`,
      ),
    },
    scope: {
      scenario_ids: [...scenarioIds],
      rule_count: normalizedRules.length,
      excluded_rule_count: excludedRules.size,
      frontend_activation: false,
      production_authorization: false,
      human_review_not_before: scenarios
        .map((scenario) => scenario.scenario_reviewed_at)
        .sort()
        .at(-1),
    },
    scenarios,
    rules: normalizedRules,
    non_publishable_rules: [...excludedRules.values()].sort((left, right) =>
      left.rule_id.localeCompare(right.rule_id),
    ),
    required_human_confirmations: [
      {
        confirmation_id: "official_source_facts_match",
        instruction:
          "Verify the paraphrased facts against the listed official pages, especially tender exclusions, preregistration, charge limits, and both reward rates.",
      },
      {
        confirmation_id: "calculation_and_boundaries_match",
        instruction:
          "Confirm JP-CVS-002 accepts the supported credit-card family and rejects the unsupported tender; confirm JP-CVS-006 gives 25 charge points plus 3 purchase points, JPY 4,340 residual, rejects JPY 4,000, and requires preregistration.",
      },
      {
        confirmation_id: "five_rule_scope_only",
        instruction:
          "Confirm authorization is limited to the five listed version-2 rules; the deliberately synthetic unsupported-tender rule stays unpublished, and neither frontend nor production mode is activated.",
      },
      {
        confirmation_id: "correction_and_rollback_understood",
        instruction:
          "Confirm any later correction must create a new evidence record and rule version; a published definition will not be edited in place.",
      },
    ],
  };
  return { ...core, candidate_hash: canonicalHash(core) };
}

function pendingDecision(candidateHash) {
  return {
    decision_version: "m3.real-data-alpha-publication-decision.v0.1",
    candidate_hash: candidateHash,
    status: "pending",
    reviewer_id: null,
    reviewed_at: null,
    confirmations: requiredConfirmationIds.map((confirmationId) => ({
      confirmation_id: confirmationId,
      confirmed: false,
      notes: null,
    })),
    decision_notes: null,
  };
}

function validateDecision(decision, candidate, requireApproved) {
  assert(
    exactKeys(decision, [
      "decision_version",
      "candidate_hash",
      "status",
      "reviewer_id",
      "reviewed_at",
      "confirmations",
      "decision_notes",
    ]),
    "decision: unexpected or missing fields",
  );
  assert(
    decision.decision_version === "m3.real-data-alpha-publication-decision.v0.1",
    "decision: unsupported version",
  );
  assert(decision.candidate_hash === candidate.candidate_hash, "decision: candidate hash mismatch");
  assert(["pending", "approved", "rejected"].includes(decision.status), "decision: invalid status");
  assert(Array.isArray(decision.confirmations), "decision: confirmations must be an array");
  assert(decision.confirmations.length === requiredConfirmationIds.length, "decision: confirmation count mismatch");
  const confirmationIds = decision.confirmations.map((row) => row.confirmation_id);
  assert(new Set(confirmationIds).size === confirmationIds.length, "decision: duplicate confirmation");
  assert(
    canonicalize([...confirmationIds].sort()) === canonicalize([...requiredConfirmationIds].sort()),
    "decision: confirmation coverage mismatch",
  );
  for (const row of decision.confirmations) {
    assert(
      exactKeys(row, ["confirmation_id", "confirmed", "notes"]),
      `decision: invalid confirmation shape for ${row.confirmation_id}`,
    );
    assert(typeof row.confirmed === "boolean", `decision: invalid confirmation value for ${row.confirmation_id}`);
    assert(row.notes === null || typeof row.notes === "string", `decision: invalid notes for ${row.confirmation_id}`);
  }

  if (decision.status === "pending") {
    assert(decision.reviewer_id === null, "pending decision cannot name a reviewer");
    assert(decision.reviewed_at === null, "pending decision cannot have a review time");
    assert(decision.confirmations.every((row) => row.confirmed === false), "pending decision cannot confirm items");
    assert(!requireApproved, "publication_not_authorized");
    return;
  }
  if (decision.status === "rejected") {
    assert(typeof decision.reviewer_id === "string" && decision.reviewer_id.length >= 3, "rejected decision needs reviewer_id");
    assert(!Number.isNaN(Date.parse(decision.reviewed_at)), "rejected decision needs reviewed_at");
    assert(!requireApproved, "publication_rejected");
    return;
  }

  assert(typeof decision.reviewer_id === "string" && decision.reviewer_id.length >= 3, "approved decision needs reviewer_id");
  assert(!/codex|agent|bot|model|assistant/i.test(decision.reviewer_id), "reviewer_id must identify the accountable human");
  const reviewedAt = Date.parse(decision.reviewed_at);
  assert(!Number.isNaN(reviewedAt), "approved decision needs an ISO reviewed_at");
  assert(
    reviewedAt >= Date.parse(candidate.scope.human_review_not_before),
    "approved decision predates the completed scenario reviews",
  );
  assert(reviewedAt <= Date.now() + 5 * 60 * 1000, "approved decision cannot be future-dated");
  assert(decision.confirmations.every((row) => row.confirmed === true), "approved decision requires every confirmation");
  assert(
    typeof decision.decision_notes === "string" && decision.decision_notes.trim().length >= 12,
    "approved decision requires meaningful decision_notes",
  );
}

function decisionHash(decision) {
  return canonicalHash(decision);
}

function buildPublicationSql(candidate, decision) {
  validateDecision(decision, candidate, true);
  const requestHash = canonicalHash({
    candidate_hash: candidate.candidate_hash,
    decision_hash: decisionHash(decision),
  });
  const lines = [
    "-- GENERATED FILE. Run `pnpm publication:m3:generate` after accountable human approval.",
    "-- Publishes only the five reviewed real rule versions; the synthetic negative-test rule stays unpublished.",
    "\\set ON_ERROR_STOP on",
    "begin;",
    "set constraints all deferred;",
    "",
  ];

  for (const rule of candidate.rules) {
    lines.push(
      `insert into app_private.reward_rule_versions (` +
        `rule_id, version, definition, definition_hash, valid_from, valid_to, recorded_at, ` +
        `review_status, review_mode, required_review_modes, completed_review_modes, reviewed_by, ` +
        `reviewed_at, change_reason, created_by, created_at) ` +
        `select rr.id, ${rule.publication_version}, source.definition, source.definition_hash, ` +
        `source.valid_from, source.valid_to, ${sqlText(decision.reviewed_at)}, 'approved', ` +
        `'human_second_review', array['human_second_review']::text[], ` +
        `array['human_second_review']::text[], ${sqlText(decision.reviewer_id)}, ` +
        `${sqlText(decision.reviewed_at)}, ` +
        `${sqlText(`Human-authorized publication of hash-identical reviewed candidate ${candidate.candidate_hash}.`)}, ` +
        `${sqlText(decision.reviewer_id)}, ${sqlText(decision.reviewed_at)} ` +
        `from app_private.reward_rules rr ` +
        `join app_private.reward_rule_versions source on source.rule_id = rr.id ` +
        `where rr.rule_key = ${sqlText(rule.rule_id)} and source.version = ${rule.source_version} ` +
        `and source.review_status = 'under_review' and source.definition_hash = ${sqlText(rule.definition_hash)} ` +
        `and exists (` +
        `select 1 from app_private.scenario_rule_versions srv ` +
        `join app_private.scenario_fixtures sf on sf.id = srv.scenario_fixture_id ` +
        `join app_private.scenario_canonical_replays scr on scr.scenario_fixture_id = sf.id ` +
        `join app_private.canonical_replay_runs cr on cr.id = scr.replay_run_id ` +
        `where srv.rule_version_id = source.id and sf.status = 'golden' and cr.sealed_at is not null` +
        `);`,
    );
    lines.push(
      `insert into app_private.rule_evidence (rule_version_id, evidence_id, supported_paths) ` +
        `select target.id, source_evidence.evidence_id, source_evidence.supported_paths ` +
        `from app_private.reward_rules rr ` +
        `join app_private.reward_rule_versions source on source.rule_id = rr.id and source.version = ${rule.source_version} ` +
        `join app_private.reward_rule_versions target on target.rule_id = rr.id and target.version = ${rule.publication_version} ` +
        `join app_private.rule_evidence source_evidence on source_evidence.rule_version_id = source.id ` +
        `where rr.rule_key = ${sqlText(rule.rule_id)};`,
    );
    lines.push(
      `insert into app_private.review_items (` +
        `review_type, subject_type, subject_id, external_subject_key, priority, status, assigned_to, payload, closed_at) ` +
        `select 'rule', 'reward_rule_version', rrv.id, ${sqlText(`${rule.rule_id}:v${rule.publication_version}`)}, ` +
        `'high', 'approved', ${sqlText(decision.reviewer_id)}, ` +
        `jsonb_build_object('candidate_hash', ${sqlText(candidate.candidate_hash)}, ` +
        `'decision_hash', ${sqlText(decisionHash(decision))}), ${sqlText(decision.reviewed_at)} ` +
        `from app_private.reward_rules rr join app_private.reward_rule_versions rrv on rrv.rule_id = rr.id ` +
        `where rr.rule_key = ${sqlText(rule.rule_id)} and rrv.version = ${rule.publication_version};`,
    );
    lines.push(
      `insert into app_private.review_decisions (` +
        `review_item_id, review_mode, decision, rationale, decided_by, decided_at, evidence_refs) ` +
        `select ri.id, 'human_second_review', 'approved', ${sqlText(decision.decision_notes)}, ` +
        `${sqlText(decision.reviewer_id)}, ${sqlText(decision.reviewed_at)}, ` +
        `to_jsonb(${sqlTextArray(rule.evidence_ids)}) ` +
        `from app_private.review_items ri ` +
        `where ri.subject_type = 'reward_rule_version' ` +
        `and ri.external_subject_key = ${sqlText(`${rule.rule_id}:v${rule.publication_version}`)};`,
    );
    lines.push(
      `insert into app_private.rule_publication_requests (` +
        `rule_id, idempotency_key, request_hash, resulting_rule_version_id, status, created_by, created_at, completed_at) ` +
        `select rr.id, ${sqlText(`m3-real-data-alpha-v0.1:${rule.rule_id}:v${rule.publication_version}`)}, ` +
        `${sqlText(requestHash)}, rrv.id, 'published', ${sqlText(decision.reviewer_id)}, ` +
        `${sqlText(decision.reviewed_at)}, ${sqlText(decision.reviewed_at)} ` +
        `from app_private.reward_rules rr join app_private.reward_rule_versions rrv on rrv.rule_id = rr.id ` +
        `where rr.rule_key = ${sqlText(rule.rule_id)} and rrv.version = ${rule.publication_version};`,
    );
    lines.push(
      `update app_private.reward_rules set lifecycle_status = 'published' ` +
        `where rule_key = ${sqlText(rule.rule_id)} and lifecycle_status = 'under_review';`,
      "",
    );
  }
  const ruleIds = candidate.rules.map((rule) => rule.rule_id);
  lines.push(
    "do $$",
    "declare",
    "    v_count integer;",
    "begin",
    `    select count(*) into v_count from app_private.reward_rules rr ` +
      `join app_private.reward_rule_versions rrv on rrv.rule_id = rr.id ` +
      `join app_private.rule_publication_requests rpr on rpr.resulting_rule_version_id = rrv.id ` +
      `where rr.rule_key = any(${sqlTextArray(ruleIds)}) and rr.lifecycle_status = 'published' ` +
      `and rrv.version = 2 and rrv.review_status = 'approved' and rpr.status = 'published';`,
    `    if v_count <> ${candidate.rules.length} then raise exception 'M3 publication did not atomically produce the exact approved rule and receipt set'; end if;`,
    `    select count(*) into v_count from app_api.approved_reward_rule_versions ` +
      `where rule_key = any(${sqlTextArray(ruleIds)});`,
    `    if v_count <> ${candidate.rules.length} then raise exception 'M3 publication API projection count mismatch'; end if;`,
    `    if exists (select 1 from app_private.reward_rules where rule_key = ${sqlText("rr_jp_cvs_002_a_deny_unsupported_tender")} and lifecycle_status <> 'under_review') then`,
    "        raise exception 'synthetic negative-test rule was advanced toward publication';",
    "    end if;",
    "end",
    "$$;",
    "",
  );
  lines.push("set constraints all immediate;", "commit;", "");
  return `${lines.join("\n")}\n`;
}

function runSelfTest(candidate) {
  const pending = pendingDecision(candidate.candidate_hash);
  validateDecision(pending, candidate, false);
  assertThrows(() => validateDecision(pending, candidate, true), "publication_not_authorized");
  assertThrows(
    () => validateDecision({ ...pending, candidate_hash: `sha256:${"0".repeat(64)}` }, candidate, false),
    "candidate hash mismatch",
  );
  const approved = {
    ...pending,
    status: "approved",
    reviewer_id: "human-reviewer-example",
    reviewed_at: new Date().toISOString(),
    confirmations: pending.confirmations.map((row) => ({ ...row, confirmed: true })),
    decision_notes: "Human test approval for the deterministic self-test only.",
  };
  const sql = buildPublicationSql(candidate, approved);
  assert(
    (sql.match(/insert into app_private\.reward_rule_versions/g) ?? []).length === candidate.rules.length,
    "self-test: SQL rule count mismatch",
  );
  assert(
    (sql.match(/update app_private\.reward_rules set lifecycle_status = 'published'/g) ?? []).length ===
      candidate.rules.length,
    "self-test: SQL publication count mismatch",
  );
  assert(!/frontend|production mode[^.]*activate/i.test(sql.split("\n").slice(3).join("\n")), "self-test: SQL contains activation behavior");
}

function selfTestApprovedDecision(candidate) {
  const pending = pendingDecision(candidate.candidate_hash);
  return {
    ...pending,
    status: "approved",
    reviewer_id: "human-reviewer-self-test",
    reviewed_at: "2026-08-20T12:00:00+09:00",
    confirmations: pending.confirmations.map((row) => ({ ...row, confirmed: true })),
    decision_notes: "Synthetic approval used only in a disposable PostgreSQL publication test.",
  };
}

function assertThrows(callback, expected) {
  try {
    callback();
  } catch (error) {
    assert(error instanceof Error && error.message.includes(expected), `self-test: expected ${expected}`);
    return;
  }
  throw new Error(`self-test: expected throw containing ${expected}`);
}

const candidate = buildCandidate();
const mode = process.argv[2];

if (mode === "--write") {
  mkdirSync(publicationDirectory, { recursive: true });
  writeFileSync(candidatePath, jsonBytes(candidate));
  if (!existsSync(decisionPath)) {
    writeFileSync(decisionPath, jsonBytes(pendingDecision(candidate.candidate_hash)));
  } else {
    const decision = loadJson(decisionPath);
    if (decision.status === "approved" && decision.candidate_hash !== candidate.candidate_hash) {
      throw new Error("approved decision is bound to an older candidate; do not overwrite it");
    }
    if (decision.status === "pending") {
      writeFileSync(decisionPath, jsonBytes(pendingDecision(candidate.candidate_hash)));
    }
  }
  console.log(`Wrote ${relative(root, candidatePath)} and preserved/created the decision file`);
} else if (mode === "--check") {
  assert(readFileSync(candidatePath, "utf8") === jsonBytes(candidate), "publication candidate is stale");
  const decision = loadJson(decisionPath);
  validateDecision(decision, candidate, false);
  if (decision.status !== "approved") {
    assert(!existsSync(publicationSqlPath), "publication SQL exists without an approved decision");
  }
  console.log(`Verified publication candidate; decision status: ${decision.status}`);
} else if (mode === "--authorize-check") {
  assert(readFileSync(candidatePath, "utf8") === jsonBytes(candidate), "publication candidate is stale");
  validateDecision(loadJson(decisionPath), candidate, true);
  console.log("Verified accountable human publication authorization");
} else if (mode === "--sql-write") {
  const decision = loadJson(decisionPath);
  const sql = buildPublicationSql(candidate, decision);
  writeFileSync(publicationSqlPath, sql);
  console.log(`Wrote ${relative(root, publicationSqlPath)}`);
} else if (mode === "--sql-check") {
  const decision = loadJson(decisionPath);
  const sql = buildPublicationSql(candidate, decision);
  assert(readFileSync(publicationSqlPath, "utf8") === sql, "publication SQL is stale");
  console.log(`Verified ${relative(root, publicationSqlPath)}`);
} else if (mode === "--self-test") {
  runSelfTest(candidate);
  console.log("M3 publication hostile self-test passed");
} else if (mode === "--sql-self-test-write") {
  writeFileSync(selfTestSqlPath, buildPublicationSql(candidate, selfTestApprovedDecision(candidate)));
  console.log(`Wrote ${selfTestSqlPath} for disposable database testing only`);
} else {
  console.error(
    "Usage: node scripts/m3_publication.mjs --write|--check|--authorize-check|--sql-write|--sql-check|--self-test|--sql-self-test-write",
  );
  process.exit(2);
}
