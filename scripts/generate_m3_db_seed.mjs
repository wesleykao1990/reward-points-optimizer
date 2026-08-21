#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import process from "node:process";
import YAML from "yaml";

const root = resolve(import.meta.dirname, "..");
const outputPath = resolve(root, "db/seeds/001_m3_real_data_goldens.sql");
const indexPath = resolve(root, "fixtures/m3/real-data-alpha-evidence-index.v0.1.json");
const registryPath = resolve(root, "registry/trusted-sources.v0.3.json");
const scenarioIds = ["JP-CVS-002", "JP-CVS-006"];

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

function sqlText(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  return `${sqlText(JSON.stringify(value))}::jsonb`;
}

function sqlTextArray(values) {
  if (!values || values.length === 0) return "'{}'::text[]";
  return `array[${values.map(sqlText).join(", ")}]::text[]`;
}

function economicDefinition(rule) {
  const definition = structuredClone(rule);
  for (const key of [
    "version",
    "status",
    "validity",
    "provenance",
    "audit",
    "definition_hash",
  ]) {
    delete definition[key];
  }
  return definition;
}

function replayInput(fixture, manifest) {
  const results = fixture.expected.plan_results;
  const engineIds = new Set(
    results.filter((result) => result.result_origin === "engine").map((result) => result.plan_id),
  );
  const plans =
    fixture.scenario_id === "JP-CVS-002"
      ? fixture.candidate_plans
      : fixture.candidate_plans.filter((plan) => engineIds.has(plan.plan_id));
  const context = {
    rules: manifest.replay_input_projection.base_context.rules,
    assets: fixture.asset_definitions,
    user_state: fixture.user_state,
    transaction_time: fixture.as_of,
    replay_knowledge_at: fixture.replay_knowledge_at,
    objective: fixture.objective,
  };
  if (fixture.scenario_id === "JP-CVS-006") {
    context.opening_asset_lots = fixture.user_state.asset_lots;
  }
  return { plans, context };
}

function replayOutput(fixture, manifest) {
  if (manifest.replay_output_projection.mode === "fixture_expected") {
    return {
      outcome_mode: fixture.expected.outcome_mode,
      definite_winner_plan_id: fixture.expected.definite_winner_plan_id,
      safe_plan_id: fixture.expected.safe_plan_id,
      runner_up_plan_id: fixture.expected.runner_up_plan_id,
      plan_results: fixture.expected.plan_results,
    };
  }
  return manifest.replay_output_projection.canonical_output;
}

