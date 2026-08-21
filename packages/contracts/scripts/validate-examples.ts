import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import {
  canonicalize,
  type GoldenScenario,
  type RewardRule,
  validateDocument,
} from "../src/index.js";

const repositoryRoot = resolve(process.cwd(), "../..");
const loadYaml = (file: string): unknown =>
  YAML.parse(readFileSync(resolve(repositoryRoot, file), "utf8"));
const checked: Record<string, unknown> = {};
const contracts: Record<string, Parameters<typeof validateDocument>[1]> = {
  "asset.example.yaml": "asset",
  "source.example.yaml": "trusted-source",
  "source-access-observation.example.yaml": "source-access-observation",
  "evidence.example.yaml": "evidence-record",
  "extraction-candidate.example.yaml": "extraction-candidate",
  "extraction-candidate.prompt-injection.expected.yaml": "extraction-candidate",
  "purchase-plan.example.yaml": "purchase-plan",
  "reward-rule.example.yaml": "reward-rule",
  "golden-scenario.example.yaml": "golden-scenario",
  "golden-scenario.valuation-flip.example.yaml": "golden-scenario",
  "source-observation.from-agent-feed.example.yaml": "source-observation",
  "source-observation.prompt-injection.expected.yaml": "source-observation",
};

for (const [filename, schema] of Object.entries(contracts)) {
  const value = loadYaml(`examples/${filename}`);
  checked[filename] = validateDocument(value, schema);
}
validateDocument(
  loadYaml("registry/source-onboarding-template.yaml"),
  "trusted-source",
);
validateDocument(
  loadYaml("registry/source-access-observation-template.yaml"),
  "source-access-observation",
);

const candidate = checked["extraction-candidate.example.yaml"] as {
  candidate_rules?: unknown[];
};
for (const [index, rule] of (candidate.candidate_rules ?? []).entries())
  validateDocument<RewardRule>(rule, "reward-rule", {
    pathPrefix: `/candidate_rules/${index}`,
  });

const hostileCandidate = checked[
  "extraction-candidate.prompt-injection.expected.yaml"
] as {
  candidate_rules?: unknown[];
  security_flags?: Array<{ flag_type?: string }>;
};
if ((hostileCandidate.candidate_rules ?? []).length > 0)
  throw new Error(
    "Prompt-injection extraction must contain no candidate rules",
  );
if (
  !(hostileCandidate.security_flags ?? []).some(
    (flag) => flag.flag_type === "embedded_instruction",
  )
)
  throw new Error(
    "Prompt-injection extraction lacks embedded_instruction flag",
  );

const hostileObservation = checked[
  "source-observation.prompt-injection.expected.yaml"
] as {
  status?: string;
  canonical_evidence_ids?: unknown[];
  security_flags?: string[];
};
if (hostileObservation.status !== "rejected")
  throw new Error("Hostile Agent Feed observation must be rejected");
if ((hostileObservation.canonical_evidence_ids ?? []).length > 0)
  throw new Error(
    "Hostile Agent Feed observation must not create canonical evidence",
  );
if (
  !(
    new Set(hostileObservation.security_flags ?? []).has(
      "embedded_instruction",
    ) &&
    new Set(hostileObservation.security_flags ?? []).has(
      "attempted_authority_escalation",
    )
  )
)
  throw new Error(
    "Hostile Agent Feed observation lacks required security flags",
  );

const golden = checked["golden-scenario.example.yaml"] as GoldenScenario;
const flipped = checked[
  "golden-scenario.valuation-flip.example.yaml"
] as GoldenScenario;
const nativeFields = (scenario: GoldenScenario): unknown =>
  Object.fromEntries(
    scenario.expected.plan_results.map((result) => [
      result.plan_id,
      {
        eligible: result.eligible,
        asset_movements: result.asset_movements,
        reward_components: result.reward_components,
        ending_asset_lots: result.ending_asset_lots,
        applied_rule_ids: result.applied_rule_ids,
        rejected_rule_ids: result.rejected_rule_ids,
        rejection_reasons: result.rejection_reasons,
      },
    ]),
  );
if (canonicalize(nativeFields(golden)) !== canonicalize(nativeFields(flipped)))
  throw new Error(
    "Valuation-flip fixtures do not preserve identical native plan results",
  );
if (
  golden.expected.definite_winner_plan_id ===
  flipped.expected.definite_winner_plan_id
)
  throw new Error("Valuation-flip fixtures do not reverse the winner");

console.log(
  `Validated ${Object.keys(contracts).length + 2} synthetic examples, including both valuation fixtures and hostile Agent Feed outputs.`,
);
