#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const snapshotPath = resolve(
  root,
  "fixtures/m3/provisional/p0-point-rules-a.implementation.v0.1.json",
);
const coveragePath = resolve(
  root,
  "fixtures/m3/provisional/p0-coverage-index.v0.3.json",
);
const outputPath = resolve(
  root,
  "db/seeds/005_p0_point_rules_a_implementation.sql",
);

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const coverage = JSON.parse(readFileSync(coveragePath, "utf8"));
if (
  snapshot.version !== "p0-point-rules-a.implementation.v0.1" ||
  snapshot.implementation_hash !==
    "sha256:b48fabaa27b64cf94a59527e259f869455bb028259db2492c8ab659e99652679" ||
  snapshot.research_artifact_hash !==
    "sha256:4dd1a6c5d7e63a92b65daccd8eb92b85973fd307f4bd407f1607979b8e6ef06f" ||
  snapshot.entries.length !== 87 ||
  snapshot.derived_rules.length !== 0 ||
  coverage.version !== "p0-coverage-index.v0.3"
) {
  throw new Error("implementation or coverage checkpoint drifted");
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonLiteral(value, tag) {
  const text = JSON.stringify(value);
  if (text.includes(`$${tag}$`)) throw new Error(`SQL dollar quote collision: ${tag}`);
  return `$${tag}$${text}$${tag}$::jsonb`;
}

const coverageRows = [];
for (const entry of coverage.entries) {
  for (const sourceId of entry.known_source_ids) {
    coverageRows.push(
      `    (${sqlText(coverage.version)}, ${sqlText(entry.family_id)}, ${sqlText(entry.source_role_id)}, ${sqlText(sourceId)})`,
    );
  }
}
coverageRows.sort();

const sql = `-- GENERATED FILE. Run \`node scripts/generate_p0_point_rules_a_implementation_seed.mjs\` to refresh.
-- This seed persists the exact current Research-A implementation snapshot as
-- 87 searchable catalogue facts and zero derived candidates. It never writes
-- canonical reward rules, evidence, publication rows, or approval state.
\\set ON_ERROR_STOP on

begin;

select set_config('app_private.p0_implementation_write_context', 'seed', true);
insert into app_private.p0_implementation_coverage_refs (
    coverage_index_version, family_id, source_role_id, source_id
) values
${coverageRows.join(",\n")};
select set_config('app_private.p0_implementation_write_context', '', true);

select * from app_private.persist_p0_implementation_snapshot(
    ${jsonLiteral(snapshot, "p0_implementation_snapshot")}
);

do $seed_check$
begin
    if (select count(*) from app_private.p0_implementation_snapshots) <> 1
       or (select count(*) from app_private.p0_implementation_facts) <> 87
       or (select count(*) from app_private.p0_implementation_fact_corrections) <> 0
       or (select count(*) from app_api.p0_active_implementation_facts) <> 87
    then
        raise exception 'P0 implementation seed row counts are incorrect';
    end if;
end
$seed_check$;

commit;
`;

writeFileSync(outputPath, sql, "utf8");
if (process.argv.includes("--check")) {
  const current = readFileSync(outputPath, "utf8");
  if (current !== sql) throw new Error(`${outputPath} is stale`);
}
