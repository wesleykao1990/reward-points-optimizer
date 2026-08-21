import { types as nodeTypes } from "node:util";

import type { AdmissionIssue, AdmissionIssueCode } from "./types.js";

const MAX_COLLECTION_LENGTH = 10_000;
const MAX_STRING_LENGTH = 1_000_000;

interface ScanContext {
  readonly path: string;
  readonly active: WeakSet<object>;
  readonly issues: AdmissionIssue[];
}

export interface PublicValueScan {
  readonly valid: boolean;
  readonly value?: unknown;
  readonly issues: readonly AdmissionIssue[];
}

function pointer(path: string, key: string | number): string {
  const encoded = String(key).replaceAll("~", "~0").replaceAll("/", "~1");
  return `${path}/${encoded}`;
}

function issue(
  context: ScanContext,
  code: AdmissionIssueCode,
  message: string,
  path = context.path,
): void {
  context.issues.push({ code, message, path });
}

function sortedIssues(issues: readonly AdmissionIssue[]): AdmissionIssue[] {
  return [...issues].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );
}

function keyLooksSecret(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replaceAll("-", "_")
    .toLowerCase();
  return /(?:^|_)(?:pan|cvv|cvc|pin|password|passwd|secret|token|api_key|private_key|authorization|cookie|session|credential)(?:$|_)/u.test(
    normalized,
  );
}

function luhn(value: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const digit = Number(value[index]);
    let add = digit;
    if (doubleDigit) {
      add *= 2;
      if (add > 9) add -= 9;
    }
    sum += add;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function stringLooksSecret(value: string): boolean {
  if (value.length > MAX_STRING_LENGTH) return true;
  const compact = value.replaceAll(/[\s-]/gu, "");
  if (/^\d{13,19}$/u.test(compact) && luhn(compact)) return true;
  if (/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/iu.test(value))
    return true;
  if (
    /\b(?:sk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9._-]{8,}\b/iu.test(
      value,
    )
  )
    return true;
  if (/-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/u.test(value)) return true;
  if (/(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/iu.test(value))
    return true;
  return false;
}

function isSafeArrayDescriptor(
  key: string,
  descriptor: PropertyDescriptor,
): boolean {
  if (key === "length") {
    return (
      !descriptor.enumerable &&
      "value" in descriptor &&
      typeof descriptor.value === "number" &&
      Number.isSafeInteger(descriptor.value) &&
      descriptor.value >= 0
    );
  }
  return descriptor.enumerable === true && "value" in descriptor;
}

function scan(value: unknown, context: ScanContext): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (stringLooksSecret(value))
      issue(
        context,
        "secret_bearing_value",
        "secret-like or payment-card data is not accepted",
      );
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      issue(context, "unsupported_value", "number must be finite");
    return value;
  }
  if (
    value === undefined ||
    typeof value === "bigint" ||
    typeof value === "symbol" ||
    typeof value === "function"
  ) {
    issue(context, "unsupported_value", "value is not JSON-compatible");
    return undefined;
  }
  if (typeof value !== "object") {
    issue(context, "unsupported_value", "value is not JSON-compatible");
    return undefined;
  }

  if (nodeTypes.isProxy(value)) {
    issue(context, "hostile_proxy", "Proxy values are not accepted");
    return undefined;
  }
  if (context.active.has(value)) {
    issue(context, "cyclic_value", "cyclic values are not accepted");
    return undefined;
  }
  context.active.add(value);

  let prototype: object | null;
  let descriptors: Record<string, PropertyDescriptor>;
  let symbols: symbol[];
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
    symbols = Object.getOwnPropertySymbols(value);
  } catch {
    issue(context, "hostile_proxy", "object introspection failed safely");
    context.active.delete(value);
    return undefined;
  }
  if (symbols.length > 0) {
    issue(context, "symbol_property", "symbol properties are not accepted");
  }

  const isArray = Array.isArray(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    issue(context, "unsupported_value", "only plain records are accepted");
    context.active.delete(value);
    return undefined;
  }

  const keys = Object.keys(descriptors);
  if (isArray) {
    const lengthDescriptor = descriptors.length;
    const length =
      lengthDescriptor &&
      "value" in lengthDescriptor &&
      typeof lengthDescriptor.value === "number"
        ? lengthDescriptor.value
        : -1;
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_COLLECTION_LENGTH
    ) {
      issue(
        context,
        "input_too_large",
        "array length is outside the safe bound",
      );
    }
    if (length >= 0 && length <= MAX_COLLECTION_LENGTH) {
      for (let index = 0; index < length; index += 1) {
        if (descriptors[String(index)] === undefined)
          issue(
            { ...context, path: pointer(context.path, index) },
            "sparse_array",
            "sparse arrays are not accepted",
          );
      }
    }
  } else if (keys.length > MAX_COLLECTION_LENGTH) {
    issue(context, "input_too_large", "record has too many properties");
  }

  const output: unknown[] | Record<string, unknown> = isArray
    ? []
    : (Object.create(null) as Record<string, unknown>);
  for (const key of keys) {
    if (isArray && key === "length") continue;
    const descriptor = descriptors[key];
    if (descriptor === undefined) continue;
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      issue(
        { ...context, path: pointer(context.path, key) },
        "input_shape_invalid",
        "prototype mutation keys are not accepted",
      );
      continue;
    }
    if (
      !isSafeArrayDescriptor(key, descriptor) ||
      (!isArray && !descriptor.enumerable)
    ) {
      if (keyLooksSecret(key))
        issue(
          { ...context, path: pointer(context.path, key) },
          "secret_bearing_value",
          "secret-bearing fields are not accepted",
        );
      else if (!descriptor.enumerable)
        issue(
          { ...context, path: pointer(context.path, key) },
          "non_enumerable_property",
          "non-enumerable properties are not accepted",
        );
      else
        issue(
          { ...context, path: pointer(context.path, key) },
          "accessor_property",
          "accessor properties are not accepted",
        );
      continue;
    }
    if (keyLooksSecret(key)) {
      issue(
        { ...context, path: pointer(context.path, key) },
        "secret_bearing_value",
        "secret-bearing fields are not accepted",
      );
    }
    if (!("value" in descriptor)) {
      issue(
        { ...context, path: pointer(context.path, key) },
        "accessor_property",
        "accessor properties are not accepted",
      );
      continue;
    }
    const childContext: ScanContext = {
      path: pointer(context.path, key),
      active: context.active,
      issues: context.issues,
    };
    const child = scan(descriptor.value, childContext);
    if (isArray) (output as unknown[]).push(child);
    else (output as Record<string, unknown>)[key] = child;
  }

  context.active.delete(value);
  return output;
}

