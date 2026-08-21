import { types as nodeTypes } from "node:util";

/**
 * Host-owned deep links for the synthetic consumer alpha.
 *
 * The browser never supplies a URL to this module.  It supplies a catalogue
 * identifier and this module selects a URL from the immutable, host-owned
 * catalogue below.  The catalogue intentionally uses a `.test` host: these
 * are fixtures, not claims that any external service or official app exists.
 */

export const DEEP_LINK_CATALOG_VERSION = "1" as const;

export type DeepLinkStatus = "enabled" | "disabled" | "unverified";
export type DeepLinkVerificationStatus = "synthetic_fixture";

export interface DeepLinkCatalogEntry {
  readonly link_id: string;
  readonly label: string;
  readonly href: string;
  readonly host: string;
  readonly path: string;
  readonly allowed_query_keys: readonly string[];
  readonly status: DeepLinkStatus;
  readonly verification_status: DeepLinkVerificationStatus;
  readonly synthetic: true;
}

export interface SafeDeepLink {
  readonly link_id: string;
  readonly label: string;
  readonly href: string;
  readonly host: string;
  readonly path: string;
  readonly status: "enabled";
  readonly verification_status: DeepLinkVerificationStatus;
  readonly synthetic: true;
}

export type DeepLinkDenialCode =
  | "invalid_selection"
  | "unknown_link_id"
  | "link_disabled"
  | "link_unverified"
  | "catalog_invalid";

export interface DeepLinkDenial {
  readonly ok: false;
  readonly denial: Readonly<{
    readonly code: DeepLinkDenialCode;
  }>;
}

export interface DeepLinkSuccess {
  readonly ok: true;
  readonly link: SafeDeepLink;
}

export type DeepLinkResolution = DeepLinkSuccess | DeepLinkDenial;

/** The only host accepted by the synthetic catalogue. */
export const DEEP_LINK_ALLOWED_HOSTS: readonly string[] = Object.freeze([
  "alpha.rewards-optimizer.test",
]);

const SYNTHETIC_CATALOG: readonly DeepLinkCatalogEntry[] = [
  {
    link_id: "synthetic_loyalty_app",
    label: "Synthetic loyalty app fixture",
    href: "https://alpha.rewards-optimizer.test/fixtures/loyalty-app",
    host: "alpha.rewards-optimizer.test",
    path: "/fixtures/loyalty-app",
    allowed_query_keys: [],
    status: "enabled",
    verification_status: "synthetic_fixture",
    synthetic: true,
  },
  {
    link_id: "synthetic_wallet_app",
    label: "Synthetic wallet app fixture",
    href: "https://alpha.rewards-optimizer.test/fixtures/wallet-app",
    host: "alpha.rewards-optimizer.test",
    path: "/fixtures/wallet-app",
    allowed_query_keys: [],
    status: "enabled",
    verification_status: "synthetic_fixture",
    synthetic: true,
  },
  {
    link_id: "synthetic_unverified_app",
    label: "Synthetic unverified app fixture",
    href: "https://alpha.rewards-optimizer.test/fixtures/unverified-app",
    host: "alpha.rewards-optimizer.test",
    path: "/fixtures/unverified-app",
    allowed_query_keys: [],
    status: "unverified",
    verification_status: "synthetic_fixture",
    synthetic: true,
  },
  {
    link_id: "synthetic_disabled_app",
    label: "Synthetic disabled app fixture",
    href: "https://alpha.rewards-optimizer.test/fixtures/disabled-app",
    host: "alpha.rewards-optimizer.test",
    path: "/fixtures/disabled-app",
    allowed_query_keys: [],
    status: "disabled",
    verification_status: "synthetic_fixture",
    synthetic: true,
  },
];

function deepFreeze<T>(value: T, active = new Set<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (active.has(value)) throw new Error("DEEP_LINK_CATALOG_CYCLE");
  active.add(value);
  if (Array.isArray(value)) {
    for (const child of value) deepFreeze(child, active);
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child, active);
    }
  }
  active.delete(value);
  return Object.freeze(value);
}

/** Immutable catalogue owned by the trusted host. */
export const SYNTHETIC_DEEP_LINK_CATALOG = deepFreeze([
  ...SYNTHETIC_CATALOG,
]) as readonly DeepLinkCatalogEntry[];

/** Compatibility name for callers that do not need to mention synthetic. */
export const DEEP_LINK_CATALOG = SYNTHETIC_DEEP_LINK_CATALOG;

const LINK_ID_PATTERN = /^[a-z][a-z0-9_:-]{0,63}$/u;
const QUERY_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/u;
const FORBIDDEN_QUERY_KEY_PATTERN =
  /(?:^|_)(?:auth|credential|key|next|redirect|return|target|token|url)(?:$|_)/u;

function isAscii(value: string): boolean {
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) > 0x7f) return false;
  }
  return true;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f) return true;
  }
  return false;
}

function isSafeCatalogIdentifier(value: unknown): value is string {
  return typeof value === "string" && LINK_ID_PATTERN.test(value);
}

