import { types as nodeTypes } from "node:util";

export interface ShapeIssue {
  readonly code: "hostile_input" | "invalid_shape" | "input_too_large";
  readonly path: string;
  readonly message: string;
}

const MAX_ARRAY = 10_000;
const MAX_KEYS = 10_000;
const MAX_STRING = 1_000_000;

function childPath(path: string, key: string | number): string {
  const encoded = String(key).replaceAll("~", "~0").replaceAll("/", "~1");
  return `${path}/${encoded}`;
}

function cloneValue(
  value: unknown,
  path: string,
  active: WeakSet<object>,
  issues: ShapeIssue[],
): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > MAX_STRING)
      issues.push({
        code: "input_too_large",
        path,
        message: "string is too long",
      });
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      issues.push({
        code: "invalid_shape",
        path,
        message: "number must be finite",
      });
    return value;
  }
  if (typeof value !== "object" || value === undefined) {
    issues.push({
      code: "invalid_shape",
      path,
      message: "value is not JSON data",
    });
    return undefined;
  }
  if (nodeTypes.isProxy(value)) {
    issues.push({
      code: "hostile_input",
      path,
      message: "Proxy values are not accepted",
    });
    return undefined;
  }
  if (active.has(value)) {
    issues.push({
      code: "hostile_input",
      path,
      message: "cyclic values are not accepted",
    });
    return undefined;
  }
  active.add(value);

  let prototype: object | null;
  let descriptors: Record<string, PropertyDescriptor>;
  let symbols: symbol[];
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
    symbols = Object.getOwnPropertySymbols(value);
  } catch {
    issues.push({
      code: "hostile_input",
      path,
      message: "object inspection failed",
    });
    active.delete(value);
    return undefined;
  }
  if (symbols.length > 0)
    issues.push({
      code: "hostile_input",
      path,
      message: "symbol properties are not accepted",
    });

  const array = Array.isArray(value);
  if (!array && prototype !== Object.prototype && prototype !== null) {
    issues.push({
      code: "hostile_input",
      path,
      message: "only plain records are accepted",
    });
    active.delete(value);
    return undefined;
  }

  const keys = Object.keys(descriptors);
  if (keys.length > MAX_KEYS)
    issues.push({
      code: "input_too_large",
      path,
      message: "record has too many keys",
    });
  const output: unknown[] | Record<string, unknown> = array
    ? []
    : (Object.create(null) as Record<string, unknown>);
  const lengthDescriptor = descriptors.length;
  const length =
    array && lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
  if (
    array &&
    (!Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY)
  )
    issues.push({
      code: "input_too_large",
      path,
      message: "array length is invalid",
    });

  const dataKeys = keys.filter((key) => !(array && key === "length"));
  for (const key of dataKeys) {
    const descriptor = descriptors[key];
    const nextPath = childPath(path, key);
    if (!descriptor) continue;
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      issues.push({
        code: "hostile_input",
        path: nextPath,
        message: "prototype keys are not accepted",
      });
      continue;
    }
    if (!descriptor.enumerable) {
      issues.push({
        code: "hostile_input",
        path: nextPath,
        message: "non-enumerable properties are not accepted",
      });
      continue;
    }
    if (!("value" in descriptor)) {
      issues.push({
        code: "hostile_input",
        path: nextPath,
        message: "accessor properties are not accepted",
      });
      continue;
    }
    const child = cloneValue(descriptor.value, nextPath, active, issues);
    if (array) {
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key) {
        issues.push({
          code: "invalid_shape",
          path: nextPath,
          message: "array has a non-index property",
        });
      } else {
        (output as unknown[])[index] = child;
      }
    } else {
      Object.defineProperty(output, key, {
        value: child,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  if (array && Number.isSafeInteger(length) && length <= MAX_ARRAY) {
    for (let index = 0; index < length; index += 1) {
      if (!(String(index) in descriptors)) {
        issues.push({
          code: "hostile_input",
          path: childPath(path, index),
          message: "sparse arrays are not accepted",
        });
      }
    }
  }
  active.delete(value);
  return output;
}

export function scanPlainData(value: unknown): {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly issues: readonly ShapeIssue[];
} {
  const issues: ShapeIssue[] = [];
  const cloned = cloneValue(value, "", new WeakSet(), issues);
  issues.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.message.localeCompare(right.message),
  );
  return issues.length === 0
    ? { ok: true, value: cloned, issues }
    : { ok: false, issues };
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
