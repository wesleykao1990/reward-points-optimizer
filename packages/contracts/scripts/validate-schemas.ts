import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileAllSchemas,
  findSchemaDirectory,
  SCHEMA_NAMES,
} from "../src/index.js";

const schemaDirectory = findSchemaDirectory();
const expected = new Set(SCHEMA_NAMES.map((name) => `${name}.schema.json`));
const actual = new Set(
  readdirSync(schemaDirectory).filter((file) => file.endsWith(".schema.json")),
);
const missing = [...expected].filter((file) => !actual.has(file));
const extra = [...actual].filter((file) => !expected.has(file));
if (missing.length > 0 || extra.length > 0) {
  throw new Error(
    `Schema set mismatch; missing=${missing.join(",")}; extra=${extra.join(",")}`,
  );
}

const validators = compileAllSchemas();
if (validators.size !== SCHEMA_NAMES.length)
  throw new Error("Not all Draft 2020-12 schemas compiled");

// Keep generated types as a checked-in, reproducible artifact. This invokes
// the package-local generator in check mode and does not modify the workspace.
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
execFileSync(
  process.execPath,
  [join(scriptDirectory, "generate-types.mjs"), "--check"],
  {
    cwd: join(scriptDirectory, ".."),
    stdio: "inherit",
  },
);

console.log(
  `Validated ${validators.size} Draft 2020-12 schemas with relative references.`,
);
