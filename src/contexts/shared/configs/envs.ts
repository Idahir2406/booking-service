import { config } from "dotenv";
import { z } from "zod";

config();
const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  PRODUCTION_PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DB_HOST: z.string(),
  DB_PORT: z.coerce.number(),
  DB_USERNAME: z.string(),
  DB_PASSWORD: z.string(),
  DB_DATABASE: z.string(),
  // Legacy fallback only (F1): new reservations freeze commission_rate from
  // platform_settings.commission_rate; this is used for rows without it.
  COMMISSION_PERCENTAGE: z.coerce.number().default(0.1),
  // platform_settings in-memory cache TTL (ms). 0 disables caching.
  PLATFORM_SETTINGS_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(60_000),
  CURRENCY: z.string().default("EUR"),
  // Pending reservation TTL (ms). Single source for reservation.expiration_date
  // AND Stripe Checkout Session expires_at. Stripe requires >= 30 min, so the
  // effective value is clamped by resolvePendingTtlMs() (min 31 min, max 24 h).
  PENDING_RESERVATION_EXPIRATION_TIME: z.coerce
    .number()
    .default(1000 * 60 * 31),
  DB_PREFIX: z.string().default("v4p_j"),
  STRIPE_API_KEY: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string(),
  // Connect endpoint secret (host account events: payout.failed/paid, account.updated).
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional(),
  FRONTEND_URL: z.url().default("http://localhost:3000"),
  BOOKING_WEB_URL: z.url().optional(),
  // Base URL of the admino backoffice for links in emails (incident chat).
  // Default: (BOOKING_WEB_URL ?? FRONTEND_URL) + "/admino".
  BOOKING_ADMIN_URL: z.url().optional(),
  BOOKING_EMAIL_TOKEN: z.string().optional(),
  FEEDBACK_PAYOUT_DELAY_HOURS: z.coerce.number().default(24),
  BOOKING_DEV_EMAIL: z.string().email().default("idairreyes@gmail.com"),
  BOOKING_ADMIN_EMAIL: z.string().email().default("reservas@viajes4patas.com"),
  BOOKING_EMAIL_LANG: z.string().default("es"),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().default(465),
  SMTP_SECURE: z
    .string()
    .default("true")
    .transform(v => v === "true" || v === "1"),
  SMTP_USER: z.string(),
  SMTP_PASS: z.string(),
  SMTP_FROM: z.email(),
  SMTP_FROM_NAME: z.string(),
  SMTP_REPLY_TO: z.email(),
  SMTP_HELO: z.string().optional(),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  MAIL_QUEUE_NAME: z.string().default("mail-send"),
  // Shared secret for server-to-server calls (PHP web -> booking), header X-Internal-Key
  INTERNAL_API_KEY: z.string().min(32),
  // --- Nuitee / LiteAPI (providers context). All optional: the app boots
  // without them; provider calls fail with ProviderNotConfiguredError.
  NUITEE_API_KEY: z.string().optional(),
  // Data + rates API (GET /data/*, POST /hotels/rates).
  NUITEE_API_BASE_URL: z.url().default("https://api.liteapi.travel/v3.0"),
  // Booking API (prebook, book, bookings, cancel).
  NUITEE_BOOK_BASE_URL: z.url().default("https://book.liteapi.travel/v3.0"),
  NUITEE_PAYMENT_METHOD: z
    .enum(["ACC_CREDIT_CARD", "CREDIT", "WALLET"])
    .default("ACC_CREDIT_CARD"),
  // Webhook Authentication Token (Nuitee dashboard): expected value of the
  // `authorization` header. Unset: accepted with a warning outside
  // production; in production the webhook fails closed (503) unless request
  // signing (NUITEE_WEBHOOK_SECRET) is configured.
  NUITEE_WEBHOOK_AUTH_TOKEN: z.string().optional(),
  // Request-signing shared secret (enabled by Nuitee support): verifies
  // X-Request-Signature = sha512(body + secret + X-Request-Timestamp).
  NUITEE_WEBHOOK_SECRET: z.string().optional(),
  // Max age of X-Request-Timestamp. Retries keep the ORIGINAL timestamp, so
  // a 5-min window would reject legitimate retries: default 24 h.
  NUITEE_WEBHOOK_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .default(86_400),
  // sandbox:true deliveries are ignored in production unless "true".
  NUITEE_WEBHOOK_ACCEPT_SANDBOX: z
    .string()
    .default("false")
    .transform(v => v === "true" || v === "1"),
  NUITEE_GUEST_NATIONALITY: z.string().length(2).default("ES"),
  NUITEE_CURRENCY: z.string().length(3).default("EUR"),
  // Local HTTP timeouts (ms): live rate search vs every other call.
  NUITEE_RATES_TIMEOUT_MS: z.coerce.number().int().min(1000).default(8000),
  NUITEE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  // --- Provider reservations (quote -> manual-capture checkout -> book).
  // Best-effort prebook validity; an older prebook is redone before booking.
  PROVIDER_PREBOOK_TTL_MINUTES: z.coerce.number().int().min(1).default(20),
  // A booking with an unknown outcome and no provider record after this many
  // minutes is failed (authorization voided).
  PROVIDER_PENDING_FAIL_AFTER_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .default(30),
  // Card authorizations last ~7 days: void before this age (hours).
  PROVIDER_AUTH_MAX_AGE_HOURS: z.coerce.number().int().min(1).default(144),
  // Phase 5 provider crons (pending 5 min, daily reconciliation, weekly
  // hotel sync). "false" disables them (e.g. a second instance).
  PROVIDER_CRONS_ENABLED: z
    .string()
    .default("true")
    .transform(v => v === "true" || v === "1"),
});

export const envs = envSchema.parse(process.env);
