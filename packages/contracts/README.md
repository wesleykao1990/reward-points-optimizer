# `@jro/contracts`

The contracts package is the single structural and semantic validation boundary
for the Rewards Optimizer. It loads the twelve Draft 2020-12 schemas from the
repository `schemas/` directory, resolves their relative references, exposes
schema-inferred TypeScript document types, and applies the cross-field rules in
`docs/13_semantic_validation_contract.md`.

`validateDocument(value, schema)` throws `ContractValidationError` unless both
layers pass and returns the original value with its inferred TypeScript type on
success. `validateStructure` and `validateSemantics` return a stable result with
path-specific issues for callers that need to display errors. Paths use JSON
Pointer escaping (`~0`, `~1`); semantic codes are stable snake-case identifiers.

Schema lookup works from source (`tsx`), a compiled `dist/` tree, and an
installed package. Set `JRO_SCHEMA_DIR` only for an intentional alternate
schema bundle. No network access or live source data is used by this package.

```ts
import { validateDocument, canonicalize, type PurchasePlan } from "@jro/contracts";

const plan = validateDocument<PurchasePlan>(input, "purchase-plan");
const replayBytes = canonicalize(plan);
```

The package-local validation commands are deliberately offline:

```text
pnpm --filter @jro/contracts validate:schemas
pnpm --filter @jro/contracts validate:registry
pnpm --filter @jro/contracts validate:examples
pnpm --filter @jro/contracts test
```
