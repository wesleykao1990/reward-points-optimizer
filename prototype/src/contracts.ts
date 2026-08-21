import { createHash } from "node:crypto";
import type {
  AssetLot,
  AssetMovement,
  ReviewEvent,
  ReviewMode,
} from "./model.ts";

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
    .join(",")}}`;
}

export function definitionHash(definition: unknown): string {
  return `sha256:${createHash("sha256").update(stable(definition)).digest("hex")}`;
}

function bucket(quantity: {
  assetId: string;
  rewardClass: string | null;
}): string {
  return `${quantity.assetId}::${quantity.rewardClass ?? "<none>"}`;
}

export function validateConservation(
  openingLots: AssetLot[],
  movements: AssetMovement[],
  endingLots: AssetLot[],
): void {
  const balance = new Map<string, bigint>();
  const add = (key: string, amount: bigint) =>
    balance.set(key, (balance.get(key) ?? 0n) + amount);
  for (const lot of openingLots) add(bucket(lot.quantity), lot.quantity.units);
  for (const movement of movements) {
    if ((movement.direction as string) === "adjust")
      throw new Error("adjust_not_supported");
    if (movement.role === "external_funding" || movement.role === "fee")
      continue;
    const sign =
      movement.direction === "create" || movement.direction === "return"
        ? 1n
        : -1n;
    add(bucket(movement.quantity), sign * movement.quantity.units);
  }
  for (const lot of endingLots) add(bucket(lot.quantity), -lot.quantity.units);
  const mismatch = [...balance.entries()].find(([, units]) => units !== 0n);
  if (mismatch)
    throw new Error(`conservation_failed:${mismatch[0]}:${mismatch[1]}`);
}

export function assertReviewPolicy(
  requiredModes: ReviewMode[],
  events: ReviewEvent[],
): void {
  if (requiredModes.length === 0) throw new Error("review_policy_empty");
  const completed = new Set(
    events
      .filter((event) => event.decision === "approved")
      .map((event) => event.mode),
  );
  const missing = requiredModes.filter((mode) => !completed.has(mode));
  if (missing.length)
    throw new Error(`required_review_missing:${missing.join(",")}`);
}
