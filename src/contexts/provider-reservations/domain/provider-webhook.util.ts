import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Nuitee/LiteAPI webhooks, as documented in
 * https://docs.liteapi.travel/docs/using-liteapi-webhooks
 *
 * - Authentication Token: shared secret configured in the Nuitee dashboard,
 *   sent as the value of the `authorization` header on every delivery.
 * - Request signing (optional, enabled by Nuitee support):
 *   `X-Request-Timestamp` (unix seconds) and `X-Request-Signature` =
 *   lowercase hex SHA-512 (plain hash, NOT HMAC) of
 *   raw_body + shared_secret + timestamp, concatenated without separator.
 * - Envelope: `{ event_id, event_name, request, response, sandbox }` where
 *   `request` and `response` are JSON-encoded STRINGS (may be "null").
 *
 * Payload statuses and amounts are never trusted: the handler always
 * re-reads the booking at the provider before acting.
 */
export const NUITEE_AUTH_HEADER = "authorization";
export const NUITEE_TIMESTAMP_HEADER = "x-request-timestamp";
export const NUITEE_SIGNATURE_HEADER = "x-request-signature";

/** Future skew tolerated on X-Request-Timestamp (clock drift). */
export const NUITEE_MAX_FUTURE_SKEW_SECONDS = 300;

export const NUITEE_WEBHOOK_EVENT = {
  PREBOOK: "booking.prebook",
  PREBOOK_ERROR: "booking.prebook_error",
  BOOK: "booking.book",
  BOOK_ERROR: "booking.book_error",
  HOTEL_CONFIRMATION_NUMBER: "booking.book.hotelConfirmationNumber",
  CANCEL: "booking.cancel",
  CANCEL_ERROR: "booking.cancel_error",
  AMENDMENT: "booking.amendment",
  AMENDMENT_RELOCATION: "booking.amendment.relocation",
  REFUND: "booking.refund",
  COMPENSATION: "booking.compensation",
  REBOOK_RFN: "booking.rebook.rfn",
  REBOOK_NRFN: "booking.rebook.nrfn",
  CHECKIN_INSTRUCTION: "booking.checkinInstruction",
} as const;

export type NuiteeWebhookEventName =
  (typeof NUITEE_WEBHOOK_EVENT)[keyof typeof NUITEE_WEBHOOK_EVENT];

/** Events that only open an incident for V4P (no money movement). */
export const NUITEE_INCIDENT_EVENTS: readonly string[] = [
  NUITEE_WEBHOOK_EVENT.AMENDMENT,
  NUITEE_WEBHOOK_EVENT.AMENDMENT_RELOCATION,
  NUITEE_WEBHOOK_EVENT.REFUND,
  NUITEE_WEBHOOK_EVENT.COMPENSATION,
  NUITEE_WEBHOOK_EVENT.REBOOK_RFN,
  NUITEE_WEBHOOK_EVENT.REBOOK_NRFN,
];

export interface ParsedProviderWebhook {
  /** event_id, else sha256(raw body) so a re-delivery dedupes. */
  eventId: string;
  /** event_name exactly as sent ("unknown" when absent). */
  eventName: string;
  sandbox: boolean;
  /** Parsed `request` (JSON string decoded; null for "null"/absent). */
  request: unknown;
  /** Parsed `response` (JSON string decoded; null for "null"/absent). */
  response: unknown;
  bookingId: string | null;
  clientReference: string | null;
  prebookId: string | null;
  /**
   * booking.book_error: `response.response` is itself an error JSON string,
   * decoded here (raw string kept when it is not JSON).
   */
  errorDetail: unknown;
}

