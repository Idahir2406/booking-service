import { config } from "dotenv";
import { z } from "zod";

config();
const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.url(),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DB_HOST: z.string(),
  DB_PORT: z.coerce.number(),
  DB_USERNAME: z.string(),
  DB_PASSWORD: z.string(),
  DB_DATABASE: z.string(),
  COMMISSION_PERCENTAGE: z.coerce.number().default(0.1),
  CURRENCY: z.string().default("EUR"),
  // 15 minutes
  PENDING_RESERVATION_EXPIRATION_TIME: z.coerce
    .number()
    .default(1000 * 60 * 15),
  DB_PREFIX: z.string().default("v4p_j"),
  STRIPE_API_KEY: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string(),
  FRONTEND_URL: z.url().default("http://localhost:3000"),
  BOOKING_WEB_URL: z.url().optional(),
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
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  MAIL_QUEUE_NAME: z.string().default("mail-send"),
});

export const envs = envSchema.parse(process.env);
