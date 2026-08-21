#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const provisionalRules = await import(
  resolve(root, "packages/provisional-rules/dist/index.js")
);
const { compileP0ResearchImplementation } = provisionalRules;

const jobs = [
  {
    research: "fixtures/m3/agent-feed/p0-point-rules-b.research.v0.1.json",
    implementation:
      "fixtures/m3/provisional/p0-point-rules-b.implementation.v0.4.json",
    seed: "db/seeds/006_p0_point_rules_b_implementation.sql",
  },
  {
    research:
      "fixtures/m3/agent-feed/p0-wallet-card-rules.research.v0.1.json",
    implementation:
      "fixtures/m3/provisional/p0-wallet-card-rules.implementation.v0.5.json",
    seed: "db/seeds/007_p0_wallet_card_rules_implementation.sql",
  },
  {
    research:
      "fixtures/m3/agent-feed/p0-merchant-transit-regulatory-rules.research.v0.1.json",
    implementation:
      "fixtures/m3/provisional/p0-merchant-transit-regulatory-rules.implementation.v0.6.json",
    seed: "db/seeds/008_p0_merchant_transit_regulatory_implementation.sql",
  },
];

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonLiteral(value, tag) {
  const text = JSON.stringify(value);
  if (text.includes(`$${tag}$`))
    throw new Error(`SQL dollar quote collision: ${tag}`);
  return `$${tag}$${text}$${tag}$::jsonb`;
}

function renderSeed(snapshot, coverage, job) {
  const coverageRows = [];
  for (const entry of coverage.entries) {
    for (const sourceId of entry.known_source_ids) {
      coverageRows.push(
        `    (${sqlText(coverage.version)}, ${sqlText(entry.family_id)}, ${sqlText(entry.source_role_id)}, ${sqlText(sourceId)})`,
      );
    }
  }
  coverageRows.sort();
  const basename = job.seed.split("/").pop();
  return `-- GENERATED FILE. Run \`node scripts/generate_p0_research_implementation_seeds.mjs\` to refresh.\n-- This seed persists the exact ${snapshot.research_artifact_id} implementation\n-- snapshot as ${snapshot.parent_claim_count} searchable catalogue facts and zero\n-- derived candidates. It never writes canonical reward rules, evidence, publication\n-- rows, or unrelated canonical rows.\n\\set ON_ERROR_STOP on\n\nbegin;\n\nselect set_config('app_private.p0_implementation_write_context', 'seed', true);\ninsert into app_private.p0_implementation_coverage_refs (\n    coverage_index_version, family_id, source_role_id, source_id\n) values\n${coverageRows.join(",\n")};\nselect set_config('app_private.p0_implementation_write_context', '', true);\n\nselect * from app_private.persist_p0_implementation_snapshot(\n    ${jsonLiteral(snapshot, "p0_implementation_snapshot")}\n);\n\ndo $seed_check$\nbegin\n    if (select count(*) from app_private.p0_implementation_snapshots where implementation_version = ${sqlText(snapshot.version)}) <> 1\n       or (select count(*) from app_private.p0_implementation_facts where implementation_version = ${sqlText(snapshot.version)}) <> ${snapshot.parent_claim_count}\n       or (select count(*) from app_private.p0_implementation_fact_corrections) <> 0\n    then\n        raise exception 'P0 implementation seed row counts are incorrect for ${basename}';\n    end if;\nend\n$seed_check$;\n\ncommit;\n`;
}

const rendered = [];
for (const job of jobs) {
  const research = JSON.parse(
    readFileSync(resolve(root, job.research), "utf8"),
  );
  const result = compileP0ResearchImplementation(research);
  if (!result.ok || !result.artifact || !result.coverage)
    throw new Error(
      `${job.research} did not compile: ${JSON.stringify(result.issues)}`,
    );
  const snapshot = JSON.parse(JSON.stringify(result.artifact));
  const coverage = JSON.parse(JSON.stringify(result.coverage));
  rendered.push({
    ...job,
    snapshotText: `${JSON.stringify(snapshot, null, 2)}\n`,
    coverageText: `${JSON.stringify(coverage, null, 2)}\n`,
    seedText: renderSeed(snapshot, coverage, job),
  });
}

for (const job of rendered) {
  const implementationPath = resolve(root, job.implementation);
  // Keep the conventional shared coverage names used by the DB and README.
  const coverageNames = {
    "p0-point-rules-b.implementation.v0.4.json":
      "p0-coverage-index.v0.4.json",
    "p0-wallet-card-rules.implementation.v0.5.json":
      "p0-coverage-index.v0.5.json",
    "p0-merchant-transit-regulatory-rules.implementation.v0.6.json":
      "p0-coverage-index.v0.6.json",
  };
  const coverageName = coverageNames[job.implementation.split("/").pop()];
  if (!coverageName) throw new Error(`coverage name missing for ${job.implementation}`);
  const finalCoveragePath = resolve(root, "fixtures/m3/provisional", coverageName);
  const currentImplementation = existsSync(implementationPath)
    ? readFileSync(implementationPath, "utf8")
    : null;
  const currentCoverage = existsSync(finalCoveragePath)
    ? readFileSync(finalCoveragePath, "utf8")
    : null;
  const seedPath = resolve(root, job.seed);
  const currentSeed = existsSync(seedPath) ? readFileSync(seedPath, "utf8") : null;
  if (process.argv.includes("--check")) {
    if (currentImplementation !== job.snapshotText)
      throw new Error(`${job.implementation} is stale`);
    if (currentCoverage !== job.coverageText)
      throw new Error(`${finalCoveragePath} is stale`);
    if (currentSeed !== job.seedText)
      throw new Error(`${job.seed} is stale`);
  } else {
    writeFileSync(implementationPath, job.snapshotText, "utf8");
    writeFileSync(finalCoveragePath, job.coverageText, "utf8");
    writeFileSync(resolve(root, job.seed), job.seedText, "utf8");
  }
}
