/**
 * Demo seed (SEED_DATA.md).
 *
 * Two deliberate choices:
 *
 * 1. Master data is inserted directly, because it *is* the configuration the
 *    engines read. Rules, ceilings, shipping weights and plan behaviour all live
 *    in these rows rather than in code (AGENT_INSTRUCTIONS.md §2).
 * 2. The canonical quotation is built through the domain services, not raw
 *    inserts. Seeding it any other way would produce a quote whose totals, risk
 *    score and approval routing were *asserted* rather than *computed*, which is
 *    exactly the state the demo is meant to prove the system reaches on its own.
 *
 * Re-runnable: truncates the tables it owns first, guarded by the same database
 * name check `drop.ts` uses.
 */

import { sql } from 'drizzle-orm';
import { closeDatabase, db, type DbExecutor } from './client.js';
import {
  approvalRules,
  categories,
  customerTiers,
  customers,
  discountRules,
  inventory,
  priceListItems,
  priceLists,
  productPairings,
  products,
  promotions,
  subscriptionPlanProducts,
  subscriptionPlans,
  systemSettings,
  warehouses,
} from './schema/index.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { createUser } from '../auth/auth.service.js';
import { addLine, confirmQuotation, createQuotation, sendQuotation } from '../domain/quotation/quotation.service.js';

const RUPEE = 100; // paise per rupee
const rupees = (value: number) => value * RUPEE;
const percent = (value: number) => Math.round(value * 100); // 12% -> 1200 bp

/** Demo password for every internal user. Never shipped to a real environment. */
const DEMO_PASSWORD = 'Dealflow!2026';

const ALLOWED_DATABASE_PATTERN = /^dealflow360(_test)?$/;

/** Every table the seed owns, ordered so a single TRUNCATE ... CASCADE is enough. */
const OWNED_TABLES = [
  'audit_logs',
  'deal_health_events',
  'payments',
  'credit_notes',
  'invoice_lines',
  'invoices',
  'billing_schedules',
  'subscriptions',
  'subscription_plan_products',
  'subscription_plans',
  'backorders',
  'fulfillment_allocations',
  'fulfillments',
  'recommendation_dismissals',
  'negotiation_requests',
  'approval_instances',
  'quotation_versions',
  'quotation_lines',
  'quotations',
  'inventory',
  'warehouses',
  'promotions',
  'product_pairings',
  'price_list_items',
  'price_lists',
  'product_variants',
  'products',
  'categories',
  'approval_rules',
  'discount_rules',
  'magic_link_tokens',
  'system_settings',
  'users',
  'customers',
  'customer_tiers',
] as const;

