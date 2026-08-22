import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type {
  AtomicPersistenceInput,
  AtomicPersistencePort,
  HandlerResponse,
  HeadersLike,
  SignedEventRequest,
  SigningKeyResolver,
} from "@jro/agent-feed-consumer";
import {
  type ConsumerHandler,
  createAgentFeedConsumerHandler,
  type PersistenceOutcome,
} from "@jro/agent-feed-consumer";
import {
  createPostgresAtomicPersistence,
  createPostgresP0TerminalAtomicPersistence,
  type QueryTarget,
} from "@jro/agent-feed-postgres";
import {
  admitP0ReceiptReconciliation,
  admitP0SourceRolePlan,
  buildP0OperationsManifest,
  type P0OperationsManifest,
  type P0ReceiptReconciliation,
} from "@jro/p0-source-operations";

/** Exact internal endpoint; it is never linked from the browser shell. */
export const AGENT_FEED_INTERNAL_EVENT_PATH =
  "/internal/agent-feed/events" as const;

/** Keep the transport limit equal to Agent Feed's default maximum. */
export const AGENT_FEED_INTERNAL_MAX_BODY_BYTES = 1_048_576 as const;
export const P0_RECONCILIATION_MAP_VERSION =
  "p0-agent-feed-reconciliation-map.v1" as const;
export const DEFAULT_P0_SOURCE_ROLE_PLAN_FILE =
  "registry/planning/p0-source-role-plan.v0.1.json" as const;

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * A host-owned map of terminal run IDs to exact P0 reconciliation templates.
 * The map is deliberately not discovered from Agent Feed and is validated
 * against the supplied manifest before the handler is returned.
 */
export type P0TerminalReconciliationMap = Readonly<
  Record<string, P0ReceiptReconciliation>
>;

export interface AgentFeedIngressRequest {
  readonly raw_body: string | Uint8Array;
  readonly headers: HeadersLike;
  readonly received_at?: Date | string | number;
}

export interface AgentFeedIngressPort {
  readonly handle: (
    request: AgentFeedIngressRequest,
  ) => Promise<HandlerResponse>;
}

export interface EnvironmentSigningKeyResolverOptions {
  /** Defaults to `JRO_AGENT_FEED_SIGNING_KEY_ID`. */
  readonly key_id?: string;
  /** Defaults to `JRO_AGENT_FEED_SIGNING_SECRET`. */
  readonly secret?: string | Uint8Array;
  /** Defaults to `JRO_AGENT_FEED_SIGNING_SECRET_FILE`. */
  readonly secret_file?: string;
  /** Tests and host launchers may provide an explicit environment object. */
  readonly environment?: Environment;
  /** Host-owned file reader; never exposed through the HTTP boundary. */
  readonly read_secret_file?: (path: string) => string;
}

export interface P0AgentFeedEnvironmentLoaderOptions {
  /** Defaults to `process.env`. */
  readonly environment?: Environment;
  /** Defaults to the process working directory. */
  readonly cwd?: string;
  /** Host-owned text reader, primarily useful for deterministic tests. */
  readonly read_file?: (path: string) => string;
}

type P0AgentFeedIngressEnvironmentConfig = Omit<
  P0AgentFeedIngressOptions,
  "target"
>;

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return value;
}

function usableSecret(
  value: string | Uint8Array | undefined,
): string | Uint8Array | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value.length === 0 ? undefined : value;
  return value.byteLength === 0 ? undefined : value;
}

function secretFromFile(
  path: string | undefined,
  reader: (path: string) => string,
): string | undefined {
  if (path === undefined || path.length === 0) return undefined;
  try {
    const value = reader(path).trim();
    return value.length === 0 ? undefined : value;
  } catch {
    return undefined;
  }
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function configuredPath(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function readJsonFile(
  path: string,
  reader: (path: string) => string,
  errorCode: string,
): unknown {
  let text: string;
  try {
    text = reader(path);
  } catch {
    throw new TypeError(errorCode);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TypeError(errorCode);
  }
}

function readCurrentP0Manifest(
  path: string,
  reader: (path: string) => string,
): P0OperationsManifest {
  const candidate = readJsonFile(path, reader, "jro_agent_feed_plan_invalid");
  const admission = admitP0SourceRolePlan(candidate);
  if (!admission.ok) throw new TypeError("jro_agent_feed_plan_invalid");
  return buildP0OperationsManifest(admission.plan);
}

function mapFromReconciliationFile(
  candidate: unknown,
  manifest: P0OperationsManifest,
): P0TerminalReconciliationMap {
  if (!plainRecord(candidate))
    throw new TypeError("jro_agent_feed_reconciliation_file_invalid");

  let mapCandidate: unknown = candidate;
  if (Object.hasOwn(candidate, "reconciliations")) {
    const expectedKeys = [
      "manifest_sha256",
      "plan_sha256",
      "reconciliations",
      "version",
    ];
    const sortedExpectedKeys = expectedKeys.sort();
    const actualKeys = Object.keys(candidate).sort();
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== sortedExpectedKeys[index]) ||
      candidate.version !== P0_RECONCILIATION_MAP_VERSION ||
      candidate.plan_sha256 !== manifest.plan_sha256 ||
      candidate.manifest_sha256 !== manifest.manifest_sha256
    )
      throw new TypeError("jro_agent_feed_reconciliation_file_invalid");
    mapCandidate = candidate.reconciliations;
  }
  if (!plainRecord(mapCandidate))
    throw new TypeError("jro_agent_feed_reconciliation_file_invalid");
  const map = Object.create(null) as Record<string, P0ReceiptReconciliation>;
  for (const [runId, reconciliation] of Object.entries(mapCandidate)) {
    if (runId.length === 0 || !plainRecord(reconciliation))
      throw new TypeError("jro_agent_feed_reconciliation_file_invalid");
    map[runId] = reconciliation as unknown as P0ReceiptReconciliation;
  }
  return Object.freeze(map);
}

