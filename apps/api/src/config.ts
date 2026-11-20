import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("postgres://reval:reval@localhost:5432/reval"),
  // Public URL of the Next.js portal; used for run links and Stripe redirects.
  PORTAL_URL: z.string().url().default("http://localhost:3000"),
  SESSION_TTL_DAYS: z.coerce.number().default(14),
  COOKIE_SECURE: z.stringbool().default(false),
  // "dev" skips Stripe and exposes a dev-only activation endpoint.
  BILLING_MODE: z.enum(["stripe", "dev"]).default("dev"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  // Extra time on top of the run's timeout before a lease is considered dead.
  LEASE_GRACE_MS: z.coerce.number().default(30_000),
  RECOMMENDED_CONCURRENCY: z.coerce.number().default(4),
  POLL_INTERVAL_MS: z.coerce.number().default(2_000),
  PUBLIC_API_RATE_LIMIT_PER_MIN: z.coerce.number().default(600),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // Vercel's Supabase/Neon integrations provide POSTGRES_URL (pooled); DATABASE_URL wins when both are set.
  // Vercel's Stripe integration provides STRIPE_PROD_STRIPE_SECRET_KEY; STRIPE_SECRET_KEY wins when both are set.
  env = {
    ...env,
    DATABASE_URL: env.DATABASE_URL || env.POSTGRES_URL,
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY || env.STRIPE_PROD_STRIPE_SECRET_KEY,
  };
  const config = schema.parse(env);
  if (config.BILLING_MODE === "stripe" &&
      (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET || !config.STRIPE_PRICE_ID)) {
    throw new Error("BILLING_MODE=stripe requires STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_ID");
  }
  if (config.NODE_ENV === "production" && !env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set in production");
  }
  if (config.NODE_ENV === "production" && config.BILLING_MODE === "dev") {
    throw new Error("BILLING_MODE=dev is not allowed in production");
  }
  return config;
}
