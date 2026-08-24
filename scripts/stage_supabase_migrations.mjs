#!/usr/bin/env node

import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTPUT = join(ROOT, "supabase", "migrations");
const mode = process.argv[2] ?? "--check";

const SCHEMA_DESTINATIONS = new Map([
  [
    "0022_non_p0_agent_feed_immediate_findings.sql",
    "20260824053938_non_p0_agent_feed_immediate_findings_v2.sql",
  ],
  [
    "0023_experimental_findings_ui_projection.sql",
    "20260824053940_experimental_findings_ui_projection_v2.sql",
  ],
  [
    "0024_p0_implementation_rule_facts.sql",
    "20260824053942_p0_implementation_rule_facts.sql",
  ],
  [
    "0025_agent_feed_typed_rule_materialization.sql",
    "20260824053944_agent_feed_typed_rule_materialization.sql",
  ],
  [
    "0026_merchant_location_public_rpc.sql",
    "20260824102433_schema_0026_merchant_location_public_rpc.sql",
  ],
]);

const REQUIRED_PRODUCTION_HISTORY = Object.freeze([
  "20260823144106_merchant_acceptance_geo_cache.sql",
  "20260823144429_tokyo_major_merchant_seed.sql",
  "20260823144445_merchant_acceptance_resolved_projection.sql",
  "20260823144716_merchant_acceptance_indexes.sql",
  "20260823153434_osm_runtime_ingest_and_nearby_views.sql",
  "20260823153548_osm_runtime_preseed_match.sql",
  "20260823161205_merchant_purchase_context.sql",
  "20260823162938_merchant_tender_reward_rates.sql",
  "20260823163136_biccamera_tokyo_purchase_rules.sql",
  "20260823164020_matsukiyo_tokyo_purchase_rules.sql",
  "20260823164217_merchant_purchase_context_branch_only.sql",
  "20260823164548_welcia_tokyo_purchase_rules.sql",
  "20260823164737_merchant_reward_component_stacking.sql",
  "20260823164805_matsukiyo_dcard_payment_bonus.sql",
  "20260823170658_merchant_reward_points_per_spend.sql",
  "20260823170745_starbucks_tokyo_purchase_rules.sql",
  "20260823170858_yodobashi_tokyo_purchase_rules.sql",
  "20260823171022_donquijote_tokyo_purchase_rules.sql",
  "20260823171234_aeon_tokyo_purchase_rules.sql",
  "20260823171347_itoyokado_tokyo_purchase_rules.sql",
  "20260823171506_sukiya_tokyo_purchase_rules.sql",
  "20260823171619_yoshinoya_tokyo_purchase_rules.sql",
  "20260823171810_gusto_tokyo_purchase_rules.sql",
  "20260823172224_kurasushi_tokyo_purchase_rules.sql",
  "20260823172259_mosburger_tokyo_purchase_rules.sql",
  "20260823172342_merchant_reward_channel.sql",
  "20260823172420_merchant_reward_eligibility_variants.sql",
  "20260823172454_matsuya_tokyo_purchase_rules.sql",
  "20260823172802_doutor_tokyo_purchase_rules.sql",
  "20260823175822_add_tokyo_merchant_and_ecosystem_coverage_catalogues_v2.sql",
  "20260823180200_auto_enrich_ecosystem_backlog_from_merchant_facts.sql",
  "20260823184754_add_merchant_location_change_signal_api.sql",
  "20260823205126_non_p0_agent_feed_immediate_findings.sql",
  "20260823205210_grant_non_p0_experimental_api_access.sql",
  "20260824014611_experimental_findings_ui_projection.sql",
  "20260824095013_merchant_postgis_nearby_rpc.sql",
  "20260824095045_fix_nearby_merchants_distance_order.sql",
  "20260824101009_merchant_location_geocoder_http_extension.sql",
  "20260824101402_complete_merchant_location_backend.sql",
  "20260824101949_merchant_location_exception_addresses.sql",
  "20260824102125_nearby_merchants_public_contract_v1.sql",
]);

