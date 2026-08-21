import { definitionHash } from "./contracts.ts";

export type RuleStatus = "draft" | "approved" | "rejected";

export interface RuleValidity {
  validFrom: string;
  validTo: string | null;
  recordedAt: string;
  supersededAt: string | null;
}

export interface RuleVersion {
  ruleId: string;
  version: number;
  status: RuleStatus;
  definition: unknown;
  definitionHash: string;
  validity: RuleValidity;
}

export interface PublishRuleCommand {
  idempotencyKey: string;
  ruleId: string;
  version: number;
  status: RuleStatus;
  definition: unknown;
  validity: RuleValidity;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid_timestamp:${value}`);
  return parsed;
}

function endInstant(value: string | null): number {
  return value === null ? Number.POSITIVE_INFINITY : instant(value);
}

function contains(start: string, end: string | null, at: string): boolean {
  const value = instant(at);
  return instant(start) <= value && value < endInstant(end);
}

function rangesOverlap(
  leftStart: string,
  leftEnd: string | null,
  rightStart: string,
  rightEnd: string | null,
): boolean {
  return (
    instant(leftStart) < endInstant(rightEnd) &&
    instant(rightStart) < endInstant(leftEnd)
  );
}

function bitemporalRectanglesOverlap(
  left: RuleValidity,
  right: RuleValidity,
): boolean {
  return (
    rangesOverlap(
      left.validFrom,
      left.validTo,
      right.validFrom,
      right.validTo,
    ) &&
    rangesOverlap(
      left.recordedAt,
      left.supersededAt,
      right.recordedAt,
      right.supersededAt,
    )
  );
}

export class RuleVersionStore {
  readonly #versions = new Map<string, RuleVersion[]>();
  readonly #publicationRequests = new Map<
    string,
    { commandCanonical: string; result: RuleVersion }
  >();

  publish(command: PublishRuleCommand): RuleVersion {
    if (!command.idempotencyKey)
      throw new Error("publication_idempotency_required");
    if (!Number.isInteger(command.version) || command.version < 1) {
      throw new Error("invalid_rule_version");
    }
    if (
      instant(command.validity.validFrom) >=
      endInstant(command.validity.validTo)
    ) {
      throw new Error("invalid_economic_interval");
    }
    if (
      instant(command.validity.recordedAt) >=
      endInstant(command.validity.supersededAt)
    ) {
      throw new Error("invalid_system_interval");
    }

    const commandCanonical = canonical(command);
    const previousRequest = this.#publicationRequests.get(
      command.idempotencyKey,
    );
    if (previousRequest) {
      if (previousRequest.commandCanonical !== commandCanonical) {
        throw new Error("publication_idempotency_mismatch");
      }
      return structuredClone(previousRequest.result);
    }

    const existing = this.#versions.get(command.ruleId) ?? [];
    if (existing.some((version) => version.version === command.version)) {
      throw new Error("rule_version_conflict");
    }

    const result: RuleVersion = {
      ruleId: command.ruleId,
      version: command.version,
      status: command.status,
      definition: structuredClone(command.definition),
      definitionHash: definitionHash(command.definition),
      validity: structuredClone(command.validity),
    };

    if (
      result.status === "approved" &&
      existing.some(
        (version) =>
          version.status === "approved" &&
          bitemporalRectanglesOverlap(version.validity, result.validity),
      )
    ) {
      throw new Error("approved_bitemporal_overlap");
    }

    this.#versions.set(command.ruleId, [...existing, result]);
    this.#publicationRequests.set(command.idempotencyKey, {
      commandCanonical,
      result,
    });
    return structuredClone(result);
  }

  list(ruleId: string): RuleVersion[] {
    return structuredClone(this.#versions.get(ruleId) ?? []).sort(
      (left, right) => left.version - right.version,
    );
  }

  selectApproved(
    ruleId: string,
    transactionTime: string,
    knowledgeTime: string,
  ): RuleVersion | null {
    const matches = (this.#versions.get(ruleId) ?? []).filter(
      (version) =>
        version.status === "approved" &&
        contains(
          version.validity.validFrom,
          version.validity.validTo,
          transactionTime,
        ) &&
        contains(
          version.validity.recordedAt,
          version.validity.supersededAt,
          knowledgeTime,
        ),
    );
    if (matches.length > 1) throw new Error("ambiguous_bitemporal_replay");
    return matches[0] ? structuredClone(matches[0]) : null;
  }
}
