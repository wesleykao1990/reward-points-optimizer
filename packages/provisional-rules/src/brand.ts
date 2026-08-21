import { types as nodeTypes } from "node:util";

import type { ProvisionalRuleEnvelope } from "./types.js";

// Deliberately module-private: structural lookalikes and clones cannot forge
// this identity, and a Proxy around a genuine envelope is not trusted.
const envelopeBrands = new WeakSet<object>();

export function brandEnvelope<T extends ProvisionalRuleEnvelope>(
  envelope: T,
): T {
  envelopeBrands.add(envelope);
  return envelope;
}

export function hasEnvelopeBrand(
  value: unknown,
): value is ProvisionalRuleEnvelope {
  return (
    value !== null &&
    typeof value === "object" &&
    !nodeTypes.isProxy(value) &&
    envelopeBrands.has(value)
  );
}
