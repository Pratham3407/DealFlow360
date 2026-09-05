import { z } from 'zod';

/**
 * Shared list contract.
 *
 * Every collection endpoint answers `{ data, meta }` so a client can page
 * without guessing whether more rows exist. The envelope is uniform across the
 * API - including `/api/users`, which was migrated to it - so there is only ever
 * one shape to handle.
 */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface ListMeta {
  total: number;
  limit: number;
  offset: number;
}

export interface Paginated<T> {
  data: T[];
  meta: ListMeta;
}

/**
 * Query parameters common to every list endpoint.
 *
 * `active` is tri-state: omitted means "both", so a caller must opt in to
 * filtering. Master data is deactivated rather than deleted, which makes
 * "include the deactivated rows" a routine need rather than an edge case.
 */
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
  /** Free-text search; each module decides which columns it covers. */
  q: z.string().trim().min(1).max(200).optional(),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

/** Build the `{ data, meta }` envelope for a page of rows. */
export function paginated<T>(rows: T[], total: number, query: ListQuery): Paginated<T> {
  return { data: rows, meta: { total, limit: query.limit, offset: query.offset } };
}

/** Prisma `skip`/`take` for a validated list query. */
export function pageArgs(query: ListQuery): { skip: number; take: number } {
  return { skip: query.offset, take: query.limit };
}

/**
 * Case-insensitive "contains" filter across several columns.
 *
 * Returns undefined when there is no search term so it can be spread into a
 * Prisma `where` unconditionally.
 */
export function searchFilter<F extends string>(
  query: ListQuery,
  fields: readonly F[],
): { OR: Record<string, { contains: string; mode: 'insensitive' }>[] } | undefined {
  if (!query.q) return undefined;
  return {
    OR: fields.map((field) => ({ [field]: { contains: query.q!, mode: 'insensitive' as const } })),
  };
}

/** `{ active: boolean }` when the caller asked for it, otherwise nothing. */
export function activeFilter(query: ListQuery): { active: boolean } | undefined {
  return query.active === undefined ? undefined : { active: query.active };
}
