import {
  type AgentFeedDeliveryEvent,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_REPLAY_WINDOW_SECONDS,
  type HeadersLike,
  type SignatureVerification,
  type SignedEventRequest,
  type SigningKeyMaterial,
  type SigningKeyResolver,
} from "./types.js";
import {
  constantTimeHexEquals,
  headerValue,
  hmacSha256,
  isRecord,
  parseJsonObject,
  unixSeconds,
  utf8,
} from "./util.js";

export interface SignatureVerificationOptions {
  now_seconds?: number;
  replay_window_seconds?: number;
  max_body_bytes?: number;
}

export interface VerifiedSignedRequest {
  raw_bytes: Uint8Array;
  parsed_body: Record<string, unknown>;
  verification: SignatureVerification;
  received_at_seconds: number;
}

function requiredHeader(headers: HeadersLike, name: string): string {
  const value = headerValue(headers, name);
  if (value === undefined || value.length === 0)
    throw new TypeError(`missing_${name.replaceAll("-", "_")}`);
  if (value.length > 4096 || /[\r\n]/u.test(value))
    throw new TypeError(`invalid_${name.replaceAll("-", "_")}`);
  return value;
}

function parseUnsignedInteger(value: string, field: string): number {
  if (!/^\d+$/u.test(value)) throw new TypeError(`invalid_${field}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new TypeError(`invalid_${field}`);
  return parsed;
}

function safeHeaderErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^(?:missing|invalid)_[a-z0-9_]+$/u.test(message)
    ? message
    : "delivery_headers_invalid";
}

function assertReplayWindow(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 86_400)
    throw new TypeError("invalid_replay_window_seconds");
}

function assertBodyLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 16 * 1024 * 1024)
    throw new TypeError("invalid_max_body_bytes");
}

function keyValidAt(key: SigningKeyMaterial, at: number): boolean {
  const activeFrom = key.active_from ?? key.activeFrom ?? 0;
  const expiresAt = key.expires_at ?? key.expiresAt ?? null;
  return (
    Number.isSafeInteger(activeFrom) &&
    activeFrom >= 0 &&
    activeFrom <= at &&
    (expiresAt === null || (Number.isSafeInteger(expiresAt) && at < expiresAt))
  );
}

interface DeliveryHeaderMatch {
  reason: string | null;
  deliveryId: string;
}

function eventHeaderMatches(
  body: Record<string, unknown>,
  headers: HeadersLike,
): DeliveryHeaderMatch {
  const eventId = requiredHeader(headers, "x-agent-feed-event-id");
  const deliveryId = requiredHeader(headers, "x-agent-feed-delivery-id");
  const protocolVersion = requiredHeader(
    headers,
    "x-agent-feed-protocol-version",
  );
  const attempt = parseUnsignedInteger(
    requiredHeader(headers, "x-agent-feed-attempt"),
    "event_attempt",
  );
  if (body.event_id !== eventId)
    return { reason: "event_id_header_mismatch", deliveryId };
  if (body.protocol_version !== protocolVersion)
    return { reason: "protocol_version_header_mismatch", deliveryId };
  if (body.attempt !== attempt)
    return { reason: "attempt_header_mismatch", deliveryId };
  return { reason: null, deliveryId };
}

function asBodyEvent(
  body: Record<string, unknown>,
): AgentFeedDeliveryEvent | null {
  if (
    body.protocol_version !== "0.1" ||
    typeof body.event_id !== "string" ||
    typeof body.event_type !== "string" ||
    typeof body.stream_id !== "string" ||
    typeof body.run_id !== "string" ||
    (typeof body.finding_id !== "string" && body.finding_id !== null) ||
    typeof body.occurred_at !== "string" ||
    !Number.isSafeInteger(body.attempt) ||
    !isRecord(body.payload)
  )
    return null;
  return body as unknown as AgentFeedDeliveryEvent;
}

/**
 * Verify the exact bytes received over the wire. The signed message is the
 * ASCII timestamp, a dot, and the untouched body bytes. JSON parsing happens
 * only after the HMAC has been checked.
 */
export async function verifySignedRequest(
  request: SignedEventRequest,
  resolver: SigningKeyResolver,
  options: SignatureVerificationOptions = {},
): Promise<VerifiedSignedRequest> {
  const rawBytes = utf8(request.raw_body);
  const maxBodyBytes = options.max_body_bytes ?? DEFAULT_MAX_BODY_BYTES;
  assertBodyLimit(maxBodyBytes);
  const receivedAtSeconds = unixSeconds(request.received_at);
  const nowSeconds = options.now_seconds ?? receivedAtSeconds;
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0)
    throw new TypeError("invalid_now_seconds");
  if (rawBytes.byteLength > maxBodyBytes) {
    return {
      raw_bytes: rawBytes,
      parsed_body: {},
      received_at_seconds: receivedAtSeconds,
      verification: { valid: false, reason: "body_too_large" },
    };
  }
  let timestampSeconds: number;
  let keyId: string;
  let signature: string;
  try {
    const timestampHeader = requiredHeader(
      request.headers,
      "x-agent-feed-timestamp",
    );
    timestampSeconds = parseUnsignedInteger(
      timestampHeader,
      "timestamp_seconds",
    );
    keyId = requiredHeader(request.headers, "x-agent-feed-key-id");
    signature = requiredHeader(request.headers, "x-agent-feed-signature");
  } catch (error) {
    return {
      raw_bytes: rawBytes,
      parsed_body: {},
      received_at_seconds: receivedAtSeconds,
      verification: { valid: false, reason: safeHeaderErrorCode(error) },
    };
  }
  const signatureTimestampDate = new Date(timestampSeconds * 1000);
  if (!Number.isFinite(signatureTimestampDate.getTime()))
    throw new TypeError("invalid_timestamp_seconds");
  const signatureTimestamp = signatureTimestampDate.toISOString();
  const replayWindow =
    options.replay_window_seconds ?? DEFAULT_REPLAY_WINDOW_SECONDS;
  assertReplayWindow(replayWindow);
  if (Math.abs(nowSeconds - timestampSeconds) > replayWindow) {
    return {
      raw_bytes: rawBytes,
      parsed_body: {},
      received_at_seconds: receivedAtSeconds,
      verification: {
        valid: false,
        reason: "timestamp_outside_replay_window",
        keyId,
        timestampSeconds,
      },
    };
  }

  let key: SigningKeyMaterial | null;
  try {
    key = await resolver.resolve(keyId, timestampSeconds);
  } catch {
    key = null;
  }
  const returnedKeyId = key?.key_id ?? key?.keyId;
  if (
    !key ||
    (returnedKeyId !== undefined && returnedKeyId !== keyId) ||
    !keyValidAt(key, timestampSeconds) ||
    !keyValidAt(key, nowSeconds)
  ) {
    return {
      raw_bytes: rawBytes,
      parsed_body: {},
      received_at_seconds: receivedAtSeconds,
      verification: {
        valid: false,
        reason: "unknown_or_inactive_key",
        keyId,
        timestampSeconds,
      },
    };
  }

  const signedMessage = new Uint8Array(
    Buffer.byteLength(`${timestampSeconds}.`, "ascii") + rawBytes.byteLength,
  );
  signedMessage.set(Buffer.from(`${timestampSeconds}.`, "ascii"), 0);
  signedMessage.set(
    rawBytes,
    Buffer.byteLength(`${timestampSeconds}.`, "ascii"),
  );
  const expected = hmacSha256(signedMessage, key.secret);
  if (!constantTimeHexEquals(expected, signature)) {
    return {
      raw_bytes: rawBytes,
      parsed_body: {},
      received_at_seconds: receivedAtSeconds,
      verification: {
        valid: false,
        reason: "signature_mismatch",
        keyId,
        timestampSeconds,
      },
    };
  }

  let parsedBody: Record<string, unknown>;
  try {
    parsedBody = parseJsonObject(rawBytes);
  } catch (error) {
    return {
      raw_bytes: rawBytes,
      parsed_body: {},
      received_at_seconds: receivedAtSeconds,
      verification: {
        valid: false,
        reason: error instanceof Error ? error.message : "invalid_event_json",
        keyId,
        timestampSeconds,
      },
    };
  }
  let headerMatch: DeliveryHeaderMatch;
  try {
    headerMatch = eventHeaderMatches(parsedBody, request.headers);
  } catch (error) {
    return {
      raw_bytes: rawBytes,
      parsed_body: parsedBody,
      received_at_seconds: receivedAtSeconds,
      verification: {
        valid: false,
        reason: safeHeaderErrorCode(error),
        keyId,
        signature_key_id: keyId,
        timestampSeconds,
        signatureTimestamp,
        signature_timestamp: signatureTimestamp,
      },
    };
  }
  if (headerMatch.reason !== null) {
    return {
      raw_bytes: rawBytes,
      parsed_body: parsedBody,
      received_at_seconds: receivedAtSeconds,
      verification: {
        valid: false,
        reason: headerMatch.reason,
        deliveryId: headerMatch.deliveryId,
        delivery_id: headerMatch.deliveryId,
        keyId,
        signature_key_id: keyId,
        timestampSeconds,
        signatureTimestamp,
        signature_timestamp: signatureTimestamp,
      },
    };
  }
  if (asBodyEvent(parsedBody) === null) {
    return {
      raw_bytes: rawBytes,
      parsed_body: parsedBody,
      received_at_seconds: receivedAtSeconds,
      verification: {
        valid: false,
        reason: "invalid_event_shape",
        deliveryId: headerMatch.deliveryId,
        delivery_id: headerMatch.deliveryId,
        keyId,
        signature_key_id: keyId,
        timestampSeconds,
        signatureTimestamp,
        signature_timestamp: signatureTimestamp,
      },
    };
  }
  return {
    raw_bytes: rawBytes,
    parsed_body: parsedBody,
    received_at_seconds: receivedAtSeconds,
    verification: {
      valid: true,
      eventId: String(parsedBody.event_id),
      event_id: String(parsedBody.event_id),
      deliveryId: headerMatch.deliveryId,
      delivery_id: headerMatch.deliveryId,
      keyId,
      signature_key_id: keyId,
      timestampSeconds,
      signatureTimestamp,
      signature_timestamp: signatureTimestamp,
      deliveryAttempt: Number(parsedBody.attempt),
      delivery_attempt: Number(parsedBody.attempt),
    },
  };
}

export async function verifySignature(
  rawBody: string | Uint8Array,
  headers: HeadersLike,
  resolver: SigningKeyResolver,
  receivedAt: Date | string | number,
  options: Omit<SignatureVerificationOptions, "now_seconds"> = {},
): Promise<boolean> {
  const result = await verifySignedRequest(
    { raw_body: rawBody, headers, received_at: receivedAt },
    resolver,
    options,
  );
  return result.verification.valid;
}

export function signRawBody(
  rawBody: string | Uint8Array,
  timestampSeconds: number,
  secret: string | Uint8Array,
): string {
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds < 0)
    throw new TypeError("invalid_timestamp_seconds");
  if (
    (typeof secret === "string" && secret.length === 0) ||
    (typeof secret !== "string" && secret.byteLength === 0)
  )
    throw new TypeError("signing_secret_required");
  const body = utf8(rawBody);
  const prefix = Buffer.from(`${timestampSeconds}.`, "ascii");
  const message = new Uint8Array(prefix.byteLength + body.byteLength);
  message.set(prefix, 0);
  message.set(body, prefix.byteLength);
  return Buffer.from(hmacSha256(message, secret)).toString("hex");
}
