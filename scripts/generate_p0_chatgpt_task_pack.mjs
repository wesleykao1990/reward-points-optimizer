import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const planPath = path.join(
  root,
  "registry/planning/p0-source-role-plan.v0.1.json",
);
const outputPath = path.join(
  root,
  "registry/planning/p0-chatgpt-task-pack.v0.1.json",
);
const trustedSourcesPath = path.join(root, "registry/trusted-sources.v0.3.json");
const recoveryPath = path.join(
  root,
  "registry/planning/p0-direct-source-recovery.2026-08-21.v0.1.json",
);
const locatorOverridesPath = path.join(
  root,
  "registry/planning/p0-agent-feed-locator-overrides.2026-08-21.v0.1.json",
);

const PACKAGE_BY_CATEGORY = new Map([
  ["point_program", ["p0.1-core-point-ecosystems", "Core point ecosystems"]],
  ["payment_wallet", ["p0.2-core-wallets", "Core wallets and payment apps"]],
  ["credit_card_issuer", ["p0.3-core-card-issuers", "Core card issuers"]],
  ["merchant", ["p0.4-core-merchants", "Core merchants"]],
  ["e_money_transit", ["p0.5-transit-emoney", "Transit and e-money foundations"]],
  ["regulatory", ["p0.6-regulatory", "Regulatory sources"]],
]);

