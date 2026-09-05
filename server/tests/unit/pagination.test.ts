import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  activeFilter,
  listQuerySchema,
  pageArgs,
  paginated,
  searchFilter,
} from '../../src/http/pagination';

describe('list query parsing', () => {
  it('applies defaults when nothing is supplied', () => {
    const query = listQuerySchema.parse({});
    expect(query).toEqual({ limit: DEFAULT_LIMIT, offset: 0 });
  });

  it('coerces numeric strings, as they arrive from a query string', () => {
    const query = listQuerySchema.parse({ limit: '10', offset: '20' });
    expect(query.limit).toBe(10);
    expect(query.offset).toBe(20);
  });

  it('caps limit so one request cannot ask for the whole table', () => {
    expect(() => listQuerySchema.parse({ limit: String(MAX_LIMIT + 1) })).toThrow();
    expect(listQuerySchema.parse({ limit: String(MAX_LIMIT) }).limit).toBe(MAX_LIMIT);
  });

  it('rejects a zero or negative limit and a negative offset', () => {
    expect(() => listQuerySchema.parse({ limit: '0' })).toThrow();
    expect(() => listQuerySchema.parse({ limit: '-1' })).toThrow();
    expect(() => listQuerySchema.parse({ offset: '-1' })).toThrow();
  });

  it('rejects a fractional limit', () => {
    expect(() => listQuerySchema.parse({ limit: '1.5' })).toThrow();
  });

  it('treats active as tri-state, so omitting it returns both', () => {
    expect(listQuerySchema.parse({}).active).toBeUndefined();
    expect(listQuerySchema.parse({ active: 'true' }).active).toBe(true);
    expect(listQuerySchema.parse({ active: 'false' }).active).toBe(false);
    // Anything other than the two literals is a client mistake worth reporting.
    expect(() => listQuerySchema.parse({ active: 'yes' })).toThrow();
  });

  it('trims the search term and rejects an empty one', () => {
    expect(listQuerySchema.parse({ q: '  laptop  ' }).q).toBe('laptop');
    expect(() => listQuerySchema.parse({ q: '   ' })).toThrow();
  });
});

describe('filter helpers', () => {
  it('builds a case-insensitive OR across the given columns', () => {
    const query = listQuerySchema.parse({ q: 'ACME' });
    expect(searchFilter(query, ['code', 'name'])).toEqual({
      OR: [
        { code: { contains: 'ACME', mode: 'insensitive' } },
        { name: { contains: 'ACME', mode: 'insensitive' } },
      ],
    });
  });

  it('returns undefined without a search term, so it can be spread unconditionally', () => {
    const query = listQuerySchema.parse({});
    expect(searchFilter(query, ['code'])).toBeUndefined();
    expect({ ...searchFilter(query, ['code']) }).toEqual({});
  });

  it('emits an active filter only when the caller asked for one', () => {
    expect(activeFilter(listQuerySchema.parse({}))).toBeUndefined();
    expect(activeFilter(listQuerySchema.parse({ active: 'true' }))).toEqual({ active: true });
    expect(activeFilter(listQuerySchema.parse({ active: 'false' }))).toEqual({ active: false });
  });
});

describe('envelope', () => {
  it('reports the requested window alongside the total', () => {
    const query = listQuerySchema.parse({ limit: '2', offset: '4' });
    expect(paginated(['a', 'b'], 37, query)).toEqual({
      data: ['a', 'b'],
      meta: { total: 37, limit: 2, offset: 4 },
    });
  });

  it('translates to Prisma skip/take', () => {
    expect(pageArgs(listQuerySchema.parse({ limit: '25', offset: '50' }))).toEqual({
      skip: 50,
      take: 25,
    });
  });
});
