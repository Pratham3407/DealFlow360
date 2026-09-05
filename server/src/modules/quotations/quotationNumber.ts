import type { Db } from '../../db/prisma';

/**
 * Quotation numbering.
 *
 * A Postgres sequence, created in migration 20260905135805_quote_number_sequence.
 * Two concurrent creates therefore receive distinct numbers without either
 * blocking, which `count(*) + 1` could not guarantee.
 *
 * Format: Q-<year>-<6 digits>, e.g. Q-2026-000001. The year is informational —
 * the sequence never resets, so uniqueness does not depend on it and a year
 * boundary cannot cause a collision. Past six digits the number simply grows.
 */
const PREFIX = 'Q';
const PAD_TO = 6;

interface SequenceRow {
  value: bigint;
}

export async function nextQuoteNumber(db: Db, now: Date = new Date()): Promise<string> {
  // nextval is transactional but never rolled back, so a failed create burns a
  // number rather than reusing one. That is the correct trade: gaps in a quote
  // series are harmless, duplicates are not.
  const rows = await db.$queryRaw<SequenceRow[]>`
    SELECT nextval('quotation_number_seq') AS value
  `;

  const value = rows[0]?.value;
  if (value === undefined) {
    throw new Error('quotation_number_seq did not return a value');
  }

  const serial = value.toString().padStart(PAD_TO, '0');
  return `${PREFIX}-${now.getUTCFullYear()}-${serial}`;
}
