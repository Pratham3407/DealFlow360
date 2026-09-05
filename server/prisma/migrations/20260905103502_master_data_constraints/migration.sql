-- Master-data invariants that the Prisma schema documents but could not express.
--
-- Each of these was claimed by a comment in schema.prisma or implied by
-- docs/PRD.md while being unenforced in the database. Application code validates
-- first so callers get business errors; these are the backstop against a bug, a
-- raw query or a future refactor.

-- A recurring product is billed on a cadence, and the cadence lives on the plan.
-- Without a plan there is nothing to derive a billing schedule from
-- (docs/PRD.md 9, docs/WORKFLOWS.md 8).
ALTER TABLE "products" ADD CONSTRAINT "products_recurring_requires_plan_check"
  CHECK ("product_type" <> 'RECURRING' OR "subscription_plan_id" IS NOT NULL);

-- A variant may cost extra or nothing extra, never less than nothing: a negative
-- uplift would be a discount smuggled past the discount rules.
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_extra_price_nonneg_check"
  CHECK ("extra_price" >= 0);

-- Shipping weight is a positive multiplier in the allocation objective
-- (docs/BUSINESS_RULES.md 7). Zero or negative would make a warehouse
-- free or profitable to ship from and break the optimisation.
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_shipping_weight_positive_check"
  CHECK ("shipping_weight" > 0);

-- A promotion window must move forwards. Either bound may be open.
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_window_order_check"
  CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at");
