import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { env } from '../config/env';

/**
 * Prisma 7 requires a driver adapter for every database, so the connection pool
 * is the `pg` pool. Prisma 6 defaulted to a 5s connection timeout while `pg`
 * defaults to none, which would turn a database outage into hung requests, so
 * the timeouts are set explicitly.
 */
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  max: env.isTest ? 5 : 10,
});

export const prisma = new PrismaClient({
  adapter,
  log: env.isDevelopment ? ['warn', 'error'] : ['error'],
});

type PrismaClientInstance = typeof prisma;

/**
 * The transaction-scoped client. Domain services accept this instead of the
 * global client so that a state change and its audit record commit together
 * (AGENTS.md 25). Taken from Prisma's own generated type rather than hand-rolled,
 * so it stays correct across upgrades.
 */
export type TransactionClient = Prisma.TransactionClient;

/** Either the root client or a transaction client - use for read helpers. */
export type Db = PrismaClientInstance | TransactionClient;

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
