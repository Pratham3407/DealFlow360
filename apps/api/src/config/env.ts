/**
 * Environment configuration.
 *
 * Parsed and validated once at import time. A misconfigured secret or a missing
 * database URL should stop the process immediately with a readable message rather
 * than surfacing as an authentication bug at request time.
 */

import { z } from 'zod';
import { loadEnvironment } from './dotenv.js';

loadEnvironment();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /**
   * Signing secret for access tokens. Required to be long enough that a demo
   * default cannot silently become a production default.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),

  /** Lifetime of a portal magic link, in minutes (PRD FR-1). */
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().default(60),

  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  /** Base URL the API embeds in generated portal magic links. */
  PORTAL_BASE_URL: z.string().default('http://localhost:5173/portal'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

  /**
   * Interval for the deal-health sweep, in minutes. `0` disables the timer, which
   * is what the test environment uses so detection can be triggered explicitly.
   */
  DEAL_HEALTH_SWEEP_MINUTES: z.coerce.number().int().min(0).default(15),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
} as const;

export type Env = typeof env;
