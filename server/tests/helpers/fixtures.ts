import { Role } from '../../src/generated/prisma/enums';
import { prisma } from '../../src/db/prisma';
import { hashPassword } from '../../src/modules/auth/password';

export const TEST_PASSWORD = 'TestPassw0rd!2026';

/**
 * scrypt is intentionally slow, so the fixture password is hashed once per
 * worker and reused. Without this, seeding six users per test dominates runtime.
 */
let passwordHashPromise: Promise<string> | null = null;
function testPasswordHash(): Promise<string> {
  passwordHashPromise ??= hashPassword(TEST_PASSWORD);
  return passwordHashPromise;
}

export interface Baseline {
  tierGoldId: string;
  tierSilverId: string;
  acmeId: string;
  globexId: string;
  users: {
    admin: { id: string; email: string };
    rep: { id: string; email: string };
    manager: { id: string; email: string };
    finance: { id: string; email: string };
    acmeBuyer: { id: string; email: string };
    globexBuyer: { id: string; email: string };
    inactiveRep: { id: string; email: string };
  };
}

/**
 * Minimal fixture set for authentication, RBAC and portal-isolation tests: one
 * user per role, two customers so isolation has a genuine "other party", and a
 * deactivated account.
 *
 * Deliberately not the demo seed - tests should not break when demo data is
 * tuned for a presentation.
 */
export async function seedBaseline(): Promise<Baseline> {
  const passwordHash = await testPasswordHash();

  const [gold, silver] = await Promise.all([
    prisma.customerTier.create({
      data: { code: 'GOLD', name: 'Gold', defaultDiscountCeiling: '15.000' },
    }),
    prisma.customerTier.create({
      data: { code: 'SILVER', name: 'Silver', defaultDiscountCeiling: '10.000' },
    }),
  ]);

  const [acme, globex] = await Promise.all([
    prisma.customer.create({ data: { code: 'ACME', name: 'Acme Corp', tierId: gold.id } }),
    prisma.customer.create({
      data: { code: 'GLOBEX', name: 'Globex Industries', tierId: silver.id },
    }),
  ]);

  const create = (
    email: string,
    name: string,
    role: Role,
    customerId: string | null = null,
    active = true,
  ) =>
    prisma.user.create({
      data: { email, name, role, customerId, passwordHash, active },
      select: { id: true, email: true },
    });

  const [admin, rep, manager, finance, acmeBuyer, globexBuyer, inactiveRep] = await Promise.all([
    create('admin@test.local', 'Test Admin', Role.ADMIN),
    create('rep@test.local', 'Test Rep', Role.SALES_REP),
    create('manager@test.local', 'Test Manager', Role.SALES_MANAGER),
    create('finance@test.local', 'Test Finance', Role.FINANCE_OPERATIONS),
    create('buyer@acme.test.local', 'Acme Buyer', Role.CUSTOMER, acme.id),
    create('buyer@globex.test.local', 'Globex Buyer', Role.CUSTOMER, globex.id),
    create('inactive@test.local', 'Inactive Rep', Role.SALES_REP, null, false),
  ]);

  return {
    tierGoldId: gold.id,
    tierSilverId: silver.id,
    acmeId: acme.id,
    globexId: globex.id,
    users: { admin, rep, manager, finance, acmeBuyer, globexBuyer, inactiveRep },
  };
}

export interface MasterData {
  categoryHardwareId: string;
  categoryServicesId: string;
  categorySubscriptionsId: string;
  planMonthlyId: string;
  productLaptopId: string;
  productSetupId: string;
  productSupportId: string;
  productWarrantyId: string;
  priceListGoldId: string;
  warehouseMainId: string;
  warehouseEastId: string;
  /** Tier-wide rule on Gold, ceiling 15%. */
  discountRuleGoldTierWideId: string;
  /** Category rule on Gold + Services, ceiling 10% - the stricter one from AT-04. */
  discountRuleGoldServicesId: string;
}

/**
 * Catalogue, pricing and stock built on top of `seedBaseline`.
 *
 * Mirrors the shape of docs/SEED_DATA.md - and specifically the Gold-customer,
 * 15%-hardware, 10%-services arrangement the acceptance tests reason about - so
 * that ceiling-resolution and margin assertions here mean the same thing as in
 * the demo. Figures are kept identical to the demo seed for the same reason.
 */