/**
 * Resolve one signing key from process configuration without putting the
 * secret in a response, diagnostic, or public dependency object. The secret
 * file option is useful for local tunnel deployments; production hosts can
 * instead pass a resolver that reads their own secret manager.
 */
export function createEnvironmentSigningKeyResolver(
  options: EnvironmentSigningKeyResolverOptions = {},
): SigningKeyResolver {
  const environment = options.environment ?? process.env;
  const keyId =
    nonEmpty(options.key_id) ??
    nonEmpty(environment.JRO_AGENT_FEED_SIGNING_KEY_ID);
  const configuredSecret =
    usableSecret(options.secret) ??
    nonEmpty(environment.JRO_AGENT_FEED_SIGNING_SECRET);
  const secret =
    configuredSecret ??
    secretFromFile(
      options.secret_file ??
        nonEmpty(environment.JRO_AGENT_FEED_SIGNING_SECRET_FILE),
      options.read_secret_file ?? ((path) => readFileSync(path, "utf8")),
    );

  return Object.freeze({
    resolve(requestedKeyId: string) {
      if (
        keyId === undefined ||
        secret === undefined ||
        requestedKeyId !== keyId
      )
        return null;
      return {
        key_id: keyId,
        secret,
        active_from: 0,
      };
    },
  });
}

function mapEntries(
  manifest: P0OperationsManifest,
  mapping: P0TerminalReconciliationMap,
): ReadonlyMap<string, P0ReceiptReconciliation> {
  if (mapping === null || typeof mapping !== "object" || Array.isArray(mapping))
    throw new TypeError("agent_feed_reconciliation_map_invalid");
  const output = new Map<string, P0ReceiptReconciliation>();
  for (const [runId, value] of Object.entries(mapping)) {
    if (runId.length === 0 || output.has(runId))
      throw new TypeError("agent_feed_reconciliation_map_invalid");
    const admitted = admitP0ReceiptReconciliation(manifest, value);
    if (admitted.run_id !== runId)
      throw new TypeError("agent_feed_reconciliation_map_identity_mismatch");
    output.set(runId, admitted);
  }
  if (output.size === 0)
    throw new TypeError("agent_feed_reconciliation_map_empty");
  return output;
}

/** Validate and freeze a host-owned map before a database port is composed. */
export function admitP0TerminalReconciliationMap(
  manifest: P0OperationsManifest,
  mapping: P0TerminalReconciliationMap,
): P0TerminalReconciliationMap {
  const entries = mapEntries(manifest, mapping);
  const admitted = Object.create(null) as Record<
    string,
    P0ReceiptReconciliation
  >;
  for (const [runId, reconciliation] of entries)
    admitted[runId] = reconciliation;
  return Object.freeze(admitted);
}

function routePersistence(
  generic: AtomicPersistencePort,
  terminal: AtomicPersistencePort,
): AtomicPersistencePort {
  return Object.freeze({
    persist(input: AtomicPersistenceInput) {
      return input.run_lifecycle?.kind === "terminal"
        ? terminal.persist(input)
        : generic.persist(input);
    },
  });
}

export interface P0AgentFeedIngressOptions {
  readonly target: QueryTarget;
  readonly manifest: P0OperationsManifest;
  readonly reconciliation_by_run_id: P0TerminalReconciliationMap;
  readonly key_resolver?: SigningKeyResolver;
  readonly signing_key?: EnvironmentSigningKeyResolverOptions;
  readonly schema_validator?: import("@jro/agent-feed-consumer").AgentFeedSchemaValidator;
  readonly max_body_bytes?: number;
  readonly replay_window_seconds?: number;
  readonly now?: () => Date;
}

