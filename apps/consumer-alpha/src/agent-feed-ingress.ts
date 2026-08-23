import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type {
  AtomicPersistenceInput,
  AtomicPersistencePort,
  HandlerResponse,
  HeadersLike,
  SignedEventRequest,
  SigningKeyResolver,
  SourceObservation,
} from "@jro/agent-feed-consumer";
import {
  type ConsumerHandler,
  createAgentFeedConsumerHandler,
  type PersistenceOutcome,
} from "@jro/agent-feed-consumer";
import {
  createPostgresAtomicPersistence,
  createPostgresP0RewardClaimBatchProcessor,
  createPostgresP0TerminalAtomicPersistence,
  type P0RewardClaimBatchBindingInput,
  type P0RewardClaimBatchResult,
  type QueryTarget,
} from "@jro/agent-feed-postgres";
import {
  admitP0ReceiptReconciliation,
  admitP0SourceRolePlan,
  buildP0OperationsManifest,
  type P0OperationsManifest,
  type P0ReceiptReconciliation,
} from "@jro/p0-source-operations";
import { freezeP0CoverageIndex } from "@jro/provisional-rules";

/** Exact internal endpoint; it is never linked from the browser shell. */
export const AGENT_FEED_INTERNAL_EVENT_PATH =
  "/internal/agent-feed/events" as const;

/** Keep the transport limit equal to Agent Feed's default maximum. */
export const AGENT_FEED_INTERNAL_MAX_BODY_BYTES = 1_048_576 as const;
export const P0_RECONCILIATION_MAP_VERSION =
  "p0-agent-feed-reconciliation-map.v1" as const;
export const DEFAULT_P0_SOURCE_ROLE_PLAN_FILE =
  "registry/planning/p0-source-role-plan.v0.1.json" as const;
export const DEFAULT_P0_COVERAGE_INDEX_FILE =
  "fixtures/m3/provisional/p0-coverage-index.v0.6.json" as const;

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

/**
 * The structured reward-claim compiler is deliberately an optional host port:
 * the ingress never derives a P0 family or source role from claim prose. The
 * host supplies both the compiler-backed callback and an exact binding map.
 */
export type P0RewardClaimProcessor = (
  value: unknown,
) => Promise<P0RewardClaimBatchResult>;

export type P0RewardClaimBindingResolver = (
  observation: SourceObservation,
) =>
  | P0RewardClaimBatchBindingInput
  | null
  | Promise<P0RewardClaimBatchBindingInput | null>;

function hasStructuredRewardClaims(observation: SourceObservation): boolean {
  const attributes = observation.raw_attributes;
  return (
    attributes !== null &&
    typeof attributes === "object" &&
    !Array.isArray(attributes) &&
    Object.hasOwn(attributes, "reward_claims")
  );
}

function routeStructuredRewardClaims(
  persistence: AtomicPersistencePort,
  processor: P0RewardClaimProcessor | undefined,
  bindingResolver: P0RewardClaimBindingResolver | undefined,
): AtomicPersistencePort {
  if (processor === undefined) return persistence;
  if (bindingResolver === undefined)
    throw new TypeError("reward_claim_binding_resolver_required");

  return Object.freeze({
    async persist(input: AtomicPersistenceInput) {
      const outcome = await persistence.persist(input);
      if (
        input.observation === null ||
        (outcome.status !== "mapped" && outcome.status !== "duplicate") ||
        !hasStructuredRewardClaims(input.observation)
      )
        return outcome;

      // Prefer the canonical document returned by the durable mapper. On a
      // transport/mock adapter that omits it, the already-persisted input is
      // still the exact observation that was admitted to the database.
      const observation =
        outcome.observation !== undefined && outcome.observation !== null
          ? outcome.observation
          : input.observation;
      const binding = await bindingResolver(observation);
      if (binding === null || binding === undefined)
        throw new TypeError("reward_claim_binding_unavailable");
      // One processor call per mapped observation lets its own bounded batch
      // admission reject malformed claims while preserving valid siblings.
      const rewardClaims = await processor({
        version: "p0-reward-claim-batch.v1",
        observations: [{ observation, binding }],
      });
      // Keep the receipt outcome as the transport ACK boundary while exposing
      // the bounded compiler result to server-only callers of this ingress.
      return { ...outcome, reward_claims: rewardClaims };
    },
  });
}

/**
 * Resolve a signed finding to one exact host-plan target. `target_id` is an
 * identity field, not prose: it must exist in the delivery stream's admitted
 * manifest and the compiler independently intersects its source IDs with the
 * frozen coverage index.
 */
export function createManifestRewardClaimBindingResolver(
  manifest: P0OperationsManifest,
  coverageIndex: unknown,
): P0RewardClaimBindingResolver {
  const coverage = freezeP0CoverageIndex(coverageIndex);
  return (observation) => {
    const targetId = observation.raw_attributes.target_id;
    if (typeof targetId !== "string") return null;
    const stream = manifest.streams.find(
      (item) => item.stream_id === observation.agent_feed.stream_id,
    );
    const target = stream?.targets.find((item) => item.target_id === targetId);
    if (!target) return null;
    return Object.freeze({
      family_id: target.family_id,
      source_role_id: target.source_role_id,
      p0_coverage_index: coverage,
    });
  };
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
  /** Frozen host coverage used by the default automatic reward compiler. */
  readonly reward_claim_coverage_index?: unknown;
  /** Compiler-backed callback; errors remain retryable and are never ACKed. */
  readonly reward_claim_processor?: P0RewardClaimProcessor;
  /** Host-owned family/source binding; never inferred from claim prose. */
  readonly reward_claim_binding_resolver?: P0RewardClaimBindingResolver;
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
  const coverageFile =
    nonEmpty(environment.JRO_P0_COVERAGE_INDEX_FILE) ??
    DEFAULT_P0_COVERAGE_INDEX_FILE;
  const rewardClaimCoverageIndex = freezeP0CoverageIndex(
    readJsonFile(
      configuredPath(coverageFile, cwd),
      reader,
      "jro_p0_coverage_index_file_invalid",
    ),
  );

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
    reward_claim_coverage_index: rewardClaimCoverageIndex,
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
  const rewardProcessor =
    options.reward_claim_processor ??
    (options.reward_claim_coverage_index === undefined
      ? undefined
      : createPostgresP0RewardClaimBatchProcessor(options.target));
  const rewardBindingResolver =
    options.reward_claim_binding_resolver ??
    (options.reward_claim_coverage_index === undefined
      ? undefined
      : createManifestRewardClaimBindingResolver(
          options.manifest,
          options.reward_claim_coverage_index,
        ));
  if (rewardProcessor === undefined || rewardBindingResolver === undefined)
    throw new TypeError("reward_claim_automatic_processing_required");
  const rewardPersistence = routeStructuredRewardClaims(
    persistence,
    rewardProcessor,
    rewardBindingResolver,
  );
  const consumer: ConsumerHandler = createAgentFeedConsumerHandler({
    key_resolver: resolver,
    persistence: rewardPersistence,
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
> & {
  readonly reward_claims?: P0RewardClaimBatchResult;
};