/**
 * Inspect and clone untrusted public values before any domain property is
 * dereferenced.  The clone is ordinary data, so later validation cannot call
 * a caller-owned getter or proxy trap.
 */
export function scanPublicValue(value: unknown): PublicValueScan {
  const context: ScanContext = { path: "", active: new WeakSet(), issues: [] };
  const cloned = scan(value, context);
  const issues = sortedIssues(context.issues);
  if (issues.length > 0) return { valid: false, issues };
  return { valid: true, value: cloned, issues: [] };
}

function freeze(value: unknown, active: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) return value;
  active.add(value);
  if (Array.isArray(value)) {
    for (const item of value) freeze(item, active);
  } else {
    for (const item of Object.values(value)) freeze(item, active);
  }
  active.delete(value);
  return Object.freeze(value);
}

export function deepFreeze<T>(value: T): T {
  return freeze(value, new WeakSet()) as T;
}

export function isDeeplyFrozen(value: unknown): boolean {
  const visited = new WeakSet<object>();
  const visit = (current: unknown): boolean => {
    if (current === null || typeof current !== "object") return true;
    if (visited.has(current)) return true;
    if (!Object.isFrozen(current)) return false;
    visited.add(current);
    if (Array.isArray(current)) return current.every((item) => visit(item));
    return Object.values(current).every((item) => visit(item));
  };
  return visit(value);
}
