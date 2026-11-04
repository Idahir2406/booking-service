import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * F2 security fix (F0 open risk): the public checkout must not trust a
 * `user_id` sent by the browser. The PHP page that renders the checkout
 * (web/components/reservation_book_wizard.php) signs the logged-in traveler
 * id taken from the PHP session; the API only accepts the id from a valid,
 * unexpired signature.
 *
 * Format: "v1.{user_id}.{exp_unix}.{hex hmac_sha256}"
 * HMAC key: INTERNAL_API_KEY (== web BOOKING_INTERNAL_KEY), message
 * "v4p-traveler:v1:{user_id}:{exp_unix}" (domain separated from any other use
 * of the key). Same algorithm in web/inc/booking_checkout_lib.php.
 */

export const TRAVELER_TOKEN_VERSION = "v1";
/** Validity the PHP side gives a token (documentation; PHP sets exp). */
export const TRAVELER_TOKEN_TTL_SECONDS = 12 * 60 * 60;
/** Tolerated clock skew between web and API servers. */
const CLOCK_SKEW_SECONDS = 300;

export const TRAVELER_TOKEN_STATUS = {
  VALID: "valid",
  MISSING: "missing",
  MALFORMED: "malformed",
  BAD_SIGNATURE: "bad_signature",
  EXPIRED: "expired",
} as const;

export type TravelerTokenStatus =
  (typeof TRAVELER_TOKEN_STATUS)[keyof typeof TRAVELER_TOKEN_STATUS];

export interface TravelerTokenResult {
  status: TravelerTokenStatus;
  /** Only set when status === valid. */
  userId: number | null;
}

function signature(userId: number, expUnix: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`v4p-traveler:${TRAVELER_TOKEN_VERSION}:${userId}:${expUnix}`)
    .digest("hex");
}

/** Used by tests (the real issuer is PHP). */
export function signTravelerToken(
  userId: number,
  expUnix: number,
  secret: string,
): string {
  return `${TRAVELER_TOKEN_VERSION}.${userId}.${expUnix}.${signature(userId, expUnix, secret)}`;
}

export function verifyTravelerToken(
  token: unknown,
  secret: string,
  nowMs: number = Date.now(),
): TravelerTokenResult {
  if (typeof token !== "string" || token.trim() === "") {
    return { status: TRAVELER_TOKEN_STATUS.MISSING, userId: null };
  }
  const parts = token.trim().split(".");
  const [version, rawUser, rawExp, mac] = parts;
  if (
    parts.length !== 4 ||
    version !== TRAVELER_TOKEN_VERSION ||
    !/^\d{1,10}$/.test(rawUser) ||
    !/^\d{1,12}$/.test(rawExp) ||
    !/^[0-9a-f]{64}$/.test(mac)
  ) {
    return { status: TRAVELER_TOKEN_STATUS.MALFORMED, userId: null };
  }
  const userId = Number(rawUser);
  const expUnix = Number(rawExp);
  const expected = Buffer.from(signature(userId, expUnix, secret), "hex");
  const provided = Buffer.from(mac, "hex");
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return { status: TRAVELER_TOKEN_STATUS.BAD_SIGNATURE, userId: null };
  }
  if (expUnix + CLOCK_SKEW_SECONDS < Math.floor(nowMs / 1000)) {
    return { status: TRAVELER_TOKEN_STATUS.EXPIRED, userId: null };
  }
  if (userId <= 0) {
    return { status: TRAVELER_TOKEN_STATUS.MALFORMED, userId: null };
  }
  return { status: TRAVELER_TOKEN_STATUS.VALID, userId };
}
