/**
 * Test runner configuration.
 *
 * The suite is integration-first: it exercises real routes against a real
 * PostgreSQL database, because the behaviour worth testing here (ceiling
 * resolution, approval routing, stock reservation, portal isolation) lives in SQL
 * transactions and RBAC middleware, not in isolated pure functions.
 *
 * Consequences of that choice, encoded below:
 *  - `fileParallelism: false`, since every file shares one database and re-seeds
 *    it; parallel files would fight over the same rows.
 *  - `isolate: false`, so the connection pool is created once for the run instead
 *    of per file.
 *  - `NODE_ENV=test`, which points `config/dotenv.ts` at `.env.test`
 *    (`dealflow360_test`) and disables the deal-health timer.
 */

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';

export default defineConfig({
  resolve: {
    /**
     * Mirrors the `@/*` path mapping in tsconfig.json. `tsx` reads that mapping
     * directly; Vite needs it restated here or the source files' own imports fail
     * to resolve under the test runner.
     */
    alias: [
      {
        find: /^@\/(.*)\.js$/,
        replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/$1.ts`,
      },
    ],
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    fileParallelism: false,
    isolate: false,
    pool: 'forks',
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: { NODE_ENV: 'test' },
  },
});