import type { ProviderPaymentMethod } from "../../domain/provider.types";

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";

export const NUITEE_CONFIG = Symbol("NUITEE_CONFIG");

export interface NuiteeConfig {
  /** null/empty = not configured (calls throw ProviderNotConfiguredError). */
  apiKey: string | null;
  apiBaseUrl: string;
  bookBaseUrl: string;
  paymentMethod: ProviderPaymentMethod;
  guestNationality: string;
  currency: string;
  ratesTimeoutMs: number;
  requestTimeoutMs: number;
  /** Retries on HTTP 503 only (same payload). Default 2. */
  maxRetries503?: number;
  /** Base backoff (ms), doubled per attempt. Default 500. */
  retryBackoffMs?: number;
}

export const NUITEE_API = {
  DATA: "data",
  BOOK: "book",
} as const;

export type NuiteeApi = (typeof NUITEE_API)[keyof typeof NUITEE_API];

export type NuiteeHttpMethod = "GET" | "POST" | "PUT";

export type NuiteeQueryValue = string | number | boolean | null | undefined;

export interface NuiteeRequest {
  api: NuiteeApi;
  method: NuiteeHttpMethod;
  /** Path relative to the API base, starting with "/". */
  path: string;
  query?: Readonly<Record<string, NuiteeQueryValue>>;
  body?: unknown;
  /** Defaults to config.requestTimeoutMs. */
  timeoutMs?: number;
}

/** Non-2xx response; `body` is the parsed JSON (or raw text). */
export class NuiteeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly path: string,
  ) {
    super(`Nuitee HTTP ${status} on ${path}`);
    this.name = "NuiteeHttpError";
  }
}

/** Network failure or local timeout (AbortController). */
export class NuiteeNetworkError extends Error {
  constructor(
    message: string,
    readonly timedOut: boolean,
    readonly path: string,
  ) {
    super(message);
    this.name = "NuiteeNetworkError";
  }
}

/** API key missing. */
export class NuiteeNotConfiguredError extends Error {
  constructor() {
    super("NUITEE_API_KEY is not configured");
    this.name = "NuiteeNotConfiguredError";
  }
}

export type FetchLike = typeof fetch;
export const NUITEE_FETCH = Symbol("NUITEE_FETCH");

const DEFAULT_MAX_RETRIES_503 = 2;
const DEFAULT_RETRY_BACKOFF_MS = 500;

/**
 * Thin LiteAPI v3.0 HTTP client on the Node global fetch: X-API-Key auth,
 * JSON in/out, per-call AbortController timeout and retry ONLY on HTTP 503
 * with the exact same payload (LiteAPI documents 503 as "retry"). Timeouts
 * are never retried: a book may already exist (caller reconciles).
 */
@Injectable()
export class NuiteeClient {
  private readonly logger = new Logger(NuiteeClient.name);
  private readonly fetchImpl: FetchLike;

  constructor(
    @Inject(NUITEE_CONFIG) private readonly config: NuiteeConfig,
    @Optional() @Inject(NUITEE_FETCH) fetchImpl?: FetchLike,
  ) {
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  get settings(): Readonly<NuiteeConfig> {
    return this.config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.apiKey.trim() !== "");
  }

  async request<T = unknown>(request: NuiteeRequest): Promise<T> {
    if (!this.isConfigured()) {
      throw new NuiteeNotConfiguredError();
    }
    const url = this.buildUrl(request);
    const payload =
      request.body === undefined ? undefined : JSON.stringify(request.body);
    const maxRetries = this.config.maxRetries503 ?? DEFAULT_MAX_RETRIES_503;
    const backoff = this.config.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;

    for (let attempt = 0; ; attempt += 1) {
      try {
        return (await this.send(request, url, payload)) as T;
      } catch (error) {
        const retry =
          error instanceof NuiteeHttpError &&
          error.status === 503 &&
          attempt < maxRetries;
        if (!retry) {
          throw error;
        }
        const waitMs = backoff * 2 ** attempt;
        this.logger.warn(
          `Nuitee 503 on ${request.method} ${request.path}; retry ${attempt + 1}/${maxRetries} in ${waitMs} ms`,
        );
        await delay(waitMs);
      }
    }
  }

  private async send(
    request: NuiteeRequest,
    url: string,
    payload: string | undefined,
  ): Promise<unknown> {
    const timeoutMs = request.timeoutMs ?? this.config.requestTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(url, {
        method: request.method,
        headers: {
          "X-API-Key": this.config.apiKey ?? "",
          Accept: "application/json",
          ...(payload === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body: payload,
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      const timedOut = controller.signal.aborted;
      throw new NuiteeNetworkError(
        timedOut
          ? `Nuitee timeout after ${timeoutMs} ms on ${request.method} ${request.path}`
          : `Nuitee network error on ${request.method} ${request.path}: ${
              error instanceof Error ? error.message : String(error)
            }`,
        timedOut,
        request.path,
      );
    } finally {
      clearTimeout(timer);
    }

    const body = parseJsonTolerant(text);
    if (!response.ok) {
      throw new NuiteeHttpError(response.status, body, request.path);
    }
    return body;
  }

  private buildUrl(request: NuiteeRequest): string {
    const base =
      request.api === NUITEE_API.BOOK
        ? this.config.bookBaseUrl
        : this.config.apiBaseUrl;
    const url = new URL(base.replace(/\/+$/, "") + request.path);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }
}

/** Empty body -> null; invalid JSON -> the raw text (never throws). */
export function parseJsonTolerant(text: string): unknown {
  if (text.trim() === "") {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
