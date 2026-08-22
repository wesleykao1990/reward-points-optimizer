import type { AtomicPersistenceInput } from "./types.js";

/*
 * This capability is deliberately process-local. The public consumer API can
 * expose the read-only guard, but only handler.ts imports the mint operation.
 * A structurally identical object supplied by an application cannot acquire
 * the capability, including after JSON cloning or object spreading.
 */
const verifiedInputs = new WeakSet<object>();

export function markVerifiedAtomicPersistenceInput(
  input: AtomicPersistenceInput,
): void {
  if (input === null || typeof input !== "object")
    throw new TypeError("verified_atomic_input_invalid");
  verifiedInputs.add(input);
}

export function isVerifiedAtomicPersistenceInput(
  input: unknown,
): input is AtomicPersistenceInput {
  return (
    input !== null && typeof input === "object" && verifiedInputs.has(input)
  );
}