async function truncateAll(exec: DbExecutor): Promise<void> {
  const databaseName = new URL(env.DATABASE_URL).pathname.replace(/^\//, '');
  if (!ALLOWED_DATABASE_PATTERN.test(databaseName)) {
    throw new Error(
      `Refusing to seed database "${databaseName}". Only dealflow360 and dealflow360_test may be seeded.`,
    );
  }
  if (env.isProduction) throw new Error('Refusing to seed with NODE_ENV=production.');

  /**
   * `audit_logs` carries an append-only trigger, so the truncate has to disable it
   * for the duration. Re-enabled immediately below — a failure here aborts the
   * transaction, so the trigger cannot stay off.
   */
  await exec.execute(sql`alter table audit_logs disable trigger user`);
  await exec.execute(
    sql.raw(`truncate table ${OWNED_TABLES.map((t) => `"${t}"`).join(', ')} restart identity cascade`),
  );
  await exec.execute(sql`alter table audit_logs enable trigger user`);
}

export async function seed(exec: DbExecutor) {
  await truncateAll(exec);

  // ---------------------------------------------------------------- tiers

  const [bronze, silver, gold] = await exec
    .insert(customerTiers)
    .values([
      { name: 'Bronze', rank: 10, defaultDiscountCeilingBp: percent(5), description: 'Entry tier' },
      { name: 'Silver', rank: 20, defaultDiscountCeilingBp: percent(10), description: 'Established accounts' },
      { name: 'Gold', rank: 30, defaultDiscountCeilingBp: percent(15), description: 'Strategic accounts' },
    ])
    .returning();
  if (!bronze || !silver || !gold) throw new Error('Tier seed failed');

  // ---------------------------------------------------------------- customers

  const [acme, northwind] = await exec
    .insert(customers)
    .values([
      {
        code: 'ACME',
        name: 'Acme Corp',
        tierId: gold.id,
        contactName: 'Riya Sharma',
        contactEmail: 'buyer@acme.local',
        contactPhone: '+91 98200 11111',
        billingAddress: 'Acme Corp, 4th Floor, Prabhadevi, Mumbai 400025',
        paymentTermsDays: 30,
      },
      {
        code: 'NORTHWIND',
        name: 'Northwind Traders',
        tierId: silver.id,
        contactName: 'Arjun Mehta',
        contactEmail: 'buyer@northwind.local',
        billingAddress: 'Northwind Traders, Whitefield, Bengaluru 560066',
        paymentTermsDays: 45,
      },
    ])
    .returning();
  if (!acme || !northwind) throw new Error('Customer seed failed');

  // ---------------------------------------------------------------- users

  const admin = await createUser(exec, {
    email: 'admin@dealflow.local',
    name: 'Admin User',
    role: 'ADMIN',
    password: DEMO_PASSWORD,
  });
  const rep = await createUser(exec, {
    email: 'rep@dealflow.local',
    name: 'Sales Rep',
    role: 'SALES_REP',
    password: DEMO_PASSWORD,
  });
  const manager = await createUser(exec, {
    email: 'manager@dealflow.local',
    name: 'Sales Manager',
    role: 'SALES_MANAGER',
    password: DEMO_PASSWORD,
  });
  const finance = await createUser(exec, {
    email: 'finance@dealflow.local',
    name: 'Finance Operations',
    role: 'FINANCE_OPERATIONS',
    password: DEMO_PASSWORD,
  });
  /** Portal user: role CUSTOMER + customer scope is what portal isolation reads. */
  const buyer = await createUser(exec, {
    email: 'buyer@acme.local',
    name: 'Riya Sharma (Acme Corp)',
    role: 'CUSTOMER',
    password: DEMO_PASSWORD,
    customerId: acme.id,
  });

  // ---------------------------------------------------------------- categories

  const [hardware, services, subscriptionsCategory, networking, software, training] = await exec
    .insert(categories)
    .values([
      { name: 'Hardware', description: 'Physical, stock-bearing goods', defaultMarginBp: percent(25) },
      { name: 'Services', description: 'Delivered by people, not shipped', defaultMarginBp: percent(45) },
      { name: 'Subscriptions', description: 'Recurring entitlements', defaultMarginBp: percent(60) },
      { name: 'Networking', description: 'Switching, routing and wireless hardware', defaultMarginBp: percent(30) },
      { name: 'Software Licences', description: 'Perpetual and term licences, no stock', defaultMarginBp: percent(70) },
      { name: 'Training', description: 'Instructor-led and self-paced enablement', defaultMarginBp: percent(50) },
    ])
    .returning();
  if (!hardware || !services || !subscriptionsCategory || !networking || !software || !training) {
    throw new Error('Category seed failed');
  }

  // ---------------------------------------------------------------- products

  const [laptop, setup, support, warranty, ...extraProducts] = await exec
    .insert(products)
    .values([
      {
        sku: 'HW-LAPTOP-ENT',
        name: 'Enterprise Laptop',
        categoryId: hardware.id,
        unit: 'unit',
        basePricePaise: rupees(80_000),
        unitCostPaise: rupees(60_000),
        taxBp: percent(18),
        description: '14" enterprise laptop, 32GB RAM, 3-year on-site',
        billingType: 'ONE_TIME',
        stockTracked: true,
      },
      {
        sku: 'SVC-SETUP',
        name: 'Setup Service',
        categoryId: services.id,
        unit: 'device',
        basePricePaise: rupees(10_000),
        unitCostPaise: rupees(5_500),
        taxBp: percent(18),
        description: 'Imaging, enrolment and hand-over per device',
        billingType: 'ONE_TIME',
        stockTracked: false,
      },
      {
        sku: 'SUB-SUPPORT-PREM',
        name: 'Premium Support',
        categoryId: subscriptionsCategory.id,
        unit: 'seat/month',
        basePricePaise: rupees(5_000),
        unitCostPaise: rupees(1_800),
        taxBp: percent(18),
        description: '24×7 priority support, per seat per month',
        billingType: 'RECURRING',
        stockTracked: false,
      },
      {
        sku: 'SVC-WARRANTY-EXT',
        name: 'Extended Warranty',
        categoryId: services.id,
        unit: 'device',
        basePricePaise: rupees(7_500),
        unitCostPaise: rupees(3_000),
        taxBp: percent(18),
        description: 'Two extra years of hardware cover',
        billingType: 'ONE_TIME',
        stockTracked: false,
      },
      // ---- wider catalogue, so the demo is not a four-product shop -----------
      {
        sku: 'HW-MONITOR-27',
        name: '27" 4K Monitor',
        categoryId: hardware.id,
        unit: 'unit',
        basePricePaise: rupees(28_000),
        unitCostPaise: rupees(19_500),
        taxBp: percent(18),
        description: '27-inch 4K IPS display, USB-C docking, height adjustable',
        billingType: 'ONE_TIME',
        stockTracked: true,
      },
      {
        sku: 'HW-DOCK-TB4',
        name: 'Thunderbolt 4 Dock',
        categoryId: hardware.id,
        unit: 'unit',
        basePricePaise: rupees(18_000),
        unitCostPaise: rupees(12_600),
        taxBp: percent(18),
        description: '90W power delivery, dual 4K output, 2.5GbE',
        billingType: 'ONE_TIME',
        stockTracked: true,
      },
      {
        sku: 'NET-SW-24P',
        name: '24-Port Managed Switch',
        categoryId: networking.id,
        unit: 'unit',
        basePricePaise: rupees(45_000),
        unitCostPaise: rupees(31_000),
        taxBp: percent(18),
        description: 'Layer 3, 24×1GbE with 4 SFP+ uplinks, PoE+',
        billingType: 'ONE_TIME',
        stockTracked: true,
      },
      {
        sku: 'NET-AP-WIFI6',
        name: 'Wi-Fi 6 Access Point',
        categoryId: networking.id,
        unit: 'unit',
        basePricePaise: rupees(22_000),
        unitCostPaise: rupees(15_000),
        taxBp: percent(18),
        description: 'Ceiling-mount dual-band AP, PoE powered, mesh capable',
        billingType: 'ONE_TIME',
        stockTracked: true,
      },
      {
        sku: 'SW-OFFICE-SUITE',
        name: 'Office Productivity Suite',
        categoryId: software.id,
        unit: 'licence',
        basePricePaise: rupees(9_600),
        unitCostPaise: rupees(2_900),
        taxBp: percent(18),
        description: 'Annual per-user licence: documents, mail and storage',
        billingType: 'ONE_TIME',
        stockTracked: false,
      },
      {
        sku: 'SUB-ENDPOINT-SEC',
        name: 'Endpoint Security',
        categoryId: subscriptionsCategory.id,
        unit: 'seat/month',
        basePricePaise: rupees(1_200),
        unitCostPaise: rupees(400),
        taxBp: percent(18),
        description: 'Managed EDR with monthly reporting, per seat',
        billingType: 'RECURRING',
        stockTracked: false,
      },
      {
        sku: 'SUB-BACKUP-CLOUD',
        name: 'Cloud Backup',
        categoryId: subscriptionsCategory.id,
        unit: 'TB/month',
        basePricePaise: rupees(3_500),
        unitCostPaise: rupees(1_100),
        taxBp: percent(18),
        description: 'Off-site encrypted backup with 30-day retention, per TB',
        billingType: 'RECURRING',
        stockTracked: false,
      },
      {
        sku: 'TRN-ONBOARD-DAY',
        name: 'Onboarding Workshop',
        categoryId: training.id,
        unit: 'day',
        basePricePaise: rupees(35_000),
        unitCostPaise: rupees(16_000),
        taxBp: percent(18),
        description: 'One instructor-led day, up to 15 attendees, on-site',
        billingType: 'ONE_TIME',
        stockTracked: false,
      },
      {
        sku: 'SVC-INSTALL-NET',
        name: 'Network Installation',
        categoryId: services.id,
        unit: 'site',
        basePricePaise: rupees(55_000),
        unitCostPaise: rupees(30_000),
        taxBp: percent(18),
        description: 'Structured cabling, switch and AP commissioning per site',
        billingType: 'ONE_TIME',
        stockTracked: false,
      },
    ])
    .returning();
  if (!laptop || !setup || !support || !warranty) throw new Error('Product seed failed');
  const [monitor, dock, switch24, accessPoint, officeSuite, endpointSec, cloudBackup, workshop, netInstall] =
    extraProducts;
  if (
    !monitor || !dock || !switch24 || !accessPoint || !officeSuite ||
    !endpointSec || !cloudBackup || !workshop || !netInstall
  ) {
    throw new Error('Extended product seed failed');
  }

  // ---------------------------------------------------------------- price lists

  const [defaultList, goldList] = await exec
    .insert(priceLists)
    .values([
      { name: 'Standard INR', customerTierId: null, currency: 'INR', isDefault: true },
      { name: 'Gold INR', customerTierId: gold.id, currency: 'INR', isDefault: false },
    ])
    .returning();
  if (!defaultList || !goldList) throw new Error('Price list seed failed');

  /**
   * Gold sees a list price already below the standard one. Kept modest so the
   * *discount* remains the interesting variable in the demo rather than the list.
   */
  await exec.insert(priceListItems).values([
    { priceListId: goldList.id, productId: laptop.id, pricePaise: rupees(78_000) },
    { priceListId: goldList.id, productId: setup.id, pricePaise: rupees(10_000) },
    { priceListId: goldList.id, productId: support.id, pricePaise: rupees(5_000) },
    { priceListId: goldList.id, productId: warranty.id, pricePaise: rupees(7_000) },
  ]);

  // ------------------------------------------------- discount ceilings (rules)

  /**
   * Gold × Services at 10% is the rule that makes the canonical quote interesting:
   * the 18% ask on Setup Service breaches it by 8 points while the 12% ask on
   * Hardware stays inside its 15% ceiling.
   */
  await exec.insert(discountRules).values([
    { name: 'Gold — Hardware', customerTierId: gold.id, categoryId: hardware.id, maxDiscountBp: percent(15), priority: 100 },
    { name: 'Gold — Services', customerTierId: gold.id, categoryId: services.id, maxDiscountBp: percent(10), priority: 100 },
    { name: 'Gold — Subscriptions', customerTierId: gold.id, categoryId: subscriptionsCategory.id, maxDiscountBp: percent(15), priority: 100 },
    { name: 'Gold — Networking', customerTierId: gold.id, categoryId: networking.id, maxDiscountBp: percent(12), priority: 100 },
    { name: 'Gold — Software Licences', customerTierId: gold.id, categoryId: software.id, maxDiscountBp: percent(8), priority: 100 },
    { name: 'Gold — Training', customerTierId: gold.id, categoryId: training.id, maxDiscountBp: percent(20), priority: 100 },
    { name: 'Silver — Hardware', customerTierId: silver.id, categoryId: hardware.id, maxDiscountBp: percent(10), priority: 90 },
    { name: 'Silver — Services', customerTierId: silver.id, categoryId: services.id, maxDiscountBp: percent(8), priority: 90 },
    { name: 'Silver — Networking', customerTierId: silver.id, categoryId: networking.id, maxDiscountBp: percent(8), priority: 90 },
    { name: 'Bronze — any category', customerTierId: bronze.id, categoryId: null, maxDiscountBp: percent(5), priority: 50 },
    { name: 'Services — global backstop', customerTierId: null, categoryId: services.id, maxDiscountBp: percent(12), priority: 10 },
    { name: 'Software — global backstop', customerTierId: null, categoryId: software.id, maxDiscountBp: percent(10), priority: 10 },
    { name: 'Global backstop', customerTierId: null, categoryId: null, maxDiscountBp: percent(20), priority: 0 },
  ]);

  // ------------------------------------------------- approval routing bands

  /** Bands are contiguous and the top one is open-ended (`maxRiskBp: null`). */
  await exec.insert(approvalRules).values([
    { name: 'Within policy', minRiskBp: 0, maxRiskBp: 499, requiredLevel: 'NONE', priority: 30 },
    { name: 'Manager review', minRiskBp: 500, maxRiskBp: 2_499, requiredLevel: 'MANAGER', priority: 20 },
    { name: 'Manager + Finance review', minRiskBp: 2_500, maxRiskBp: null, requiredLevel: 'MANAGER_FINANCE', priority: 10 },
  ]);

  // ---------------------------------------------------------------- warehouses

  /**
   * Main is cheaper to ship from and has the higher allocation priority but holds
   * only 12 of the 20 laptops the canonical quote asks for, so the engine has a
   * real decision to make: 12 from Main, 8 from East, two dispatches.
   */
  const [main, east] = await exec
    .insert(warehouses)
    .values([
      {
        code: 'MAIN',
        name: 'Main Warehouse',
        location: 'Bhiwandi, Maharashtra',
        shippingWeightBp: 10_000,
        baseShipmentCostPaise: rupees(500),
        priority: 100,
        leadTimeDays: 2,
      },
      {
        code: 'EAST',
        name: 'East Depot',
        location: 'Howrah, West Bengal',
        shippingWeightBp: 13_000,
        baseShipmentCostPaise: rupees(500),
        priority: 50,
        leadTimeDays: 5,
      },
    ])
    .returning();
  if (!main || !east) throw new Error('Warehouse seed failed');

  await exec.insert(inventory).values([
    { warehouseId: main.id, productId: laptop.id, availableQuantity: 12, reorderPoint: 5, reorderQuantity: 25 },
    { warehouseId: east.id, productId: laptop.id, availableQuantity: 20, reorderPoint: 5, reorderQuantity: 25 },
    // Every stock-tracked product needs a row, or allocating it backorders the
    // whole line. Levels vary deliberately: healthy, at the reorder point, and
    // out of stock in one warehouse, so the inventory view has something to show.
    { warehouseId: main.id, productId: monitor.id, availableQuantity: 34, reorderPoint: 10, reorderQuantity: 40 },
    { warehouseId: east.id, productId: monitor.id, availableQuantity: 8, reorderPoint: 10, reorderQuantity: 40 },
    { warehouseId: main.id, productId: dock.id, availableQuantity: 26, reorderPoint: 8, reorderQuantity: 30 },
    { warehouseId: east.id, productId: dock.id, availableQuantity: 0, reorderPoint: 8, reorderQuantity: 30 },
    { warehouseId: main.id, productId: switch24.id, availableQuantity: 6, reorderPoint: 3, reorderQuantity: 10 },
    { warehouseId: east.id, productId: switch24.id, availableQuantity: 3, reorderPoint: 3, reorderQuantity: 10 },
    { warehouseId: main.id, productId: accessPoint.id, availableQuantity: 48, reorderPoint: 15, reorderQuantity: 60 },
    { warehouseId: east.id, productId: accessPoint.id, availableQuantity: 22, reorderPoint: 15, reorderQuantity: 60 },
  ]);

  // ------------------------------------------------- subscription plans

  const [premiumMonthly, securityMonthly, backupYearly] = await exec
    .insert(subscriptionPlans)
    .values([
      {
        name: 'Premium Monthly',
        interval: 'MONTHLY',
        prorationMode: 'DAILY_PRORATA',
        cancellationMode: 'END_OF_PERIOD',
        refundMode: 'PARTIAL_PRORATA',
        dayCountConvention: 'ACTUAL_DAYS',
        minTermIntervals: 0,
        description: 'Monthly billing, daily pro-rata on change, cancel at period end',
      },
      {
        name: 'Security Monthly (no proration)',
        interval: 'MONTHLY',
        prorationMode: 'NONE',
        cancellationMode: 'IMMEDIATE',
        refundMode: 'NONE',
        dayCountConvention: 'THIRTY_DAY_MONTH',
        minTermIntervals: 3,
        description: 'Seat changes take effect next period; cancel stops cover at once with no refund',
      },
      {
        name: 'Cloud Backup Yearly',
        interval: 'YEARLY',
        prorationMode: 'FULL_PERIOD',
        cancellationMode: 'END_OF_PERIOD',
        refundMode: 'FULL',
        dayCountConvention: 'ACTUAL_DAYS',
        minTermIntervals: 1,
        description: 'Billed yearly, an upgrade charges the full period, cancellation refunds in full',
      },
    ])
    .returning();
  if (!premiumMonthly || !securityMonthly || !backupYearly) throw new Error('Subscription plan seed failed');

  await exec.insert(subscriptionPlanProducts).values([
    { planId: premiumMonthly.id, productId: support.id, isDefault: true },
    { planId: securityMonthly.id, productId: endpointSec.id, isDefault: true },
    { planId: backupYearly.id, productId: cloudBackup.id, isDefault: true },
  ]);

  // ------------------------------------------------- recommendation inputs

  /** Co-purchase affinity: a laptop pulls setup, support and warranty behind it. */
  await exec.insert(productPairings).values([
    { productId: laptop.id, recommendedProductId: setup.id, weight: 90 },
    { productId: laptop.id, recommendedProductId: support.id, weight: 70 },
    { productId: laptop.id, recommendedProductId: warranty.id, weight: 60 },
    { productId: laptop.id, recommendedProductId: dock.id, weight: 85 },
    { productId: laptop.id, recommendedProductId: monitor.id, weight: 80 },
    { productId: laptop.id, recommendedProductId: officeSuite.id, weight: 75 },
    { productId: laptop.id, recommendedProductId: endpointSec.id, weight: 65 },
    { productId: setup.id, recommendedProductId: warranty.id, weight: 40 },
    { productId: support.id, recommendedProductId: warranty.id, weight: 20 },
    { productId: monitor.id, recommendedProductId: dock.id, weight: 70 },
    { productId: switch24.id, recommendedProductId: accessPoint.id, weight: 88 },
    { productId: switch24.id, recommendedProductId: netInstall.id, weight: 82 },
    { productId: accessPoint.id, recommendedProductId: netInstall.id, weight: 60 },
    { productId: officeSuite.id, recommendedProductId: workshop.id, weight: 55 },
    { productId: cloudBackup.id, recommendedProductId: endpointSec.id, weight: 45 },
  ]);

  await exec.insert(promotions).values([
    {
      label: 'Q3 attach offer — 5% off Extended Warranty',
      productId: warranty.id,
      priority: 10,
      startsAt: null,
      endsAt: null,
    },
    {
      label: 'Desk bundle — dock and monitor together',
      productId: dock.id,
      priority: 20,
      startsAt: null,
      endsAt: null,
    },
    {
      label: 'Network refresh — installation at 10% off with any switch',
      productId: netInstall.id,
      priority: 15,
      startsAt: null,
      endsAt: null,
    },
    {
      label: 'First year of Endpoint Security at launch pricing',
      productId: endpointSec.id,
      priority: 5,
      startsAt: null,
      endsAt: null,
    },
  ]);

  // ------------------------------------------------- engine settings

  /**
   * Written explicitly even where they match the code defaults, so the admin
   * settings screen shows the live calibration rather than an empty table.
   */
  await exec.insert(systemSettings).values([
    { key: 'riskWeights.severityWeightBp', value: '6000', valueType: 'int', group: 'risk', description: 'Weight of worst ceiling breach severity', updatedById: admin.id },
    { key: 'riskWeights.breadthWeightBp', value: '3000', valueType: 'int', group: 'risk', description: 'Weight of how many lines breach', updatedById: admin.id },
    { key: 'riskWeights.exposureWeightBp', value: '10000', valueType: 'int', group: 'risk', description: 'Weight of breaching value as a share of the quote', updatedById: admin.id },
    { key: 'riskWeights.orderWeightBp', value: '10000', valueType: 'int', group: 'risk', description: 'Weight of the order-level discount', updatedById: admin.id },
    { key: 'dealHealth.stalledAfterDays', value: '7', valueType: 'int', group: 'dealHealth', description: 'Days without commercial activity before a deal is STALLED', updatedById: admin.id },
    { key: 'dealHealth.anomalyVsHistoricalMultiplierBp', value: '15000', valueType: 'int', group: 'dealHealth', description: 'Discount vs rep average that counts as an anomaly (15000 = 1.5x)', updatedById: admin.id },
    { key: 'dealHealth.deliverySlippageDays', value: '2', valueType: 'int', group: 'dealHealth', description: 'Days a projected delivery may trail the promise before it slips', updatedById: admin.id },
    { key: 'billing.scheduleHorizon', value: '12', valueType: 'int', group: 'billing', description: 'Billing periods generated ahead per subscription', updatedById: admin.id },
  ]);

  // ---------------------------------------------------------------- canonical quote

  const repActor = { userId: rep.id, role: rep.role, label: rep.email };

  const canonical = await createQuotation(exec, {
    customerId: acme.id,
    salesRepId: rep.id,
    notes: 'Acme Corp fleet refresh — 20 laptops with setup and support.',
    promisedDeliveryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  });

  // Within the Hardware ceiling (12% vs 15%).
  await addLine(exec, canonical.id, { productId: laptop.id, quantity: 20, discountBp: percent(12) }, repActor);
  // Breaches the Services ceiling by 8 points (18% vs 10%) — this is what flags the quote.
  await addLine(exec, canonical.id, { productId: setup.id, quantity: 5, discountBp: percent(18) }, repActor);
  // Recurring line, billed separately from the one-time lines.
  const afterSupport = await addLine(exec, canonical.id, { productId: support.id, quantity: 20 }, repActor);

  /** A second, clean quote so the pipeline view is not a single row. */
  const clean = await createQuotation(exec, {
    customerId: northwind.id,
    salesRepId: rep.id,
    notes: 'Northwind pilot — 3 laptops, no exception required.',
  });
  await addLine(exec, clean.id, { productId: laptop.id, quantity: 3, discountBp: percent(8) }, repActor);

  /**
   * A third quote already in the customer's hands.
   *
   * Without this the portal opens on a DRAFT quotation and the buyer has nothing
   * to accept or negotiate, which reads as a missing feature rather than as a
   * quote that was never sent. Discounts are kept inside the Gold ceilings so it
   * reaches SENT without needing a reviewer during the seed.
   */
  const sent = await createQuotation(exec, {
    customerId: acme.id,
    salesRepId: rep.id,
    notes: 'Acme Corp — 6 laptops with setup, ready for your approval.',
    promisedDeliveryDate: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
  });
  await addLine(exec, sent.id, { productId: laptop.id, quantity: 6, discountBp: percent(10) }, repActor);
  await addLine(exec, sent.id, { productId: setup.id, quantity: 2, discountBp: percent(8) }, repActor);
  await confirmQuotation(exec, sent.id, repActor);
  await sendQuotation(exec, sent.id, repActor);

  return {
    users: { admin, rep, manager, finance, buyer },
    customers: { acme, northwind },
    tiers: { bronze, silver, gold },
    products: {
      laptop, setup, support, warranty,
      monitor, dock, switch24, accessPoint, officeSuite, endpointSec, cloudBackup, workshop, netInstall,
    },
    warehouses: { main, east },
    plans: { premiumMonthly, securityMonthly, backupYearly },
    categories: { hardware, services, subscriptionsCategory, networking, software, training },
    priceLists: { defaultList, goldList },
    quotations: { canonical, clean, sent },
    canonicalRisk: {
      riskScoreBp: afterSupport.risk.totalBp,
      requiredLevel: afterSupport.requiredLevel,
      grandTotalPaise: afterSupport.totals.grandTotalPaise,
    },
    password: DEMO_PASSWORD,
  };
}

const isEntrypoint = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');

if (isEntrypoint) {
  db.transaction((tx) => seed(tx))
    .then(async (result) => {
      logger.info('Seed complete', {
        quote: result.quotations.canonical.quoteNumber,
        riskScoreBp: result.canonicalRisk.riskScoreBp,
        requiredApproval: result.canonicalRisk.requiredLevel,
        grandTotalRupees: result.canonicalRisk.grandTotalPaise / RUPEE,
        login: `${result.users.rep.email} / ${result.password}`,
      });
      await closeDatabase();
      process.exit(0);
    })
    .catch(async (error: unknown) => {
      logger.error('Seed failed', error);
      await closeDatabase().catch(() => undefined);
      process.exit(1);
    });
}