function entityType(rawType, entityKey) {
  if (rawType === "payment_method") {
    return entityKey.includes("nanaco") ? "electronic_money" : "other";
  }
  return rawType;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const evidenceIndex = loadJson(indexPath);
const registry = loadJson(registryPath);
const registryById = new Map(registry.sources.map((source) => [source.id, source]));
const evidenceRecords = evidenceIndex.records.map((entry) => {
  const evidencePath = resolve(root, entry.evidence_path);
  const snapshotPath = resolve(root, entry.snapshot_path);
  const evidence = YAML.parse(readFileSync(evidencePath, "utf8"));
  const snapshotBytes = readFileSync(snapshotPath);
  const snapshot = JSON.parse(snapshotBytes.toString("utf8"));
  const byteHash = `sha256:${createHash("sha256").update(snapshotBytes).digest("hex")}`;
  assert(byteHash === evidence.content_hash, `${entry.evidence_id}: snapshot hash mismatch`);
  assert(evidence.evidence_id === entry.evidence_id, `${entry.evidence_id}: evidence ID mismatch`);
  assert(snapshot.source_snapshot_id === entry.source_snapshot_id, `${entry.evidence_id}: snapshot ID mismatch`);
  const source = registryById.get(evidence.source_id);
  assert(source, `${entry.evidence_id}: source missing from registry`);
  return { entry, evidence, snapshot, source };
});

const scenarios = scenarioIds.map((scenarioId) => {
  const directory = resolve(root, `fixtures/m3/real-data/${scenarioId.toLowerCase()}`);
  const fixture = loadJson(resolve(directory, "golden-scenario.v1.json"));
  const manifest = loadJson(resolve(directory, "golden-scenario.v1.manifest.json"));
  assert(fixture.scenario_id === scenarioId, `${scenarioId}: fixture identity mismatch`);
  assert(manifest.scenario_id === scenarioId, `${scenarioId}: manifest identity mismatch`);
  assert(canonicalHash(fixture) === manifest.canonical_fixture_hash, `${scenarioId}: fixture hash mismatch`);
  const input = replayInput(fixture, manifest);
  const output = replayOutput(fixture, manifest);
  assert(canonicalHash(input) === fixture.replay_provenance.input_hash, `${scenarioId}: input hash mismatch`);
  assert(canonicalHash(output) === fixture.replay_provenance.output_hash, `${scenarioId}: output hash mismatch`);
  return { fixture, manifest, input, output };
});

const sources = [...new Map(evidenceRecords.map(({ source }) => [source.id, source])).values()].sort(
  (left, right) => left.id.localeCompare(right.id),
);

const rules = new Map();
const entities = new Map();
const assets = new Map();

for (const { fixture, manifest } of scenarios) {
  const bindings = new Map(fixture.rule_version_bindings.map((binding) => [binding.rule_id, binding]));
  for (const rule of manifest.replay_input_projection.base_context.rules) {
    const binding = bindings.get(rule.rule_id);
    assert(binding, `${fixture.scenario_id}: missing binding for ${rule.rule_id}`);
    const definition = economicDefinition(rule);
    assert(canonicalHash(definition) === binding.definition_hash, `${rule.rule_id}: definition hash mismatch`);
    const existing = rules.get(rule.rule_id);
    const row = { rule, binding, definition };
    if (existing) {
      assert(canonicalize(existing.row) === canonicalize(row), `${rule.rule_id}: conflicting rule rows`);
      existing.scenarioIds.add(fixture.scenario_id);
    } else {
      rules.set(rule.rule_id, { row, scenarioIds: new Set([fixture.scenario_id]) });
    }
    entities.set(rule.subject.entity_id, {
      key: rule.subject.entity_id,
      type: entityType(rule.subject.entity_type, rule.subject.entity_id),
      displayName: rule.subject.entity_id,
    });
  }
  for (const asset of fixture.asset_definitions) {
    const existing = assets.get(asset.asset_id);
    if (existing) assert(canonicalize(existing) === canonicalize(asset), `${asset.asset_id}: conflicting asset`);
    assets.set(asset.asset_id, asset);
    if (asset.program_id && !entities.has(asset.program_id)) {
      entities.set(asset.program_id, {
        key: asset.program_id,
        type: asset.program_id.includes("nanaco") ? "stored_value_program" : "credit_card",
        displayName: asset.program_id,
      });
    }
  }
}

const lines = [];
lines.push("-- GENERATED FILE. Run `pnpm seed:m3:generate` to refresh.");
lines.push("-- Seeds reviewed golden fixtures privately; it does not publish reward rules or enable frontend routes.");
lines.push("\\set ON_ERROR_STOP on", "begin;", "set constraints all deferred;", "");

for (const source of sources) {
  lines.push(
    `insert into app_private.trusted_sources (` +
      `source_key, name, publisher, category, tier, publication_use, source_url, authority_scope, ` +
      `locale, geography, evidence_format, volatility, recommended_check_cadence, retrieval_method, ` +
      `requires_login, automation_status, terms_review_status, technical_feasibility, url_registered_on, ` +
      `content_verified_on, verification_status, notes, registry_payload) values (` +
      [
        sqlText(source.id),
        sqlText(source.name),
        sqlText(source.publisher),
        sqlText(source.category),
        sqlText(source.tier),
        sqlText(source.publication_use),
        sqlText(source.source_url),
        sqlJson(source.authority_scope),
        sqlText(source.locale),
        sqlText(source.geography),
        sqlText(source.evidence_format),
        sqlText(source.volatility),
        sqlText(source.recommended_check_cadence),
        sqlText(source.access.retrieval_method),
        source.access.requires_login ? "true" : "false",
        sqlText(source.access.automation_status),
        sqlText(source.access.terms_review_status),
        sqlText(source.access.technical_feasibility.current_classification),
        sqlText(source.verification.url_registered_on),
        sqlText(source.verification.content_verified_on),
        sqlText(source.verification.status),
        sqlText(source.verification.notes),
        sqlJson(source),
      ].join(", ") +
      ");",
  );
  lines.push(
    `insert into app_private.source_collection_policies (` +
      `source_id, version, decision, permitted_method, storage_policy, technical_preconditions, ` +
      `reviewed_by, reviewed_at, valid_from, notes) ` +
      `select id, 1, 'approved_manual', 'manual_capture', ` +
      `${sqlJson({ raw_page_body: "prohibited", normalized_structured_facts: "allowed" })}, ` +
      `${sqlJson({ automation: "disabled" })}, 'project-owner', ` +
      `${sqlText(source.access.technical_feasibility.last_observed_at)}, ` +
      `${sqlText(source.access.technical_feasibility.last_observed_at)}, ` +
      `${sqlText("Manual paraphrased structured facts only; no copied page body, screenshot, or excerpt.")} ` +
      `from app_private.trusted_sources where source_key = ${sqlText(source.id)};`,
  );
  lines.push("");
}

for (const { entry, evidence, snapshot } of evidenceRecords.sort((a, b) => a.evidence.evidence_id.localeCompare(b.evidence.evidence_id))) {
  lines.push(
    `insert into app_private.source_snapshots (` +
      `snapshot_key, source_id, collection_policy_id, fetched_at, requested_url, effective_url, ` +
      `http_status, content_type, raw_content_hash, normalized_content_hash, storage_uri, ` +
      `acquisition_method, parser_version, capture_complete, metadata, created_by) ` +
      `select ${sqlText(evidence.source_snapshot_id)}, ts.id, scp.id, ${sqlText(evidence.captured_at)}, ` +
      `${sqlText(evidence.source_url)}, ${sqlText(evidence.source_url)}, null, 'application/json', ` +
      `${sqlText(evidence.content_hash)}, ${sqlText(evidence.content_hash)}, ${sqlText(entry.snapshot_path)}, ` +
      `'manual_capture', 'normalized-manual-v0.1', true, ${sqlJson({ raw_page_body_stored: false, representation_policy: snapshot.representation_policy })}, ` +
      `'m3-real-data-seed' from app_private.trusted_sources ts join app_private.source_collection_policies scp ` +
      `on scp.source_id = ts.id and scp.superseded_at is null where ts.source_key = ${sqlText(evidence.source_id)};`,
  );
  const reviewModes = evidence.review.review_events.map((event) => event.mode);
  lines.push(
    `insert into app_private.evidence_records (` +
      `evidence_key, source_snapshot_id, locator, excerpt_text, normalized_claim, supports, ` +
      `economic_valid_from, economic_valid_to, status, extraction_method, extraction_model, ` +
      `extraction_confidence, review_mode, required_review_modes, completed_review_modes, ` +
      `reviewed_by, reviewed_at, notes) select ` +
      `${sqlText(evidence.evidence_id)}, id, ${sqlJson(evidence.locator)}, null, ${sqlJson(snapshot)}, ` +
      `${sqlJson(evidence.supports)}, ${sqlText(evidence.valid_time.valid_from)}, ${sqlText(evidence.valid_time.valid_to)}, ` +
      `'verified', ${sqlText(evidence.extraction.method)}, ${sqlText(evidence.extraction.model)}, ` +
      `${evidence.extraction.confidence}, ${sqlText(evidence.review.review_mode)}, ` +
      `${sqlTextArray(evidence.review.required_review_modes)}, ${sqlTextArray(reviewModes)}, ` +
      `${sqlText(evidence.review.reviewer_id)}, ${sqlText(evidence.review.reviewed_at)}, ${sqlText(evidence.review.notes)} ` +
      `from app_private.source_snapshots where snapshot_key = ${sqlText(evidence.source_snapshot_id)};`,
  );
  lines.push(
    `insert into app_private.review_items (` +
      `review_type, subject_type, subject_id, external_subject_key, priority, status, assigned_to, payload) ` +
      `select 'evidence', 'evidence_record', id, ${sqlText(evidence.evidence_id)}, 'high', 'approved', ` +
      `${sqlText(evidence.review.reviewer_id)}, ${sqlJson({ evidence_id: evidence.evidence_id })} ` +
      `from app_private.evidence_records where evidence_key = ${sqlText(evidence.evidence_id)};`,
  );
  for (const event of evidence.review.review_events) {
    lines.push(
      `insert into app_private.review_decisions (` +
        `review_item_id, review_mode, decision, rationale, decided_by, decided_at, evidence_refs) ` +
        `select id, ${sqlText(event.mode)}, ${sqlText(event.decision)}, ${sqlText(event.notes)}, ` +
        `${sqlText(event.reviewer_id)}, ${sqlText(event.completed_at)}, ` +
        `jsonb_build_array((select id from app_private.evidence_records where evidence_key = ${sqlText(evidence.evidence_id)})) ` +
        `from app_private.review_items where subject_type = 'evidence_record' and external_subject_key = ${sqlText(evidence.evidence_id)};`,
    );
  }
  lines.push("");
}

for (const entity of [...entities.values()].sort((a, b) => a.key.localeCompare(b.key))) {
  lines.push(
    `insert into app_private.entities (entity_key, entity_type, display_name, locale, metadata, status) values (` +
      `${sqlText(entity.key)}, ${sqlText(entity.type)}, ${sqlText(entity.displayName)}, 'ja-JP', ` +
      `${sqlJson({ seeded_for: "m3_real_data_goldens" })}, 'active');`,
  );
}
lines.push("");

for (const asset of [...assets.values()].sort((a, b) => a.asset_id.localeCompare(b.asset_id))) {
  lines.push(
    `insert into app_private.asset_definitions (` +
      `asset_key, asset_kind, program_entity_id, default_reward_class, display_name, scale, ` +
      `default_expiry_policy, default_usage_restrictions, metadata, status) select ` +
      `${sqlText(asset.asset_id)}, ${sqlText(asset.asset_kind)}, e.id, ${sqlText(asset.default_reward_class)}, ` +
      `${sqlText(asset.display_name)}, ${asset.scale}, ${sqlJson(asset.default_expiry)}, ` +
      `${sqlJson(asset.default_usage_restrictions)}, ${sqlJson({ notes: asset.notes, seeded_for: "m3_real_data_goldens" })}, ` +
      `${sqlText(asset.status)} from app_private.entities e where e.entity_key = ${sqlText(asset.program_id)};`,
  );
}
lines.push("");

for (const [ruleId, { row }] of [...rules.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  const { rule, binding, definition } = row;
  lines.push(
    `insert into app_private.reward_rules (` +
      `rule_key, rule_type, subject_entity_id, name, lifecycle_status, created_by) select ` +
      `${sqlText(ruleId)}, ${sqlText(rule.rule_type)}, e.id, ${sqlText(rule.name)}, 'under_review', ` +
      `'m3-real-data-seed' from app_private.entities e where e.entity_key = ${sqlText(rule.subject.entity_id)};`,
  );
  lines.push(
    `insert into app_private.reward_rule_versions (` +
      `rule_id, version, definition, definition_hash, valid_from, valid_to, recorded_at, superseded_at, ` +
      `review_status, review_mode, required_review_modes, completed_review_modes, reviewed_by, reviewed_at, ` +
      `change_reason, created_by) select rr.id, ${binding.version}, ${sqlJson(definition)}, ` +
      `${sqlText(binding.definition_hash)}, ${sqlText(binding.validity.valid_from)}, ${sqlText(binding.validity.valid_to)}, ` +
      `${sqlText(binding.validity.recorded_at)}, ${sqlText(binding.validity.superseded_at)}, ` +
      `'under_review', null, array['agent_challenged']::text[], '{}'::text[], null, null, ` +
      `${sqlText("Golden fixture candidate only; separate rule-publication review and request remain required.")}, ` +
      `'m3-real-data-seed' from app_private.reward_rules rr where rr.rule_key = ${sqlText(ruleId)};`,
  );
  for (const evidenceId of binding.evidence_ids) {
    lines.push(
      `insert into app_private.rule_evidence (rule_version_id, evidence_id, supported_paths) ` +
        `select rrv.id, er.id, ${sqlJson(["/economic_definition"])} from app_private.reward_rule_versions rrv ` +
        `join app_private.reward_rules rr on rr.id = rrv.rule_id cross join app_private.evidence_records er ` +
        `where rr.rule_key = ${sqlText(ruleId)} and rrv.version = ${binding.version} ` +
        `and er.evidence_key = ${sqlText(evidenceId)};`,
    );
  }
  lines.push("");
}

for (const { fixture, manifest, input, output } of scenarios) {
  const review = fixture.review;
  const completedModes = review.review_events.map((event) => event.mode);
  lines.push(
    `insert into app_private.scenario_fixtures (` +
      `scenario_key, version, title, level, status, as_of, replay_knowledge_at, fixture_payload, fixture_hash, ` +
      `calculated_by, calculated_at, review_mode, required_review_modes, completed_review_modes, reviewed_by, ` +
      `reviewed_at, cooling_off_completed_at, independent_calculation_artifact) values (` +
      `${sqlText(fixture.scenario_id)}, ${fixture.version}, ${sqlText(fixture.title)}, ${sqlText(fixture.level)}, ` +
      `'reviewed', ${sqlText(fixture.as_of)}, ${sqlText(fixture.replay_knowledge_at)}, ${sqlJson(fixture)}, ` +
      `${sqlText(manifest.canonical_fixture_hash)}, ${sqlText(review.calculated_by)}, ` +
      `${sqlText(fixture.replay_provenance.completed_at)}, ${sqlText(review.review_mode)}, ` +
      `${sqlTextArray(review.required_review_modes)}, ${sqlTextArray(completedModes)}, ${sqlText(review.verified_by)}, ` +
      `${sqlText(review.verified_at)}, ${sqlText(review.cooling_off_completed_at)}, ` +
      `${sqlText(review.independent_calculation_artifact)});`,
  );
  for (const evidenceId of fixture.evidence_ids) {
    lines.push(
      `insert into app_private.scenario_evidence (scenario_fixture_id, evidence_id) ` +
        `select sf.id, er.id from app_private.scenario_fixtures sf cross join app_private.evidence_records er ` +
        `where sf.scenario_key = ${sqlText(fixture.scenario_id)} and sf.version = ${fixture.version} ` +
        `and er.evidence_key = ${sqlText(evidenceId)};`,
    );
  }
  for (const binding of fixture.rule_version_bindings) {
    for (const role of binding.roles) {
      lines.push(
        `insert into app_private.scenario_rule_versions (scenario_fixture_id, rule_version_id, relation) ` +
          `select sf.id, rrv.id, ${sqlText(role)} from app_private.scenario_fixtures sf ` +
          `cross join app_private.reward_rules rr join app_private.reward_rule_versions rrv on rrv.rule_id = rr.id ` +
          `where sf.scenario_key = ${sqlText(fixture.scenario_id)} and sf.version = ${fixture.version} ` +
          `and rr.rule_key = ${sqlText(binding.rule_id)} and rrv.version = ${binding.version};`,
      );
    }
  }
  lines.push(
    `insert into app_private.review_items (` +
      `review_type, subject_type, subject_id, external_subject_key, priority, status, assigned_to, payload) ` +
      `select 'scenario', 'scenario_fixture', id, ${sqlText(`${fixture.scenario_id}:v${fixture.version}`)}, ` +
      `'high', 'approved', ${sqlText(review.verified_by)}, ${sqlJson({ fixture_hash: manifest.canonical_fixture_hash })} ` +
      `from app_private.scenario_fixtures where scenario_key = ${sqlText(fixture.scenario_id)} and version = ${fixture.version};`,
  );
  for (const event of review.review_events) {
    lines.push(
      `insert into app_private.review_decisions (` +
        `review_item_id, review_mode, decision, rationale, decided_by, decided_at, evidence_refs) ` +
        `select id, ${sqlText(event.mode)}, ${sqlText(event.decision)}, ${sqlText(event.notes)}, ` +
        `${sqlText(event.reviewer_id)}, ${sqlText(event.completed_at)}, ${sqlJson(fixture.evidence_ids)} ` +
        `from app_private.review_items where subject_type = 'scenario_fixture' ` +
        `and external_subject_key = ${sqlText(`${fixture.scenario_id}:v${fixture.version}`)};`,
    );
  }
  lines.push(
    `insert into app_private.canonical_replay_runs (` +
      `replay_key, replay_class, engine_version, contracts_version, request_hash, request_payload, ` +
      `result_payload, result_hash, transaction_time, replay_knowledge_time, valuation_profile_version, ` +
      `contains_user_data) values (` +
      `${sqlText(fixture.replay_provenance.replay_id)}, 'golden_fixture', ` +
      `${sqlText(fixture.replay_provenance.engine_version)}, ${sqlText(fixture.replay_provenance.contracts_version)}, ` +
      `${sqlText(fixture.replay_provenance.input_hash)}, ${sqlJson(input)}, ${sqlJson(output)}, ` +
      `${sqlText(fixture.replay_provenance.output_hash)}, ${sqlText(fixture.as_of)}, ` +
      `${sqlText(fixture.replay_knowledge_at)}, ${sqlText(fixture.replay_provenance.valuation_profile_version)}, false);`,
  );
  for (const binding of fixture.rule_version_bindings) {
    for (const role of binding.roles) {
      const disposition = role === "boundary_source" ? "considered" : role;
      lines.push(
        `insert into app_private.canonical_replay_rule_versions (` +
          `replay_run_id, rule_version_id, disposition, reason_codes) select cr.id, rrv.id, ` +
          `${sqlText(disposition)}, ${sqlJson([`golden_fixture:${fixture.scenario_id}:${role}`])} ` +
          `from app_private.canonical_replay_runs cr cross join app_private.reward_rules rr ` +
          `join app_private.reward_rule_versions rrv on rrv.rule_id = rr.id ` +
          `where cr.replay_key = ${sqlText(fixture.replay_provenance.replay_id)} ` +
          `and rr.rule_key = ${sqlText(binding.rule_id)} and rrv.version = ${binding.version};`,
      );
    }
  }
  lines.push(
    `update app_private.canonical_replay_runs set sealed_at = clock_timestamp() ` +
      `where replay_key = ${sqlText(fixture.replay_provenance.replay_id)};`,
  );
  lines.push(
    `insert into app_private.scenario_canonical_replays (scenario_fixture_id, replay_run_id) ` +
      `select sf.id, cr.id from app_private.scenario_fixtures sf cross join app_private.canonical_replay_runs cr ` +
      `where sf.scenario_key = ${sqlText(fixture.scenario_id)} and sf.version = ${fixture.version} ` +
      `and cr.replay_key = ${sqlText(fixture.replay_provenance.replay_id)};`,
  );
  lines.push(
    `update app_private.scenario_fixtures set status = 'golden' ` +
      `where scenario_key = ${sqlText(fixture.scenario_id)} and version = ${fixture.version};`,
  );
  lines.push("");
}

lines.push("set constraints all immediate;", "commit;");

const generated = `${lines.join("\n")}\n`;
const mode = process.argv[2];
if (mode === "--write") {
  writeFileSync(outputPath, generated);
  console.log(`Wrote ${relative(root, outputPath)}`);
} else if (mode === "--check") {
  let current;
  try {
    current = readFileSync(outputPath, "utf8");
  } catch {
    console.error(`${relative(root, outputPath)} is missing; run pnpm seed:m3:generate`);
    process.exit(1);
  }
  if (current !== generated) {
    console.error(`${relative(root, outputPath)} is stale; run pnpm seed:m3:generate`);
    process.exit(1);
  }
  console.log(`Verified ${relative(root, outputPath)}`);
} else {
  console.error("Usage: node scripts/generate_m3_db_seed.mjs --write|--check");
  process.exit(2);
}
