import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * From Prisma 7 onward the datasource URL, migration output path and seed
 * command live here rather than in schema.prisma, and environment variables are
 * no longer auto-loaded by the CLI - hence the explicit `dotenv/config` import.
 *
 * Run every `prisma` command with this directory (server/) as the working
 * directory, e.g. `npm run db:migrate --workspace server`.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
