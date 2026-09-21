/**
 * Environment configuration.
 *
 * Validated once at boot with Zod, so a missing or malformed variable fails the
 * process immediately with a readable message rather than surfacing as an
 * undefined deep inside a request. No secret has a default value.
 */

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  API_PREFIX: z.string().default('api'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  /** Must be at least 32 chars. There is no default — see .env.example. */
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z
    .string()
    .regex(/^\d+[smhd]$/, 'Must be a duration like 15m, 2h or 7d')
    .default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /** Adapter selection. `mock` keeps the whole app runnable with no credentials. */
  PAYMENT_PROVIDER: z.enum(['mock', 'mercadopago', 'stripe']).default('mock'),
  AI_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  PUSH_PROVIDER: z.enum(['mock', 'expo']).default('mock'),
  ANALYTICS_PROVIDER: z.enum(['console', 'noop']).default('console'),

  MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  LOCAL_STORAGE_DIR: z.string().default('.storage'),
  PUBLIC_ASSET_BASE_URL: z.string().default('http://localhost:4000/assets'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().default(300),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type AppEnv = z.infer<typeof envSchema>;

export interface AppConfig extends AppEnv {
  readonly corsOrigins: string[];
  readonly isProduction: boolean;
}

let cached: AppConfig | undefined;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${details}\n\nCopy .env.example to .env and fill in the missing values.`,
    );
  }

  const env = parsed.data;

  // A provider selected without its credentials would fail at the worst possible
  // moment — mid-checkout — so it is caught at boot instead.
  assertProviderCredentials(env);

  cached = {
    ...env,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    isProduction: env.NODE_ENV === 'production',
  };
  return cached;
}

function assertProviderCredentials(env: AppEnv): void {
  const missing: string[] = [];

  if (env.PAYMENT_PROVIDER === 'mercadopago' && !env.MERCADOPAGO_ACCESS_TOKEN) {
    missing.push('MERCADOPAGO_ACCESS_TOKEN (required by PAYMENT_PROVIDER=mercadopago)');
  }
  if (env.PAYMENT_PROVIDER === 'stripe' && !env.STRIPE_SECRET_KEY) {
    missing.push('STRIPE_SECRET_KEY (required by PAYMENT_PROVIDER=stripe)');
  }
  if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    missing.push('ANTHROPIC_API_KEY (required by AI_PROVIDER=anthropic)');
  }
  if (env.STORAGE_PROVIDER === 's3' && (!env.S3_BUCKET || !env.S3_REGION)) {
    missing.push('S3_BUCKET and S3_REGION (required by STORAGE_PROVIDER=s3)');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing credentials for the selected providers:\n${missing
        .map((entry) => `  - ${entry}`)
        .join('\n')}\n\nSet them, or switch the provider back to its mock.`,
    );
  }
}

/** Test-only: clears the memoised config so a test can load a different env. */
export function resetConfigCache(): void {
  cached = undefined;
}
