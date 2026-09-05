import { prisma } from '../../src/db/prisma';

interface TableRow {
  tablename: string;
}

let cachedTruncateStatement: string | null = null;

/**
 * Empty every domain table.
 *
 * Table names are read from the catalog rather than hard-coded so a new model
 * cannot be forgotten here and leak fixtures between tests. `_prisma_migrations`
 * is preserved so migrations are not reapplied. CASCADE handles the foreign key
 * graph in one statement, which is far faster than ordered deletes.
 */
export async function resetDatabase(): Promise<void> {
  if (!cachedTruncateStatement) {
    const tables = await prisma.$queryRaw<TableRow[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    if (tables.length === 0) {
      throw new Error('Test database has no tables - did globalSetup run migrations?');
    }
    const list = tables.map((row) => `"public"."${row.tablename}"`).join(', ');
    cachedTruncateStatement = `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`;
  }

  await prisma.$executeRawUnsafe(cachedTruncateStatement);
}
