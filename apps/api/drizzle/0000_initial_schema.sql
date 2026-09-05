CREATE TYPE "public"."approval_level" AS ENUM('MANAGER', 'FINANCE');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."backorder_status" AS ENUM('OPEN', 'STOCK_AVAILABLE', 'CONSOLIDATED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."billing_schedule_status" AS ENUM('SCHEDULED', 'INVOICED', 'PAID', 'SKIPPED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."billing_type" AS ENUM('ONE_TIME', 'RECURRING');--> statement-breakpoint
CREATE TYPE "public"."cancellation_mode" AS ENUM('IMMEDIATE', 'END_OF_PERIOD');--> statement-breakpoint
CREATE TYPE "public"."day_count_convention" AS ENUM('ACTUAL_DAYS', 'THIRTY_DAY_MONTH');--> statement-breakpoint
CREATE TYPE "public"."deal_health_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."deal_health_type" AS ENUM('STALLED', 'DISCOUNT_ANOMALY', 'DELIVERY_SLIPPAGE');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('NOT_STARTED', 'ALLOCATING', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'BACKORDERED', 'PARTIALLY_FULFILLED', 'FULFILLED');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');--> statement-breakpoint
CREATE TYPE "public"."invoice_type" AS ENUM('ONE_TIME', 'RECURRING');--> statement-breakpoint
CREATE TYPE "public"."negotiation_request_type" AS ENUM('QUESTION', 'DISCOUNT_COUNTER', 'QUANTITY_CHANGE', 'LINE_REMOVAL');--> statement-breakpoint
CREATE TYPE "public"."negotiation_status" AS ENUM('SUBMITTED', 'APPLIED', 'PENDING_APPROVAL', 'ANSWERED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."proration_mode" AS ENUM('NONE', 'DAILY_PRORATA', 'FULL_PERIOD');--> statement-breakpoint
CREATE TYPE "public"."quotation_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED', 'SENT', 'UNDER_NEGOTIATION', 'CONFIRMED', 'FULFILLMENT', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."refund_mode" AS ENUM('NONE', 'PARTIAL_PRORATA', 'FULL');--> statement-breakpoint
CREATE TYPE "public"."required_approval_level" AS ENUM('NONE', 'MANAGER', 'MANAGER_FINANCE');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'SALES_REP', 'SALES_MANAGER', 'FINANCE_OPERATIONS', 'CUSTOMER');--> statement-breakpoint
CREATE TYPE "public"."subscription_interval" AS ENUM('MONTHLY', 'QUARTERLY', 'YEARLY');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('PENDING', 'ACTIVE', 'MODIFIED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "customer_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"default_discount_ceiling_bp" integer NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_tiers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"tier_id" uuid NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"billing_address" text,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "magic_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"quotation_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "magic_link_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"role" "role" NOT NULL,
	"customer_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_margin_bp" integer DEFAULT 3000 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_list_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"price_paise" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"customer_tier_id" uuid,
	"currency" text DEFAULT 'INR' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_lists_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "product_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"recommended_product_id" uuid NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"attribute" text NOT NULL,
	"value" text NOT NULL,
	"extra_price_paise" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"unit" text DEFAULT 'unit' NOT NULL,
	"base_price_paise" integer NOT NULL,
	"unit_cost_paise" integer,
	"tax_bp" integer DEFAULT 1800 NOT NULL,
	"description" text,
	"billing_type" "billing_type" DEFAULT 'ONE_TIME' NOT NULL,
	"stock_tracked" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"label" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"min_risk_bp" integer NOT NULL,
	"max_risk_bp" integer,
	"required_level" "required_approval_level" NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discount_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"customer_tier_id" uuid,
	"category_id" uuid,
	"max_discount_bp" integer NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"value_type" text DEFAULT 'string' NOT NULL,
	"group" text DEFAULT 'general' NOT NULL,
	"description" text,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"quotation_version" integer NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"level" "approval_level" NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"risk_score_bp" integer NOT NULL,
	"reviewer_id" uuid,
	"reason" text,
	"acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "negotiation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"quotation_version" integer NOT NULL,
	"customer_id" uuid NOT NULL,
	"submitted_by_id" uuid NOT NULL,
	"request_type" "negotiation_request_type" NOT NULL,
	"line_id" uuid,
	"proposed_discount_bp" integer,
	"proposed_quantity" integer,
	"comment" text,
	"status" "negotiation_status" DEFAULT 'SUBMITTED' NOT NULL,
	"resulting_version" integer,
	"resolution_note" text,
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"product_name" text NOT NULL,
	"product_sku" text NOT NULL,
	"category_id" uuid NOT NULL,
	"category_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"list_unit_price_paise" integer NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"effective_ceiling_bp" integer DEFAULT 0 NOT NULL,
	"violation_bp" integer DEFAULT 0 NOT NULL,
	"ceiling_rule_id" uuid,
	"tax_bp" integer DEFAULT 0 NOT NULL,
	"gross_amount_paise" integer DEFAULT 0 NOT NULL,
	"discount_amount_paise" integer DEFAULT 0 NOT NULL,
	"order_discount_amount_paise" integer DEFAULT 0 NOT NULL,
	"net_amount_paise" integer DEFAULT 0 NOT NULL,
	"tax_amount_paise" integer DEFAULT 0 NOT NULL,
	"line_total_paise" integer DEFAULT 0 NOT NULL,
	"unit_cost_paise" integer DEFAULT 0 NOT NULL,
	"cost_amount_paise" integer DEFAULT 0 NOT NULL,
	"margin_paise" integer DEFAULT 0 NOT NULL,
	"line_type" "billing_type" DEFAULT 'ONE_TIME' NOT NULL,
	"subscription_plan_id" uuid,
	"added_from_recommendation" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"risk_score_bp" integer NOT NULL,
	"required_approval_level" "required_approval_level" NOT NULL,
	"grand_total_paise" integer NOT NULL,
	"margin_paise" integer NOT NULL,
	"reason" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"sales_rep_id" uuid NOT NULL,
	"status" "quotation_status" DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"order_discount_bp" integer DEFAULT 0 NOT NULL,
	"subtotal_paise" integer DEFAULT 0 NOT NULL,
	"discount_total_paise" integer DEFAULT 0 NOT NULL,
	"tax_total_paise" integer DEFAULT 0 NOT NULL,
	"grand_total_paise" integer DEFAULT 0 NOT NULL,
	"one_time_subtotal_paise" integer DEFAULT 0 NOT NULL,
	"one_time_grand_total_paise" integer DEFAULT 0 NOT NULL,
	"recurring_subtotal_paise" integer DEFAULT 0 NOT NULL,
	"recurring_grand_total_paise" integer DEFAULT 0 NOT NULL,
	"estimated_cost_paise" integer DEFAULT 0 NOT NULL,
	"margin_paise" integer DEFAULT 0 NOT NULL,
	"margin_bp" integer DEFAULT 0 NOT NULL,
	"risk_score_bp" integer DEFAULT 0 NOT NULL,
	"risk_breakdown" jsonb,
	"required_approval_level" "required_approval_level" DEFAULT 'NONE' NOT NULL,
	"approved_version" integer,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promised_delivery_date" date,
	"projected_delivery_date" date,
	"valid_until" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_quote_number_unique" UNIQUE("quote_number")
);
--> statement-breakpoint
CREATE TABLE "recommendation_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"dismissed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backorders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"quotation_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "backorder_status" DEFAULT 'OPEN' NOT NULL,
	"available_warehouse_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfillment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"quotation_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"shipment_cost_paise" integer DEFAULT 0 NOT NULL,
	"reserved" boolean DEFAULT false NOT NULL,
	"from_backorder_id" uuid,
	"shipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfillments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"status" "fulfillment_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"planned_shipment_count" integer DEFAULT 0 NOT NULL,
	"planned_shipping_cost_paise" integer DEFAULT 0 NOT NULL,
	"is_overridden" boolean DEFAULT false NOT NULL,
	"accepted_by_id" uuid,
	"accepted_at" timestamp with time zone,
	"projected_delivery_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillments_quotation_id_unique" UNIQUE("quotation_id")
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"available_quantity" integer DEFAULT 0 NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"reorder_point" integer DEFAULT 0 NOT NULL,
	"reorder_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"shipping_weight_bp" integer DEFAULT 10000 NOT NULL,
	"base_shipment_cost_paise" integer DEFAULT 0 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"lead_time_days" integer DEFAULT 2 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "billing_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount_paise" integer NOT NULL,
	"tax_amount_paise" integer DEFAULT 0 NOT NULL,
	"total_paise" integer NOT NULL,
	"quantity" integer NOT NULL,
	"status" "billing_schedule_status" DEFAULT 'SCHEDULED' NOT NULL,
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_note_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"invoice_id" uuid,
	"subscription_id" uuid,
	"amount_paise" integer NOT NULL,
	"reason" text NOT NULL,
	"issued_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_credit_note_number_unique" UNIQUE("credit_note_number")
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"product_id" uuid,
	"quotation_line_id" uuid,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"tax_bp" integer DEFAULT 0 NOT NULL,
	"net_amount_paise" integer NOT NULL,
	"tax_amount_paise" integer DEFAULT 0 NOT NULL,
	"amount_paise" integer NOT NULL,
	"is_proration" boolean DEFAULT false NOT NULL,
	"period_start" date,
	"period_end" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"quotation_id" uuid,
	"subscription_id" uuid,
	"type" "invoice_type" NOT NULL,
	"status" "invoice_status" DEFAULT 'DRAFT' NOT NULL,
	"subtotal_paise" integer DEFAULT 0 NOT NULL,
	"discount_paise" integer DEFAULT 0 NOT NULL,
	"tax_paise" integer DEFAULT 0 NOT NULL,
	"amount_paise" integer DEFAULT 0 NOT NULL,
	"amount_paid_paise" integer DEFAULT 0 NOT NULL,
	"credited_paise" integer DEFAULT 0 NOT NULL,
	"issue_date" date,
	"due_date" date,
	"period_start" date,
	"period_end" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"method" text DEFAULT 'BANK_TRANSFER' NOT NULL,
	"reference" text,
	"status" "payment_status" DEFAULT 'COMPLETED' NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_plan_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"interval" "subscription_interval" NOT NULL,
	"proration_mode" "proration_mode" DEFAULT 'DAILY_PRORATA' NOT NULL,
	"cancellation_mode" "cancellation_mode" DEFAULT 'END_OF_PERIOD' NOT NULL,
	"refund_mode" "refund_mode" DEFAULT 'PARTIAL_PRORATA' NOT NULL,
	"day_count_convention" "day_count_convention" DEFAULT 'ACTUAL_DAYS' NOT NULL,
	"min_term_intervals" integer DEFAULT 0 NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plans_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"quotation_id" uuid,
	"quotation_line_id" uuid,
	"quantity" integer NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"tax_bp" integer DEFAULT 0 NOT NULL,
	"status" "subscription_status" DEFAULT 'PENDING' NOT NULL,
	"start_date" date NOT NULL,
	"current_period_start" date NOT NULL,
	"current_period_end" date NOT NULL,
	"next_billing_date" date NOT NULL,
	"cancelled_at" timestamp with time zone,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_subscription_number_unique" UNIQUE("subscription_number")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "role",
	"actor_label" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"quotation_id" uuid,
	"quotation_version" integer,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_health_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"type" "deal_health_type" NOT NULL,
	"severity" "deal_health_severity" NOT NULL,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"metadata" jsonb,
	"nudged_at" timestamp with time zone,
	"nudged_by_id" uuid,
	"escalated_at" timestamp with time zone,
	"escalated_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tier_id_customer_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."customer_tiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD CONSTRAINT "magic_link_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_customer_tier_id_customer_tiers_id_fk" FOREIGN KEY ("customer_tier_id") REFERENCES "public"."customer_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_pairings" ADD CONSTRAINT "product_pairings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_pairings" ADD CONSTRAINT "product_pairings_recommended_product_id_products_id_fk" FOREIGN KEY ("recommended_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_customer_tier_id_customer_tiers_id_fk" FOREIGN KEY ("customer_tier_id") REFERENCES "public"."customer_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rules" ADD CONSTRAINT "discount_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_requests" ADD CONSTRAINT "negotiation_requests_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_requests" ADD CONSTRAINT "negotiation_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_requests" ADD CONSTRAINT "negotiation_requests_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_requests" ADD CONSTRAINT "negotiation_requests_line_id_quotation_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."quotation_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_requests" ADD CONSTRAINT "negotiation_requests_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_versions" ADD CONSTRAINT "quotation_versions_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_versions" ADD CONSTRAINT "quotation_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_sales_rep_id_users_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_dismissals" ADD CONSTRAINT "recommendation_dismissals_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_dismissals" ADD CONSTRAINT "recommendation_dismissals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_dismissals" ADD CONSTRAINT "recommendation_dismissals_dismissed_by_id_users_id_fk" FOREIGN KEY ("dismissed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backorders" ADD CONSTRAINT "backorders_fulfillment_id_fulfillments_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "public"."fulfillments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backorders" ADD CONSTRAINT "backorders_quotation_line_id_quotation_lines_id_fk" FOREIGN KEY ("quotation_line_id") REFERENCES "public"."quotation_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backorders" ADD CONSTRAINT "backorders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backorders" ADD CONSTRAINT "backorders_available_warehouse_id_warehouses_id_fk" FOREIGN KEY ("available_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_allocations" ADD CONSTRAINT "fulfillment_allocations_fulfillment_id_fulfillments_id_fk" FOREIGN KEY ("fulfillment_id") REFERENCES "public"."fulfillments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_allocations" ADD CONSTRAINT "fulfillment_allocations_quotation_line_id_quotation_lines_id_fk" FOREIGN KEY ("quotation_line_id") REFERENCES "public"."quotation_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_allocations" ADD CONSTRAINT "fulfillment_allocations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_allocations" ADD CONSTRAINT "fulfillment_allocations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_accepted_by_id_users_id_fk" FOREIGN KEY ("accepted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_schedules" ADD CONSTRAINT "billing_schedules_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_issued_by_id_users_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_quotation_line_id_quotation_lines_id_fk" FOREIGN KEY ("quotation_line_id") REFERENCES "public"."quotation_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan_products" ADD CONSTRAINT "subscription_plan_products_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_plan_products" ADD CONSTRAINT "subscription_plan_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_quotation_line_id_quotation_lines_id_fk" FOREIGN KEY ("quotation_line_id") REFERENCES "public"."quotation_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_health_events" ADD CONSTRAINT "deal_health_events_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_health_events" ADD CONSTRAINT "deal_health_events_nudged_by_id_users_id_fk" FOREIGN KEY ("nudged_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_health_events" ADD CONSTRAINT "deal_health_events_escalated_by_id_users_id_fk" FOREIGN KEY ("escalated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_tier_idx" ON "customers" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "magic_link_user_idx" ON "magic_link_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_customer_idx" ON "users" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_items_unique" ON "price_list_items" USING btree ("price_list_id","product_id");--> statement-breakpoint
CREATE INDEX "price_lists_tier_idx" ON "price_lists" USING btree ("customer_tier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_pairings_unique" ON "product_pairings" USING btree ("product_id","recommended_product_id");--> statement-breakpoint
CREATE INDEX "product_pairings_product_idx" ON "product_pairings" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_unique" ON "product_variants" USING btree ("product_id","attribute","value");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_billing_type_idx" ON "products" USING btree ("billing_type");--> statement-breakpoint
CREATE INDEX "promotions_product_idx" ON "promotions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "approval_rules_band_idx" ON "approval_rules" USING btree ("min_risk_bp","max_risk_bp");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_rules_scope_unique" ON "discount_rules" USING btree ("customer_tier_id","category_id");--> statement-breakpoint
CREATE INDEX "discount_rules_tier_idx" ON "discount_rules" USING btree ("customer_tier_id");--> statement-breakpoint
CREATE INDEX "discount_rules_category_idx" ON "discount_rules" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_instances_unique" ON "approval_instances" USING btree ("quotation_id","attempt","sequence");--> statement-breakpoint
CREATE INDEX "approval_instances_status_idx" ON "approval_instances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approval_instances_quotation_idx" ON "approval_instances" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "negotiation_requests_quotation_idx" ON "negotiation_requests" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "negotiation_requests_status_idx" ON "negotiation_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quotation_lines_quotation_idx" ON "quotation_lines" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "quotation_lines_product_idx" ON "quotation_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotation_versions_unique" ON "quotation_versions" USING btree ("quotation_id","version");--> statement-breakpoint
CREATE INDEX "quotations_customer_idx" ON "quotations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "quotations_rep_idx" ON "quotations" USING btree ("sales_rep_id");--> statement-breakpoint
CREATE INDEX "quotations_status_idx" ON "quotations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quotations_activity_idx" ON "quotations" USING btree ("last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_dismissals_unique" ON "recommendation_dismissals" USING btree ("quotation_id","product_id");--> statement-breakpoint
CREATE INDEX "backorders_fulfillment_idx" ON "backorders" USING btree ("fulfillment_id");--> statement-breakpoint
CREATE INDEX "backorders_status_idx" ON "backorders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "backorders_product_idx" ON "backorders" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "fulfillment_allocations_fulfillment_idx" ON "fulfillment_allocations" USING btree ("fulfillment_id");--> statement-breakpoint
CREATE INDEX "fulfillment_allocations_line_idx" ON "fulfillment_allocations" USING btree ("quotation_line_id");--> statement-breakpoint
CREATE INDEX "fulfillment_allocations_warehouse_idx" ON "fulfillment_allocations" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "fulfillments_status_idx" ON "fulfillments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_unique" ON "inventory" USING btree ("warehouse_id","product_id");--> statement-breakpoint
CREATE INDEX "inventory_product_idx" ON "inventory" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_schedules_unique" ON "billing_schedules" USING btree ("subscription_id","sequence");--> statement-breakpoint
CREATE INDEX "billing_schedules_status_idx" ON "billing_schedules" USING btree ("status");--> statement-breakpoint
CREATE INDEX "credit_notes_customer_idx" ON "credit_notes" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "credit_notes_invoice_idx" ON "credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_customer_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoices_quotation_idx" ON "invoices" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_plan_products_unique" ON "subscription_plan_products" USING btree ("plan_id","product_id");--> statement-breakpoint
CREATE INDEX "subscription_plan_products_product_idx" ON "subscription_plan_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "subscriptions_customer_idx" ON "subscriptions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_quotation_idx" ON "subscriptions" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_quotation_idx" ON "audit_logs" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_health_events_unique" ON "deal_health_events" USING btree ("quotation_id","type","fingerprint");--> statement-breakpoint
CREATE INDEX "deal_health_events_type_idx" ON "deal_health_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "deal_health_events_open_idx" ON "deal_health_events" USING btree ("resolved_at");