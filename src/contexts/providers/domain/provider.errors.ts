/**
 * Typed provider errors. Infrastructure adapters translate every HTTP/network
 * failure into one of these so application services can decide without
 * knowing provider codes:
 * - Unavailable / OfferExpired / Duplicate: definitive, do not retry the call.
 * - InProgress / Transient: outcome unknown -> reconcile (getBooking /
 *   listBookings by clientReference) before deciding.
 */
export class ProviderError extends Error {
  readonly provider: string;
  /** Provider error code (e.g. "4005") or HTTP status as text. */
  readonly code: string;
  readonly httpStatus: number | null;
  readonly retriable: boolean;
  readonly details: unknown;

  constructor(params: {
    provider: string;
    message: string;
    code?: string | null;
    httpStatus?: number | null;
    retriable?: boolean;
    details?: unknown;
  }) {
    super(params.message);
    this.name = "ProviderError";
    this.provider = params.provider;
    this.code = params.code ?? "UNKNOWN";
    this.httpStatus = params.httpStatus ?? null;
    this.retriable = params.retriable ?? false;
    this.details = params.details;
  }
}

/** Sold out / rate no longer available (409, 2001, 2013, 2014...). */
export class ProviderUnavailableError extends ProviderError {
  constructor(params: ConstructorParameters<typeof ProviderError>[0]) {
    super({ ...params, retriable: false });
    this.name = "ProviderUnavailableError";
  }
}

/** clientReference already used (4005): look the booking up instead. */
export class ProviderDuplicateReferenceError extends ProviderError {
  constructor(params: ConstructorParameters<typeof ProviderError>[0]) {
    super({ ...params, retriable: false });
    this.name = "ProviderDuplicateReferenceError";
  }
}

/** 409 "booking in progress": outcome pending, poll getBooking. */
export class ProviderInProgressError extends ProviderError {
  constructor(params: ConstructorParameters<typeof ProviderError>[0]) {
    super({ ...params, retriable: true });
    this.name = "ProviderInProgressError";
  }
}

/**
 * 502/503/504, network failure or local timeout. `timedOut` = the request
 * may have reached the provider (a book could have been created).
 */
export class ProviderTransientError extends ProviderError {
  readonly timedOut: boolean;

  constructor(
    params: ConstructorParameters<typeof ProviderError>[0] & {
      timedOut?: boolean;
    },
  ) {
    super({ ...params, retriable: true });
    this.name = "ProviderTransientError";
    this.timedOut = params.timedOut ?? false;
  }
}

/** 408 / expired offer or prebook: search or prebook again. */
export class ProviderOfferExpiredError extends ProviderError {
  constructor(params: ConstructorParameters<typeof ProviderError>[0]) {
    super({ ...params, retriable: false });
    this.name = "ProviderOfferExpiredError";
  }
}

/** 404: hotel/booking not found (hotel delisted by the provider). */
export class ProviderNotFoundError extends ProviderError {
  constructor(params: ConstructorParameters<typeof ProviderError>[0]) {
    super({ ...params, retriable: false });
    this.name = "ProviderNotFoundError";
  }
}

/** Missing API key / provider not configured in this environment. */
export class ProviderNotConfiguredError extends ProviderError {
  constructor(provider: string) {
    super({
      provider,
      message: `Provider ${provider} is not configured (missing API key)`,
      code: "NOT_CONFIGURED",
      retriable: false,
    });
    this.name = "ProviderNotConfiguredError";
  }
}