// These selectors intentionally bind only the eight P0.1 families. They are
// not a general inference rule for the wider registry and do not make a
// registered URL canonical evidence.
const P0_1_SOURCE_SELECTORS = new Map([
  ["point.d", [(id) => id.startsWith("jp.dpoint.")]],
  ["point.jre", [(id) => id.startsWith("jp.jrepoint.")]],
  ["point.nanaco", [(id) => id.startsWith("jp.nanaco.")]],
  ["point.paypay", [(id) => id.startsWith("jp.paypay.")]],
  ["point.ponta", [(id) => id.startsWith("jp.ponta.")]],
  [
    "point.rakuten",
    [
      (id) => id === "jp.rakuten.pointclub",
      (id) => id === "jp.ana.rakuten-transfer",
    ],
  ],
  [
    "point.v",
    [
      (id) => id.startsWith("jp.vpoint."),
      (id) => id === "jp.ana.vpoint-transfer",
    ],
  ],
  ["point.waon", [(id) => id.startsWith("jp.waonpoint.")]],
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

const [rawPlan, trustedSourceRegistry, directRecovery, locatorOverrides] =
  await Promise.all([
    fs.readFile(planPath, "utf8").then(JSON.parse),
    fs.readFile(trustedSourcesPath, "utf8").then(JSON.parse),
    fs.readFile(recoveryPath, "utf8").then(JSON.parse),
    fs.readFile(locatorOverridesPath, "utf8").then(JSON.parse),
  ]);

const registeredHintsByFamily = new Map();
for (const [familyId, selectors] of P0_1_SOURCE_SELECTORS) {
  const hints = trustedSourceRegistry.sources
    .filter(
      (source) =>
        source.publication_use !== "discovery_only" &&
        selectors.some((matches) => matches(source.id)),
    )
    .map((source) => ({
      source_id: source.id,
      source_url: source.source_url,
      authority_scope: [...source.authority_scope].sort(),
      registration_status: source.verification.status,
      hint_status: "registered_locator_not_canonical_evidence",
    }))
    .sort((a, b) => a.source_id.localeCompare(b.source_id));
  if (hints.length === 0)
    throw new Error(`no registered source hints for ${familyId}`);
  registeredHintsByFamily.set(familyId, hints);
}

const recoveredHintsByFamily = new Map();
for (const target of [...directRecovery.targets, ...locatorOverrides.targets]) {
  const hints = recoveredHintsByFamily.get(target.family_id) ?? [];
  hints.push({
    source_role_id: target.source_role_id,
    source_url: target.source_url,
    publisher: target.publisher,
    role_marker: target.role_marker,
    exact_registered_source_id: target.exact_registered_source_id ?? null,
    related_registered_source_ids: [
      ...(target.related_registered_source_ids ?? []),
    ].sort(),
    hint_status: "direct_locator_lead_only_not_canonical_evidence",
  });
  recoveredHintsByFamily.set(target.family_id, hints);
}
const tasks = new Map();
for (const family of rawPlan.families) {
  const workPackage = PACKAGE_BY_CATEGORY.get(family.category);
  if (!workPackage) throw new Error(`unmapped P0 category: ${family.category}`);
  const [taskId, displayName] = workPackage;
  const task = tasks.get(taskId) ?? {
    task_id: taskId,
    display_name: displayName,
    schedule_mode: "operator_selected",
    targets: [],
  };
  task.targets.push({
    family_id: family.family_id,
    provider_or_scope: family.provider_or_scope,
    stream_id: family.stream_id,
    recommended_cadence_seconds: family.recommended_cadence_seconds,
    required_source_roles: [...family.required_source_roles].sort(),
    registered_source_hints: registeredHintsByFamily.get(family.family_id) ?? [],
    recovered_role_locator_hints: (
      recoveredHintsByFamily.get(family.family_id) ?? []
    ).sort((a, b) => a.source_role_id.localeCompare(b.source_role_id)),
  });
  tasks.set(taskId, task);
}

const taskList = [...tasks.values()]
  .map((task) => ({
    ...task,
    allowed_stream_ids: [
      ...new Set(task.targets.map((target) => target.stream_id)),
    ].sort(),
    targets: task.targets.sort((a, b) =>
      a.family_id.localeCompare(b.family_id),
    ),
  }))
  .sort((a, b) => a.task_id.localeCompare(b.task_id));

const roleKeys = taskList.flatMap((task) =>
  task.targets.flatMap((target) =>
    target.required_source_roles.map(
      (role) => `${target.family_id}\u0000${role}`,
    ),
  ),
);
const familyIds = taskList.flatMap((task) =>
  task.targets.map((target) => target.family_id),
);
const streamIds = [
  ...new Set(
    taskList.flatMap((task) =>
      task.targets.map((target) => target.stream_id),
    ),
  ),
].sort();

if (
  taskList.length !== 6 ||
  familyIds.length !== 44 ||
  new Set(familyIds).size !== 44 ||
  roleKeys.length !== 301 ||
  new Set(roleKeys).size !== 301 ||
  streamIds.length !== 19
)
  throw new Error("P0 Scheduled Task pack does not exactly cover 6/44/301/19");

const projection = {
  version: "p0-chatgpt-agent-feed-task-pack.v0.1",
  source_plan_sha256:
    "sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003",
  generated_at: "2026-08-21T19:30:00+09:00",
  protocol_version: "0.1",
  producer_id: "chatgpt-scheduled-task",
  lifecycle_tools: ["begin_run", "submit_batch", "complete_run"],
  execution_policy: {
    work_unit:
      "Process exactly one family/stream per occurrence, with no more than its eight declared role targets. Close that run before selecting another work unit. A broad category task is a queue of bounded work units, not permission to open every stream at once.",
    resume:
      "Carry forward the last successful locator and terminal role outcome keyed by family_id/source_role_id. Recheck successful locators directly and spend discovery effort only on unresolved or stale keys. Never replace a prior success with a later timeout or search miss; preserve both attempts and report cumulative coverage separately from this-occurrence coverage.",
    source_selection:
      "Recheck the supplied registered_source_hints and recovered_role_locator_hints first. Use direct first-party official pages for the exact family-role; search only when the supplied hints do not cover it. Every hint remains a locator lead until evidence admission succeeds.",
    evidence_status: "untrusted_lead_only",
    publication_policy:
      "Never publish RewardRuleVersion records. Submit bounded findings and evidence for Rewards-side admission and correction handling.",
    completion_policy:
      "Complete every begun run. Use partial or failed when any declared target was not actually checked; never convert missing work into a zero-finding completion.",
    credentials_policy:
      "Never place credentials, account data, tokens, or dynamic payment data in prompts, findings, evidence, or diagnostics.",
    submission_contract:
      "Before submit_batch, validate the exact root keys protocol_version, run_id, batch_id, idempotency_key, sequence_number, submitted_at, findings, evidence, and metadata; then validate exact finding/evidence shapes with no extra keys, unique IDs, resolved evidence_refs, strict date-times, and null for unknown nullable fields. Use sequence_number starting at 1 per run and never submit an empty findings+evidence batch. Leave content_hash null unless it was actually computed. On rejection, preserve the exact safe error code and failed JSON path in the terminal diagnostic.",
    connector_capability_gate:
      "Before constructing an economic batch, inspect the callable submit_batch tool contract. It must expose all nine required root fields. If the connector exposes only findings/evidence or otherwise omits required roots, do not call it: record connector_schema_incompatible, close the run honestly, and retain the validated local candidate for replay after deployment repair.",
    economic_claim_work_unit:
      "Economic extraction is a separate phase after locator coverage. Submit at most five source-bound claims and their evidence in one batch for one stream. Every quantitative term must be explicitly present on the fetched first-party page; omit unknown values and never infer a relationship, rate, date, cap, eligibility rule, or exception.",
    coverage_contract:
      "Record a checked family-role when the official page was actually fetched and its role marker or equivalent first-party content was observed. Emit an exact per-role attempt ledger with locator, observed_at, outcome, and receipt linkage. Locator success is separate from economic-claim extraction and does not by itself create a RewardRuleVersion.",
  },
  totals: {
    scheduled_tasks: 6,
    source_families: 44,
    agent_feed_streams: 19,
    required_source_roles: 301,
  },
  all_stream_ids: streamIds,
  tasks: taskList,
};
const pack = { ...projection, pack_sha256: sha256(projection) };
const rendered = `${JSON.stringify(pack, null, 2)}\n`;

if (process.argv.includes("--write")) {
  await fs.writeFile(outputPath, rendered, "utf8");
  process.stdout.write(`Wrote ${path.relative(root, outputPath)}\n`);
} else {
  let current;
  try {
    current = await fs.readFile(outputPath, "utf8");
  } catch {
    current = null;
  }
  if (current !== rendered) {
    process.stderr.write("P0 ChatGPT Scheduled Task pack is stale or missing\n");
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Verified P0 task pack ${pack.pack_sha256} (6/44/19/301)\n`,
    );
  }
}
