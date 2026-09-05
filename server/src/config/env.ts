import 'dotenv/config';
import { z } from 'zod';

/**
 * Validated process environment.
 *
 * `dotenv/config` is imported here rather than in the entrypoint so that any
 * module reaching for configuration - the API server, the Prisma seed script or
 * the test suite - gets a loaded and validated environment regardless of which
 * one happens to run first. ESM evaluates this import before the module body,
 * and repeat imports are cached, so it runs exactly once.
 */
const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
    message: 'must be a postgres:// or postgresql:// connection string',
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  DATABASE_URL: postgresUrl,
  /** Only required when running the test suite. */
  TEST_DATABASE_URL: postgresUrl.optional(),

  SESSION_COOKIE_NAME: z.string().min(1).default('df360_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),

  /**
   * Left empty in development: Vite proxies /api to this server, so the browser
   * sees a single origin and no CORS handling is needed.
   */
  CORS_ORIGIN: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined)),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // Fail loudly and immediately: a half-configured server is worse than none.
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = {
  ...parsed.data,
  isDevelopment: parsed.data.NODE_ENV === 'development',
  isTest: parsed.data.NODE_ENV === 'test',
  isProduction: parsed.data.NODE_ENV === 'production',
} as const;

export type Env = typeof env;
