import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/index.js";

describe("contract determinism properties", () => {
  it("canonical serialization is invariant to object key insertion order", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.integer()),
        (entries) => {
          const keys = Object.keys(entries);
          const forward: Record<string, number> = {};
          const reverse: Record<string, number> = {};
          for (const key of keys) forward[key] = entries[key]!;
          for (const key of [...keys].reverse()) reverse[key] = entries[key]!;
          expect(canonicalize(forward)).toBe(canonicalize(reverse));
        },
      ),
      { numRuns: 100 },
    );
  });
});
