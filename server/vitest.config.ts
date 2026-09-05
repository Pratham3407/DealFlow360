import 'dotenv/config';
import { defineConfig } from 'vitest/config';

/**
 * The suite runs against a dedicated database that it truncates between tests,
 * so pointing it at the application database would destroy development data.
 * Fail loudly rather than risk that.
 */
const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL must be set in server/.env before running tests.');
}
if (testDatabaseUrl === process.env['DATABASE_URL']) {
  throw new Error('TEST_DATABASE_URL must not be the same database as DATABASE_URL.');
}

export default defineConfig({
  test: {
    environment: 'node',
    // Injected into every worker. dotenv does not override already-set
    // variables, so these win over server/.env inside the tests.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      LOG_LEVEL: 'silent',
    },
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    // One shared database: parallel files would truncate each other's fixtures.
    fileParallelism: false,
    // scrypt is deliberately slow, so fixture setup needs headroom.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
  },
});