function sha256(value: Buffer | string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Constant-time string compare. Both sides are hashed first so the buffers
 * handed to timingSafeEqual always have the same length (no length leak).
 */
function constantTimeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

/**
 * `authorization` header vs the configured Authentication Token. Accepts the
 * raw token (what Nuitee sends) and the "Bearer <token>" form.
 */
export function verifyAuthToken(
  header: string | null | undefined,
  token: string,
): boolean {
  if (!header || token === "") {
    return false;
  }
  const value = header.trim();
  const bearer = /^bearer\s+(.+)$/i.exec(value);
  const candidate = bearer?.[1]?.trim() ?? value;
  // Evaluate both forms so a raw token that happens to start with "Bearer "
  // still matches.
  const raw = constantTimeEqual(value, token);
  const stripped = constantTimeEqual(candidate, token);
  return raw || stripped;
}

/** Lowercase hex SHA-512 over raw_body + secret + timestamp. */
export function computeNuiteeSignature(
  rawBody: Buffer,
  secret: string,
  timestamp: string,
): string {
  return createHash("sha512")
    .update(rawBody)
    .update(secret, "utf8")
    .update(timestamp, "utf8")
    .digest("hex");
}

export const NUITEE_SIGNATURE_FAILURE = {
  MISSING_HEADERS: "missing_headers",
  BAD_TIMESTAMP: "bad_timestamp",
  STALE_TIMESTAMP: "stale_timestamp",
  BAD_SIGNATURE: "bad_signature",
} as const;

export type NuiteeSignatureFailure =
  (typeof NUITEE_SIGNATURE_FAILURE)[keyof typeof NUITEE_SIGNATURE_FAILURE];

export interface NuiteeSignatureInput {
  rawBody: Buffer;
  secret: string;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  maxAgeSeconds: number;
  now: Date;
}

/** null = valid, otherwise the failure reason. */
export function checkNuiteeSignature(
  input: NuiteeSignatureInput,
): NuiteeSignatureFailure | null {
  const timestamp = input.timestamp?.trim() ?? "";
  const signature = input.signature?.trim().toLowerCase() ?? "";
  if (timestamp === "" || signature === "") {
    return NUITEE_SIGNATURE_FAILURE.MISSING_HEADERS;
  }
  // Digits only: the timestamp is the tail of the hashed string, so a
  // non-numeric value would open the door to SHA-512 length extension.
  if (!/^\d{1,12}$/.test(timestamp)) {
    return NUITEE_SIGNATURE_FAILURE.BAD_TIMESTAMP;
  }
  const ageSeconds = Math.floor(input.now.getTime() / 1000) - Number(timestamp);
  if (
    ageSeconds > input.maxAgeSeconds ||
    ageSeconds < -NUITEE_MAX_FUTURE_SKEW_SECONDS
  ) {
    return NUITEE_SIGNATURE_FAILURE.STALE_TIMESTAMP;
  }
  if (!/^[0-9a-f]{128}$/.test(signature)) {
    return NUITEE_SIGNATURE_FAILURE.BAD_SIGNATURE;
  }
  const expected = Buffer.from(
    computeNuiteeSignature(input.rawBody, input.secret, timestamp),
    "hex",
  );
  return timingSafeEqual(Buffer.from(signature, "hex"), expected)
    ? null
    : NUITEE_SIGNATURE_FAILURE.BAD_SIGNATURE;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * `request` / `response` are JSON strings; tolerate an already decoded
 * object, "null" and non-JSON strings (kept as is).
 */
export function decodeEmbeddedJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value ?? null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function firstString(
  source: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

/** Looks at the object itself, then at a `data` wrapper (API shape). */
function pick(value: unknown, keys: readonly string[]): string | null {
  const record = asRecord(value);
  return firstString(record, keys) ?? firstString(asRecord(record?.data), keys);
}

const BOOKING_ID_KEYS = ["bookingId", "booking_id"] as const;
const CLIENT_REFERENCE_KEYS = ["clientReference", "client_reference"] as const;
const PREBOOK_ID_KEYS = ["prebookId", "prebook_id"] as const;

export function parseProviderWebhook(
  payload: unknown,
  rawBody: Buffer,
): ParsedProviderWebhook {
  const root = asRecord(payload);
  const request = decodeEmbeddedJson(root?.request);
  const response = decodeEmbeddedJson(root?.response);
  const eventName = firstString(root, ["event_name"]) ?? "unknown";
  const eventId =
    firstString(root, ["event_id"]) ??
    `sha256:${createHash("sha256").update(rawBody).digest("hex")}`;
  const innerError = asRecord(response)?.response;
  return {
    eventId: eventId.slice(0, 128),
    eventName: eventName.slice(0, 128),
    sandbox: root?.sandbox === true || root?.sandbox === "true",
    request,
    response,
    bookingId:
      pick(response, BOOKING_ID_KEYS) ?? pick(request, BOOKING_ID_KEYS),
    clientReference:
      pick(response, CLIENT_REFERENCE_KEYS) ??
      pick(request, CLIENT_REFERENCE_KEYS),
    prebookId:
      pick(response, PREBOOK_ID_KEYS) ?? pick(request, PREBOOK_ID_KEYS),
    errorDetail:
      innerError === undefined ? null : decodeEmbeddedJson(innerError),
  };
}

/** Short JSON for incidents / alerts (never the whole payload). */
export function webhookSummary(
  parsed: ParsedProviderWebhook,
  maxLength = 1500,
): string {
  let text: string;
  try {
    text = JSON.stringify({
      request: parsed.request,
      response: parsed.response,
    });
  } catch {
    text = "[unserializable payload]";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