export async function seedMasterData(baseline: Baseline): Promise<MasterData> {
  const [hardware, services, subscriptions] = await Promise.all([
    prisma.category.create({
      data: { code: 'HARDWARE', name: 'Hardware', defaultMarginPercent: '25.000' },
    }),
    prisma.category.create({
      data: { code: 'SERVICES', name: 'Services', defaultMarginPercent: '60.000' },
    }),
    prisma.category.create({
      data: { code: 'SUBSCRIPTIONS', name: 'Subscriptions', defaultMarginPercent: '70.000' },
    }),
  ]);

  const plan = await prisma.subscriptionPlan.create({
    data: {
      code: 'PREMIUM_MONTHLY',
      name: 'Premium Monthly',
      interval: 'MONTHLY',
      prorationRule: 'DAILY_PRORATION',
      cancellationRule: 'END_OF_PERIOD',
      refundRule: 'PARTIAL_PRORATED',
    },
  });

  const [laptop, setup, support, warranty] = await Promise.all([
    prisma.product.create({
      data: {
        sku: 'HW-LAPTOP-ENT',
        name: 'Enterprise Laptop',
        categoryId: hardware.id,
        productType: 'ONE_TIME',
        unit: 'unit',
        basePrice: '80000.00',
        costPrice: '60000.00',
        taxPercent: '18.000',
      },
    }),
    prisma.product.create({
      data: {
        sku: 'SV-SETUP',
        name: 'Setup Service',
        categoryId: services.id,
        productType: 'ONE_TIME',
        unit: 'engagement',
        basePrice: '10000.00',
        costPrice: '4000.00',
        taxPercent: '18.000',
      },
    }),
    prisma.product.create({
      data: {
        sku: 'SB-SUPPORT-PREM',
        name: 'Premium Support',
        categoryId: subscriptions.id,
        productType: 'RECURRING',
        unit: 'seat/month',
        basePrice: '5000.00',
        costPrice: '1500.00',
        taxPercent: '18.000',
        subscriptionPlanId: plan.id,
      },
    }),
    prisma.product.create({
      data: {
        sku: 'SV-WARRANTY-EXT',
        name: 'Extended Warranty',
        categoryId: services.id,
        productType: 'ONE_TIME',
        unit: 'unit',
        basePrice: '7500.00',
        costPrice: '2250.00',
        taxPercent: '18.000',
      },
    }),
  ]);

  const priceListGold = await prisma.priceList.create({
    data: {
      code: 'PL-GOLD-INR',
      name: 'Gold price list (INR)',
      customerTierId: baseline.tierGoldId,
      currency: 'INR',
      items: {
        create: [
          { productId: laptop.id, price: '80000.00' },
          { productId: setup.id, price: '10000.00' },
        ],
      },
    },
  });

  // Main is cheaper to ship from, so a demand of 20 laptops should recommend
  // Main 12 + East 8 once the fulfillment slice lands.
  const [main, east] = await Promise.all([
    prisma.warehouse.create({
      data: {
        code: 'MAIN',
        name: 'Main Warehouse',
        shippingWeight: '1.0000',
        inventory: { create: [{ productId: laptop.id, availableQuantity: 12, reorderPoint: 5 }] },
      },
    }),
    prisma.warehouse.create({
      data: {
        code: 'EAST',
        name: 'East Depot',
        shippingWeight: '1.6000',
        inventory: { create: [{ productId: laptop.id, availableQuantity: 20, reorderPoint: 8 }] },
      },
    }),
  ]);

  const [tierWide, servicesRule] = await Promise.all([
    prisma.discountRule.create({
      data: {
        customerTierId: baseline.tierGoldId,
        categoryId: null,
        maximumDiscount: '15.000',
        priority: 0,
      },
    }),
    prisma.discountRule.create({
      data: {
        customerTierId: baseline.tierGoldId,
        categoryId: services.id,
        maximumDiscount: '10.000',
        priority: 10,
      },
    }),
  ]);

  return {
    categoryHardwareId: hardware.id,
    categoryServicesId: services.id,
    categorySubscriptionsId: subscriptions.id,
    planMonthlyId: plan.id,
    productLaptopId: laptop.id,
    productSetupId: setup.id,
    productSupportId: support.id,
    productWarrantyId: warranty.id,
    priceListGoldId: priceListGold.id,
    warehouseMainId: main.id,
    warehouseEastId: east.id,
    discountRuleGoldTierWideId: tierWide.id,
    discountRuleGoldServicesId: servicesRule.id,
  };
}

/**
 * The three approval bands from AGENTS.md, tiling 0 to infinity with no gap.
 * Seeded only where a test needs routing configuration to be valid.
 */
export async function seedApprovalBands(): Promise<void> {
  await prisma.approvalRule.createMany({
    data: [
      {
        name: 'No approval required',
        minimumRisk: '0.0000',
        maximumRisk: '4.0000',
        requiredLevel: 'NONE',
        priority: 0,
      },
      {
        name: 'Sales Manager approval',
        minimumRisk: '4.0000',
        maximumRisk: '15.0000',
        requiredLevel: 'MANAGER',
        priority: 10,
      },
      {
        name: 'Sales Manager then Finance approval',
        minimumRisk: '15.0000',
        maximumRisk: null,
        requiredLevel: 'MANAGER_FINANCE',
        priority: 20,
      },
    ],
  });
}