function denial(code: DeepLinkDenialCode): DeepLinkDenial {
  return Object.freeze({
    ok: false as const,
    denial: Object.freeze({ code }),
  });
}

function validQuery(url: URL, allowedKeys: readonly string[]): boolean {
  const keys = [...url.searchParams.keys()];
  if (keys.length !== allowedKeys.length) return false;
  const allowed = new Set(allowedKeys);
  if (keys.some((key) => !allowed.has(key))) return false;
  if (
    keys.some(
      (key) =>
        !QUERY_KEY_PATTERN.test(key) || FORBIDDEN_QUERY_KEY_PATTERN.test(key),
    )
  ) {
    return false;
  }
  // A catalogue query is fixed data.  Even for a pre-approved key, reject
  // values that look like a redirect, credential, or user-bearing token.
  for (const [key, value] of url.searchParams.entries()) {
    if (
      FORBIDDEN_QUERY_KEY_PATTERN.test(key) ||
      /(?:bearer|token|secret|password|credential|session|redirect|https?:|javascript:|data:)/iu.test(
        value,
      )
    ) {
      return false;
    }
  }
  return true;
}

function validateCatalogEntry(entry: DeepLinkCatalogEntry): boolean {
  if (
    !isSafeCatalogIdentifier(entry.link_id) ||
    typeof entry.label !== "string" ||
    entry.label.length === 0 ||
    entry.label.length > 120 ||
    typeof entry.href !== "string" ||
    typeof entry.host !== "string" ||
    typeof entry.path !== "string" ||
    !Array.isArray(entry.allowed_query_keys) ||
    !entry.allowed_query_keys.every(
      (key) => typeof key === "string" && QUERY_KEY_PATTERN.test(key),
    ) ||
    !DEEP_LINK_ALLOWED_HOSTS.includes(entry.host) ||
    (entry.status !== "enabled" &&
      entry.status !== "disabled" &&
      entry.status !== "unverified") ||
    entry.verification_status !== "synthetic_fixture" ||
    entry.synthetic !== true
  ) {
    return false;
  }
  if (!isAscii(entry.href) || hasControlCharacter(entry.href)) {
    return false;
  }
  if (!entry.path.startsWith("/") || entry.path.includes("//")) return false;
  if (
    entry.allowed_query_keys.some((key) =>
      FORBIDDEN_QUERY_KEY_PATTERN.test(key),
    )
  ) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(entry.href);
  } catch {
    return false;
  }
  const authority = entry.href.match(/^https:\/\/([^/?#]*)(?:[/?#]|$)/u)?.[1];
  if (
    authority !== entry.host ||
    url.protocol !== "https:" ||
    url.hostname !== entry.host ||
    url.host !== entry.host ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.hash !== "" ||
    url.pathname !== entry.path ||
    !validQuery(url, entry.allowed_query_keys)
  ) {
    return false;
  }
  // The explicit host comparison above also rules out IP literals, Unicode
  // hostnames, punycode aliases, and lookalike hosts.
  return true;
}

const CATALOG_VALID = SYNTHETIC_DEEP_LINK_CATALOG.every(validateCatalogEntry);

function readSelection(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (input === null || typeof input !== "object") return null;
  if (nodeTypes.isProxy(input)) return null;
  let keys: readonly PropertyKey[];
  try {
    if (Object.getPrototypeOf(input) !== Object.prototype) return null;
    keys = Reflect.ownKeys(input);
  } catch {
    return null;
  }
  if (keys.length !== 1 || keys[0] !== "link_id") return null;
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(input, "link_id");
  } catch {
    return null;
  }
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
    return null;
  }
  return typeof descriptor.value === "string" ? descriptor.value : null;
}

function safeLink(entry: DeepLinkCatalogEntry): DeepLinkSuccess {
  return Object.freeze({
    ok: true as const,
    link: deepFreeze({
      link_id: entry.link_id,
      label: entry.label,
      href: entry.href,
      host: entry.host,
      path: entry.path,
      status: "enabled" as const,
      verification_status: entry.verification_status,
      synthetic: true as const,
    }),
  });
}

/**
 * Resolve a host-owned deep link by catalogue id.  A caller-provided href,
 * path, query, or host is never accepted by this function.
 */
export function resolveDeepLink(selection: unknown): DeepLinkResolution {
  if (!CATALOG_VALID) return denial("catalog_invalid");
  const linkId = readSelection(selection);
  if (linkId === null || !isSafeCatalogIdentifier(linkId)) {
    return denial("invalid_selection");
  }
  const entry = SYNTHETIC_DEEP_LINK_CATALOG.find(
    (candidate) => candidate.link_id === linkId,
  );
  if (!entry) return denial("unknown_link_id");
  if (entry.status === "disabled") return denial("link_disabled");
  if (entry.status === "unverified") return denial("link_unverified");
  return safeLink(entry);
}

export const selectDeepLink = resolveDeepLink;
export const resolveOfficialAppDeepLink = resolveDeepLink;

export function getDeepLinkCatalog(): readonly DeepLinkCatalogEntry[] {
  return SYNTHETIC_DEEP_LINK_CATALOG;
}
