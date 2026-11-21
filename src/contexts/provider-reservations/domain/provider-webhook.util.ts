import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Nuitee/LiteAPI webhooks. ASSUMPTION (not documented by LiteAPI at the time
 * of writing, confirm in the sandbox): the signature is HMAC-SHA256 of the
 * raw request body with the shared secret, sent hex (optionally "sha256="
 * prefixed) or base64 in `x-liteapi-signature` or `x-signature`. Payload
 * amounts are never trusted: the handler always re-reads the booking with
 * getBooking before acting.
 */
export const NUITEE_SIGNATURE_HEADERS = [
  "x-liteapi-signature",
  "x-signature",
] as const;

export const PROVIDER_WEBHOOK_KIND = {
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
  FAILED: "failed",
  UPDATED: "updated",
  OTHER: "other",
} as const;

export type ProviderWebhookKind =
  (typeof PROVIDER_WEBHOOK_KIND)[keyof typeof PROVIDER_WEBHOOK_KIND];

export interface ParsedProviderWebhook {
  /** Provider id, else sha256(raw body) so a re-delivery dedupes. */
  eventId: string;
  eventType: string;
  kind: ProviderWebhookKind;
  bookingId: string | null;
  clientReference: string | null;
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyHmacSignature(
  rawBody: Buffer,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || secret === "") {
    return false;
  }
  const digest = createHmac("sha256", secret).update(rawBody).digest();
  const candidates = signatureHeader
    .split(",")
    .map(part => part.trim().replace(/^(sha256|v1)=/i, ""))
    .filter(part => part !== "");
  for (const candidate of candidates) {
    if (/^[0-9a-f]+$/i.test(candidate) && candidate.length === 64) {
      if (safeEqual(Buffer.from(candidate, "hex"), digest)) {
        return true;
      }
      continue;
    }
    const decoded = Buffer.from(candidate, "base64");
    if (safeEqual(decoded, digest)) {
      return true;
    }
  }
  return false;
}

/** Loose mapping by event name (truth comes from getBooking). */
export function webhookKind(eventType: string): ProviderWebhookKind {
  const name = eventType.toLowerCase();
  if (name.includes("cancel")) {
    return PROVIDER_WEBHOOK_KIND.CANCELLED;
  }
  if (name.includes("fail") || name.includes("reject")) {
    return PROVIDER_WEBHOOK_KIND.FAILED;
  }
  if (name.includes("confirm") || name.includes("book")) {
    return name.includes("updat") || name.includes("modif")
      ? PROVIDER_WEBHOOK_KIND.UPDATED
      : PROVIDER_WEBHOOK_KIND.CONFIRMED;
  }
  if (name.includes("updat") || name.includes("modif")) {
    return PROVIDER_WEBHOOK_KIND.UPDATED;
  }
  return PROVIDER_WEBHOOK_KIND.OTHER;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

export function parseProviderWebhook(
  payload: unknown,
  rawBody: Buffer,
): ParsedProviderWebhook {
  const root = asRecord(payload);
  const data =
    asRecord(root?.data) ?? asRecord(root?.booking) ?? asRecord(root?.payload);
  const eventType =
    firstString(root, [
      "event",
      "type",
      "eventType",
      "event_type",
      "eventName",
    ]) ?? "unknown";
  const eventId =
    firstString(root, [
      "id",
      "eventId",
      "event_id",
      "webhookId",
      "webhook_id",
    ]) ?? `sha256:${createHash("sha256").update(rawBody).digest("hex")}`;
  const bookingId =
    firstString(data, ["bookingId", "booking_id"]) ??
    firstString(root, ["bookingId", "booking_id"]) ??
    (data ? firstString(data, ["id"]) : null);
  const clientReference =
    firstString(data, ["clientReference", "client_reference"]) ??
    firstString(root, ["clientReference", "client_reference"]);
  return {
    eventId: eventId.slice(0, 128),
    eventType: eventType.slice(0, 128),
    kind: webhookKind(eventType),
    bookingId,
    clientReference,
  };
}
