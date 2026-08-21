import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import {
  canonicalize,
  type SourceAccessObservation,
  type TrustedSourceRegistry,
  validateDocument,
  validateRegistrySources,
} from "../src/index.js";

const repositoryRoot = resolve(process.cwd(), "../..");
const registryYaml = YAML.parse(
  readFileSync(
    resolve(repositoryRoot, "registry/trusted-sources.v0.3.yaml"),
    "utf8",
  ),
) as unknown;
const registryJson = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, "registry/trusted-sources.v0.3.json"),
    "utf8",
  ),
) as unknown;
if (canonicalize(registryYaml) !== canonicalize(registryJson))
  throw new Error(
    "YAML and JSON trusted-source registries are not semantically identical",
  );

const registry = validateDocument<TrustedSourceRegistry>(
  registryYaml,
  "trusted-source-registry",
);
const observationWrapper = YAML.parse(
  readFileSync(
    resolve(repositoryRoot, "registry/source-access-observations.v0.3.yaml"),
    "utf8",
  ),
) as unknown;
if (
  !observationWrapper ||
  typeof observationWrapper !== "object" ||
  Array.isArray(observationWrapper)
)
  throw new Error("source-access observations wrapper must be an object");
const observations = (observationWrapper as { observations?: unknown })
  .observations;
if (!Array.isArray(observations))
  throw new Error(
    "source-access observations wrapper must contain observations",
  );
const typedObservations: SourceAccessObservation[] = observations.map(
  (observation, index) =>
    validateDocument<SourceAccessObservation>(
      observation,
      "source-access-observation",
      { pathPrefix: `/observations/${index}` },
    ),
);
const semantic = validateRegistrySources(registry, typedObservations);
if (!semantic.valid)
  throw new Error(
    semantic.issues
      .map((issue) => `${issue.path} [${issue.code}] ${issue.message}`)
      .join("\n"),
  );

const sources = registry.sources;
if (sources.length !== 176)
  throw new Error(`Expected 176 source seeds, found ${sources.length}`);
if (new Set(sources.map((source) => source.id)).size !== sources.length)
  throw new Error("Duplicate source IDs");
if (new Set(sources.map((source) => source.source_url)).size !== sources.length)
  throw new Error("Duplicate source URLs");
for (const observation of typedObservations) {
  if (
    observation.result === "aggregate" &&
    Object.values(observation.summary_counts).reduce(
      (sum, count) => sum + count,
      0,
    ) !== observation.source_ids.length
  ) {
    throw new Error(
      `Aggregate observation ${observation.observation_id} count does not match source_ids`,
    );
  }
}

console.log(
  `Validated trusted-source registry (${sources.length} sources) and ${typedObservations.length} access observations.`,
);
