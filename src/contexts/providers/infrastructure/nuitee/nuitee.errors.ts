import {
  ProviderDuplicateReferenceError,
  ProviderError,
  ProviderInProgressError,
  ProviderNotConfiguredError,
  ProviderNotFoundError,
  ProviderOfferExpiredError,
  ProviderTransientError,
  ProviderUnavailableError,
} from "../../domain/provider.errors";
import { PROVIDER_NAME } from "../../domain/provider.types";
import {
  NuiteeHttpError,
  NuiteeNetworkError,
  NuiteeNotConfiguredError,
} from "./nuitee.client";
import { NuiteeMappingError } from "./nuitee.mapper";

const PROVIDER = PROVIDER_NAME.NUITEE;

/** LiteAPI error codes (body.error.code) we branch on. */
export const NUITEE_ERROR_CODE = {
  /** No availability found. */
  NO_AVAILABILITY: "2001",
  /** Rate/booking failed at the supplier (sold out, price changed). */
  BOOKING_FAILED: "2013",
  BOOKING_FAILED_SUPPLIER: "2014",
  /** clientReference already used. */
  DUPLICATE_CLIENT_REFERENCE: "4005",
} as const;

const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  NUITEE_ERROR_CODE.NO_AVAILABILITY,
  NUITEE_ERROR_CODE.BOOKING_FAILED,
  NUITEE_ERROR_CODE.BOOKING_FAILED_SUPPLIER,
]);

interface NuiteeErrorBody {
  code: string | null;
  message: string | null;
}

/** `{ error: { code, message, description } }` or `{ code, message }`. */
export function readNuiteeErrorBody(body: unknown): NuiteeErrorBody {
  const root =
    body !== null && typeof body === "object"
      ? (body as Record<string, unknown>)
      : null;
  const errorNode = root ? root.error : null;
  const nested =
    errorNode !== null &&
    typeof errorNode === "object" &&
    !Array.isArray(errorNode)
      ? (errorNode as Record<string, unknown>)
      : null;
  const node = nested ?? root;
  const code = node?.code;
  const message = node?.message ?? node?.description ?? root?.message;
  let text: string | null = null;
  if (typeof message === "string") {
    text = message;
  } else if (typeof body === "string" && body !== "") {
    text = body.slice(0, 500);
  }
  return {
    code:
      typeof code === "number" || (typeof code === "string" && code !== "")
        ? String(code)
        : null,
    message: text,
  };
}

/**
 * Any error thrown while talking to Nuitee -> typed ProviderError.
 * Already-typed ProviderErrors pass through unchanged.
 */
export function toProviderError(
  error: unknown,
  operation: string,
): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }
  if (error instanceof NuiteeNotConfiguredError) {
    return new ProviderNotConfiguredError(PROVIDER);
  }
  if (error instanceof NuiteeNetworkError) {
    return new ProviderTransientError({
      provider: PROVIDER,
      message: `${operation}: ${error.message}`,
      code: error.timedOut ? "TIMEOUT" : "NETWORK",
      timedOut: error.timedOut,
    });
  }
  if (error instanceof NuiteeMappingError) {
    return new ProviderError({
      provider: PROVIDER,
      message: `${operation}: ${error.message}`,
      code: "INVALID_RESPONSE",
    });
  }
  if (!(error instanceof NuiteeHttpError)) {
    return new ProviderError({
      provider: PROVIDER,
      message: `${operation}: ${error instanceof Error ? error.message : String(error)}`,
      code: "UNKNOWN",
    });
  }

  const { code, message } = readNuiteeErrorBody(error.body);
  const status = error.status;
  const params = {
    provider: PROVIDER,
    message: `${operation}: ${message ?? `HTTP ${status}`}`,
    code: code ?? String(status),
    httpStatus: status,
    details: error.body,
  };
  const text = (message ?? "").toLowerCase();

  if (code === NUITEE_ERROR_CODE.DUPLICATE_CLIENT_REFERENCE) {
    return new ProviderDuplicateReferenceError(params);
  }
  if (status === 409) {
    return text.includes("progress")
      ? new ProviderInProgressError(params)
      : new ProviderUnavailableError(params);
  }
  if (status === 408 || (text.includes("expired") && status < 500)) {
    return new ProviderOfferExpiredError(params);
  }
  if (status === 502 || status === 503 || status === 504) {
    return new ProviderTransientError(params);
  }
  if (code !== null && UNAVAILABLE_CODES.has(code)) {
    return new ProviderUnavailableError(params);
  }
  if (status === 404) {
    return new ProviderNotFoundError(params);
  }
  return new ProviderError(params);
}
