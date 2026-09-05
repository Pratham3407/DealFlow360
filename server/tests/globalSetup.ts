import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Bring the test database up to the current migration state once per run.
 *
 * `migrate deploy` rather than `db push`, so the suite exercises the same
 * migration SQL that production would - including the hand-written CHECK
 * constraints appended to the init migration, which `db push` would skip.
 */
export default function setup(): void {
  const databaseUrl = process.env['TEST_DATABASE_URL'];
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is not set.');

  const prismaCli = require.resolve('prisma/build/index.js');

  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    // Overriding DATABASE_URL is what redirects prisma.config.ts at the test
    // database; dotenv inside that config will not override an existing value.
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      `prisma migrate deploy failed for the test database:\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
}
