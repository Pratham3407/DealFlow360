import { z } from 'zod';
import { Prisma } from '../generated/prisma/client';

/**
 * Field primitives shared by the master-data modules.
 *
 * Centralised so that "what is a valid percentage" or "what is a valid money
 * amount" has one answer across the API, and so the API's limits line up with
 * the database's CHECK constraints rather than drifting from them.
 */

/**
 * A stable, human-readable key (SKU, tier code, warehouse code).
 *
 * Uppercased and restricted to characters that are safe in a URL and unambiguous
 * in a spreadsheet. Codes are immutable after creation: configuration and
 * historical records refer to them.
 */
export const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
    message: 'may contain letters, digits, dot, underscore and hyphen only',
  })
  .transform((value) => value.toUpperCase());

export const nameSchema = z.string().trim().min(1).max(200);
export const descriptionSchema = z.string().trim().max(2000);

/**
 * A percentage expressed 0-100 with up to three decimals, matching
 * `Decimal(6,3)` and the `*_range_check` constraints. Sent as a number by
 * clients and handed to Prisma as a string so no float ever touches the value.
 */
export const percentSchema = z
  .number()
  .min(0)
  .max(100)
  .refine((value) => Number.isFinite(value), { message: 'must be a finite number' })
  .refine((value) => Math.round(value * 1000) === value * 1000, {
    message: 'supports at most 3 decimal places',
  });

/** Money, 0 or more, two decimals, matching `Decimal(14,2)`. */
export const moneySchema = z
  .number()
  .min(0)
  // 14 digits total with 2 decimals leaves 12 integer digits.
  .max(999_999_999_999.99)
  .refine((value) => Number.isFinite(value), { message: 'must be a finite number' })
  .refine((value) => Math.round(value * 100) === value * 100, {
    message: 'supports at most 2 decimal places',
  });

/** A positive multiplier or weight, four decimals, matching `Decimal(10,4)`. */
export const weightSchema = z
  .number()
  .gt(0)
  .max(999_999)
  .refine((value) => Math.round(value * 10_000) === value * 10_000, {
    message: 'supports at most 4 decimal places',
  });

export const quantitySchema = z.number().int().min(0).max(1_000_000_000);

/**
 * Convert a validated number to the string form Prisma expects for a Decimal
 * column. Going through a string keeps the exact decimal the client sent.
 */
export function toDecimalString(value: number, scale: number): string {
  return value.toFixed(scale);
}

export const MONEY_SCALE = 2;
export const PERCENT_SCALE = 3;
export const WEIGHT_SCALE = 4;
export const RISK_SCALE = 4;

/**
 * Canonical serialisation for decimal columns.
 *
 * `Prisma.Decimal.toString()` drops trailing zeros, so the same stored value can
 * surface as "80000" from one endpoint and "80000.00" from another. Every
 * response goes through these instead, so a client can compare and render values
 * from different endpoints without normalising them first.
 */
export function formatMoney(value: DecimalInput): string {
  return new Prisma.Decimal(value).toFixed(MONEY_SCALE);
}

export function formatPercent(value: DecimalInput): string {
  return new Prisma.Decimal(value).toFixed(PERCENT_SCALE);
}

export function formatWeight(value: DecimalInput): string {
  return new Prisma.Decimal(value).toFixed(WEIGHT_SCALE);
}

export function formatRisk(value: DecimalInput): string {
  return new Prisma.Decimal(value).toFixed(RISK_SCALE);
}

/** Anything `Prisma.Decimal` can be constructed from. */
export type DecimalInput = string | number | Prisma.Decimal;

export const uuidParam = (key: string): z.ZodObject<Record<string, z.ZodUUID>> =>
  z.object({ [key]: z.uuid() }) as z.ZodObject<Record<string, z.ZodUUID>>;
