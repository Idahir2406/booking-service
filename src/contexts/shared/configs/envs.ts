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
  // 10minutes
  PENDING_RESERVATION_EXPIRATION_TIME: z.coerce
    .number()
    .default(1000 * 60 * 10),
  DB_PREFIX: z.string().default("v4p_j"),
  STRIPE_API_KEY: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string(),
  FRONTEND_URL: z.url().default("http://localhost:3000"),
});

export const envs = envSchema.parse(process.env);
