import { config } from "dotenv";
import { z } from "zod";

config();
const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.url(),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
});

export const envs = envSchema.parse(process.env);