if (mode !== "--check" && mode !== "--write") {
  console.error("usage: node scripts/stage_supabase_migrations.mjs [--check|--write]");
  process.exitCode = 2;
} else {
  await main(mode);
}

async function listed(directory, pattern) {
  const names = await fs.readdir(directory);
  return names.filter((name) => pattern.test(name)).sort();
}

function assertSequence(names, width, label) {
  for (const [index, name] of names.entries()) {
    const expected = String(index + 1).padStart(width, "0");
    if (!name.startsWith(`${expected}_`))
      throw new Error(`${label}_sequence_invalid:${name}:${expected}`);
  }
}

function migrationVersion(base, index) {
  return (base + BigInt(index + 1)).toString();
}

function postgresSql(source, sourceName) {
  const lines = source
    .split(/\r?\n/u)
    .filter((line) => !/^\\set\s+ON_ERROR_STOP\s+on\s*$/u.test(line));
  const unsupported = lines.find((line) => /^\\/u.test(line));
  if (unsupported !== undefined)
    throw new Error(`psql_meta_command_unsupported:${sourceName}`);
  const hostedSql = lines
    .join("\n")
    .replace(/\bpublic\.digest\(/gu, "extensions.digest(")
    .replace(/\n*$/u, "\n");
  return `-- Staged from ${sourceName}; edit the canonical source, not this file.\n${hostedSql}`;
}

async function main(requestedMode) {
  const schemaDirectory = join(ROOT, "db");
  const dataDirectory = join(ROOT, "db", "seeds");
  const schemaNames = await listed(schemaDirectory, /^\d{4}_.+\.sql$/u);
  const dataNames = await listed(dataDirectory, /^\d{3}_.+\.sql$/u);
  if (schemaNames.length === 0 || dataNames.length === 0)
    throw new Error("supabase_migration_sources_missing");
  assertSequence(schemaNames, 4, "schema");
  assertSequence(dataNames, 3, "data");

  const inputs = [
    ...schemaNames.map((name, index) => ({
      source: join(schemaDirectory, name),
      sourceName: `db/${name}`,
      destination:
        SCHEMA_DESTINATIONS.get(name) ??
        `${migrationVersion(20260817000000n, index)}_schema_${name}`,
    })),
    ...dataNames.map((name, index) => ({
      source: join(dataDirectory, name),
      sourceName: `db/seeds/${name}`,
      destination: `${migrationVersion(20260818000000n, index)}_released_data_${name}`,
    })),
  ];
  const destinations = new Set(inputs.map((item) => item.destination));
  if (destinations.size !== inputs.length)
    throw new Error("supabase_migration_version_collision");

  const staged = [];
  for (const input of inputs) {
    const source = await fs.readFile(input.source, "utf8");
    staged.push({
      ...input,
      contents: postgresSql(source, input.sourceName),
    });
  }

  if (requestedMode === "--write") {
    await fs.mkdir(OUTPUT, { recursive: true });
    await Promise.all(
      staged.map((item) =>
        fs.writeFile(join(OUTPUT, item.destination), item.contents, {
          encoding: "utf8",
          flag: "w",
        }),
      ),
    );
  } else {
    let outputNames;
    try {
      outputNames = await listed(OUTPUT, /\.sql$/u);
    } catch (error) {
      if (error?.code === "ENOENT")
        throw new Error("supabase_migrations_missing");
      throw error;
    }
    const expectedNames = [
      ...staged.map((item) => item.destination),
      ...REQUIRED_PRODUCTION_HISTORY,
    ].sort();
    if (JSON.stringify(outputNames) !== JSON.stringify(expectedNames))
      throw new Error("supabase_migration_set_mismatch");
    for (const item of staged) {
      const actual = await fs.readFile(join(OUTPUT, item.destination), "utf8");
      if (actual !== item.contents)
        throw new Error(`supabase_migration_stale:${item.destination}`);
    }
  }

  console.log(
    `${requestedMode === "--write" ? "Staged" : "Verified"} ${schemaNames.length} schema and ${dataNames.length} released-data migrations for Supabase.`,
  );
  if (requestedMode === "--write")
    console.log(`Output: ${basename(dirname(OUTPUT))}/${basename(OUTPUT)}`);
}
