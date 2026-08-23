#!/usr/bin/env node

import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTPUT = join(ROOT, "supabase", "migrations");
const mode = process.argv[2] ?? "--check";

// These sources were first applied through the connected Supabase production
// project on 2026-08-23. Keep their recorded migration versions stable so
// staging the canonical sources does not generate duplicate migrations later.
const PINNED_DESTINATIONS = new Map([
  [
    "db/0022_merchant_acceptance_geo_cache.sql",
    "20260823144106_merchant_acceptance_geo_cache.sql",
  ],
  [
    "db/seeds/012_tokyo_major_merchant_seed.sql",
    "20260823144429_tokyo_major_merchant_seed.sql",
  ],
  [
    "db/0023_merchant_acceptance_resolved_projection.sql",
    "20260823144445_merchant_acceptance_resolved_projection.sql",
  ],
  [
    "db/0024_merchant_acceptance_indexes.sql",
    "20260823144716_merchant_acceptance_indexes.sql",
  ],
  [
    "db/0025_osm_runtime_ingest_and_nearby_views.sql",
    "20260823153434_osm_runtime_ingest_and_nearby_views.sql",
  ],
  [
    "db/0026_osm_runtime_preseed_match.sql",
    "20260823153548_osm_runtime_preseed_match.sql",
  ],
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

function destinationFor(sourceName, fallback) {
  return PINNED_DESTINATIONS.get(sourceName) ?? fallback;
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
    ...schemaNames.map((name, index) => {
      const sourceName = `db/${name}`;
      return {
        source: join(schemaDirectory, name),
        sourceName,
        destination: destinationFor(
          sourceName,
          `${migrationVersion(20260817000000n, index)}_schema_${name}`,
        ),
      };
    }),
    ...dataNames.map((name, index) => {
      const sourceName = `db/seeds/${name}`;
      return {
        source: join(dataDirectory, name),
        sourceName,
        destination: destinationFor(
          sourceName,
          `${migrationVersion(20260818000000n, index)}_released_data_${name}`,
        ),
      };
    }),
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
    const expectedNames = staged.map((item) => item.destination).sort();
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
