/**
 * Structured logger.
 *
 * Deliberately dependency-free. The API needs levelled, greppable output with
 * request correlation; it does not need transports, redaction rules or a
 * multi-megabyte logging framework. `LOG_LEVEL=silent` keeps the test suite output
 * readable.
 */

import { env } from '../config/env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;

type Level = keyof typeof LEVELS;

const threshold = LEVELS[env.LOG_LEVEL as Level] ?? LEVELS.info;

function emit(level: Exclude<Level, 'silent'>, message: string, context?: unknown): void {
  if (LEVELS[level] < threshold) return;

  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    message,
  };
  if (context !== undefined) entry.context = context;

  const line = env.isProduction ? JSON.stringify(entry) : formatPretty(level, message, context);
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

const COLOURS: Record<Exclude<Level, 'silent'>, string> = {
  debug: '\u001b[90m',
  info: '\u001b[36m',
  warn: '\u001b[33m',
  error: '\u001b[31m',
};

function formatPretty(level: Exclude<Level, 'silent'>, message: string, context?: unknown): string {
  const stamp = new Date().toISOString().slice(11, 23);
  const tag = `${COLOURS[level]}${level.toUpperCase().padEnd(5)}\u001b[0m`;
  const suffix = context === undefined ? '' : ` ${safeStringify(context)}`;
  return `${stamp} ${tag} ${message}${suffix}`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, inner) => (inner instanceof Error ? serialiseError(inner) : inner));
  } catch {
    return String(value);
  }
}

function serialiseError(error: Error): Record<string, unknown> {
  return { name: error.name, message: error.message, stack: error.stack };
}

export const logger = {
  debug: (message: string, context?: unknown) => emit('debug', message, context),
  info: (message: string, context?: unknown) => emit('info', message, context),
  warn: (message: string, context?: unknown) => emit('warn', message, context),
  error: (message: string, context?: unknown) => emit('error', message, context),
};
