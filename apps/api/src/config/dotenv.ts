/**
 * Minimal `.env` loader.
 *
 * Hand-rolled rather than pulling in `dotenv` for two reasons: it is ~40 lines,
 * and the precedence rule matters. Values already present in `process.env` always
 * win, so `DATABASE_URL=... pnpm test` overrides the file instead of being
 * silently ignored — which is how the test database is selected.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** `src/config` → package root. */
const packageRoot = resolve(here, '..', '..');

function parse(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (!key) continue;

    let value = line.slice(separator + 1).trim();
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1);

    if (isQuoted) {
      value = value.slice(1, -1);
      // Only double quotes get escape processing, matching shell semantics.
      if (rawLine.trim().slice(separator + 1).trim().startsWith('"')) {
        value = value.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      }
    } else {
      // Strip trailing inline comments from unquoted values.
      const comment = value.indexOf(' #');
      if (comment !== -1) value = value.slice(0, comment).trim();
    }

    result[key] = value;
  }
  return result;
}

/** Load the given env files in order. Earlier files win over later ones. */
export function loadEnvFiles(...fileNames: string[]): void {
  for (const fileName of fileNames) {
    const path = resolve(packageRoot, fileName);
    if (!existsSync(path)) continue;

    const values = parse(readFileSync(path, 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

/**
 * Standard load order for the API. `.env.test` is consulted first under
 * `NODE_ENV=test` so the suite points at `dealflow360_test` without needing the
 * developer to export anything.
 */
export function loadEnvironment(): void {
  if (process.env.NODE_ENV === 'test') {
    loadEnvFiles('.env.test', '.env');
    return;
  }
  loadEnvFiles('.env');
}