/**
 * Build the optional production ingress configuration from host files and
 * environment variables. No configuration returns `undefined` so the normal
 * demo/runtime remains unchanged. Once any ingress setting is present, all
 * required settings are mandatory and stale/invalid files throw before the
 * HTTP server starts.
 */
export function loadP0AgentFeedIngressFromEnvironment(
  options: P0AgentFeedEnvironmentLoaderOptions = {},
): P0AgentFeedIngressEnvironmentConfig | undefined {
  const environment = options.environment ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const reader = options.read_file ?? ((path) => readFileSync(path, "utf8"));
  const reconciliationFile = nonEmpty(
    environment.JRO_AGENT_FEED_RECONCILIATION_FILE,
  );
  const keyId = nonEmpty(environment.JRO_AGENT_FEED_SIGNING_KEY_ID);
  const secretFromEnvironment = nonEmpty(
    environment.JRO_AGENT_FEED_SIGNING_SECRET,
  );
  const secretFile = nonEmpty(environment.JRO_AGENT_FEED_SIGNING_SECRET_FILE);
  const hasSigningConfiguration =
    keyId !== undefined ||
    secretFromEnvironment !== undefined ||
    secretFile !== undefined;

  if (reconciliationFile === undefined && !hasSigningConfiguration)
    return undefined;
  if (
    reconciliationFile === undefined ||
    keyId === undefined ||
    (secretFromEnvironment === undefined && secretFile === undefined)
  )
    throw new TypeError("jro_agent_feed_runtime_config_incomplete");

  const planFile =
    nonEmpty(environment.JRO_P0_SOURCE_ROLE_PLAN_FILE) ??
    DEFAULT_P0_SOURCE_ROLE_PLAN_FILE;
  const manifest = readCurrentP0Manifest(configuredPath(planFile, cwd), reader);
  const map = mapFromReconciliationFile(
    readJsonFile(
      configuredPath(reconciliationFile, cwd),
      reader,
      "jro_agent_feed_reconciliation_file_invalid",
    ),
    manifest,
  );
  const admittedMap = admitP0TerminalReconciliationMap(manifest, map);

  let signingSecret = secretFromEnvironment;
  if (signingSecret === undefined) {
    signingSecret = secretFromFile(
      configuredPath(secretFile as string, cwd),
      reader,
    );
    if (signingSecret === undefined)
      throw new TypeError("jro_agent_feed_signing_secret_unavailable");
  }

  return Object.freeze({
    manifest,
    reconciliation_by_run_id: admittedMap,
    signing_key: {
      key_id: keyId,
      secret: signingSecret,
    },
  });
}

/**
 * Compose the generic Agent Feed consumer with Rewards' two database paths.
 * Findings and run-start events use the ordinary atomic consumer function;
 * terminal events additionally reconcile the host-owned P0 checkpoints in the
 * same transaction. No path queries Agent Feed or invents economic claims.
 */
export function createP0AgentFeedIngress(
  options: P0AgentFeedIngressOptions,
): AgentFeedIngressPort {
  const entries = mapEntries(
    options.manifest,
    options.reconciliation_by_run_id,
  );
  const resolver: SigningKeyResolver =
    options.key_resolver ??
    createEnvironmentSigningKeyResolver(options.signing_key);
  const terminal = createPostgresP0TerminalAtomicPersistence(
    options.target,
    options.manifest,
    (input: AtomicPersistenceInput) =>
      entries.get(input.receipt.run_id) ?? null,
  );
  const persistence = routePersistence(
    createPostgresAtomicPersistence(options.target),
    terminal,
  );
  const consumer: ConsumerHandler = createAgentFeedConsumerHandler({
    key_resolver: resolver,
    persistence,
    ...(options.max_body_bytes === undefined
      ? {}
      : { max_body_bytes: options.max_body_bytes }),
    ...(options.replay_window_seconds === undefined
      ? {}
      : { replay_window_seconds: options.replay_window_seconds }),
    ...(options.schema_validator === undefined
      ? {}
      : { schema_validator: options.schema_validator }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  return Object.freeze({
    async handle(request: AgentFeedIngressRequest): Promise<HandlerResponse> {
      return consumer.handle({
        raw_body: request.raw_body,
        headers: request.headers,
        received_at: request.received_at ?? new Date(),
      } satisfies SignedEventRequest);
    },
  });
}

/** Keep the response type explicit for server-only adapter composition. */
export type AgentFeedIngressOutcome = Pick<
  PersistenceOutcome,
  "status" | "receipt_id" | "duplicate_kind" | "reason_code"
>;
