/**
 * Drizzle Kit configuration.
 *
 * Only used by the CLI (`generate`, `push`, `studio`). Runtime migration is done
 * by `src/db/migrate.ts` so that applying migrations uses the same validated env
 * and connection code as the server.
 */

import { defineConfig } from 'drizzle-kit';
import { loadEnvironment } from './src/config/dotenv.js';

loadEnvironment();

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
