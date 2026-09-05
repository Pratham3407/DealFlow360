import { afterAll } from 'vitest';
import { disconnectPrisma } from '../src/db/prisma';

/** Runs in every worker. Migrations are applied once by globalSetup.ts. */
afterAll(async () => {
  await disconnectPrisma();
});
