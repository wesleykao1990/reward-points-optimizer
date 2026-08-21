import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ErrorObject, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";

export const SCHEMA_NAMES = [
  "asset",
  "evidence-record",
  "extraction-candidate",
  "golden-scenario",
  "purchase-plan",
  "reward-rule",
  "source-access-observation",
  "source-observation",
  "trusted-source-registry",
  "trusted-source",
  "user-state",
] as const;

export type SchemaName = (typeof SCHEMA_NAMES)[number];
export type SchemaFileName = `${SchemaName}.schema.json`;
export type SchemaInput = SchemaName | SchemaFileName | string;
export type JsonSchema = Record<string, unknown> & { $id?: string };

const EXPECTED_FILES = new Set(
  SCHEMA_NAMES.map((name) => `${name}.schema.json`),
);
const moduleDirectory = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the repository schema directory without relying on the current
 * working directory. The first candidate is intentionally an explicit escape
 * hatch for packaged deployments; the remaining candidates cover `src`,
 * compiled `dist`, and a workspace invocation from the repository root.
 */
export function findSchemaDirectory(): string {
  const candidates = [
    process.env.JRO_SCHEMA_DIR,
    resolve(moduleDirectory, "../../../schemas"),
    resolve(moduleDirectory, "../../../../schemas"),
    resolve(process.cwd(), "schemas"),
    resolve(process.cwd(), "../../schemas"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const files = new Set(readdirSync(candidate));
    if ([...EXPECTED_FILES].every((file) => files.has(file))) return candidate;
  }

  throw new Error(
    `Unable to locate all contract schemas. Checked: ${candidates.join(", ")}. ` +
      "Set JRO_SCHEMA_DIR to a directory containing the eleven *.schema.json files.",
  );
}

export function schemaFileName(schema: SchemaName): SchemaFileName {
  return `${schema}.schema.json`;
}

export function normalizeSchemaName(schema: SchemaInput): SchemaName {
  const candidate = schema.endsWith(".schema.json")
    ? schema.slice(0, -".schema.json".length)
    : schema;
  if ((SCHEMA_NAMES as readonly string[]).includes(candidate))
    return candidate as SchemaName;
  throw new Error(`Unknown contract schema ${schema}`);
}

export function loadSchemas(
  schemaDirectory = findSchemaDirectory(),
): Map<SchemaName, JsonSchema> {
  const result = new Map<SchemaName, JsonSchema>();
  for (const name of SCHEMA_NAMES) {
    const file = join(schemaDirectory, schemaFileName(name));
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Schema ${file} must contain a JSON object`);
    }
    result.set(name, parsed as JsonSchema);
  }
  return result;
}

export type ContractAjv = InstanceType<typeof Ajv2020>;

let cached:
  | { directory: string; schemas: Map<SchemaName, JsonSchema>; ajv: Ajv2020 }
  | undefined;

export function getSchemaBundle(): {
  directory: string;
  schemas: Map<SchemaName, JsonSchema>;
  ajv: Ajv2020;
} {
  const directory = findSchemaDirectory();
  if (cached?.directory === directory) return cached;

  const schemas = loadSchemas(directory);
  const ajv = new Ajv2020({
    allErrors: true,
    // The schemas are portable Draft 2020-12 documents. Ajv's optional
    // strictRequired/strictTuples diagnostics reject valid conditional schemas
    // whose `then` branch intentionally adds a required property; compilation
    // remains strict about references and formats below.
    strict: false,
    validateSchema: true,
    allowUnionTypes: true,
    discriminator: false,
  });
  (formatsPlugin as unknown as (instance: Ajv2020) => Ajv2020)(ajv);

  // Add every schema before compiling any validator. Relative references such
  // as `asset.schema.json#/$defs/assetRef` then resolve against the `$id` of
  // the referencing schema exactly as they do in Draft 2020-12 tooling.
  for (const schema of schemas.values()) ajv.addSchema(schema);
  cached = { directory, schemas, ajv };
  return cached;
}

export function getSchema(schema: SchemaInput): JsonSchema {
  return getSchemaBundle().schemas.get(
    normalizeSchemaName(schema),
  ) as JsonSchema;
}

export function getValidator(schema: SchemaInput): ValidateFunction {
  const bundle = getSchemaBundle();
  const id = getSchema(schema).$id;
  if (typeof id !== "string")
    throw new Error(`Schema ${schema} is missing $id`);
  return bundle.ajv.getSchema(id) ?? bundle.ajv.compile(getSchema(schema));
}

export function compileAllSchemas(): Map<SchemaName, ValidateFunction> {
  const bundle = getSchemaBundle();
  const validators = new Map<SchemaName, ValidateFunction>();
  for (const name of SCHEMA_NAMES) validators.set(name, getValidator(name));
  // `validateSchema` runs while adding schemas; retain this explicit call for
  // consumers that use the package as a Draft 2020-12 compilation gate.
  for (const schema of bundle.schemas.values())
    bundle.ajv.validateSchema(schema);
  return validators;
}

export type AjvValidationError = ErrorObject;
