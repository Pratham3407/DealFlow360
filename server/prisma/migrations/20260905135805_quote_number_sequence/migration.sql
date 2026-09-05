-- Quotation numbering.
--
-- quote_number is @unique in the schema but had no generation strategy. A
-- sequence is the only race-free option that does not require locking: two
-- concurrent creates get distinct values without either blocking, whereas
-- count(*) + 1 would collide under concurrency.
--
-- The sequence is not owned by a column, so Prisma's introspection leaves it
-- alone; the application reads it explicitly and formats the prefix.
CREATE SEQUENCE IF NOT EXISTS "quotation_number_seq" AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

-- Format is Q-<year>-<6-digit padded sequence>, e.g. Q-2026-000001. The year is
-- informational only; the sequence never resets, so uniqueness does not depend
-- on it and no collision is possible at a year boundary.
