/**
 * Seed data for the canonical demo described in docs/SEED_DATA.md.
 *
 * Idempotent: every write is an upsert keyed on a natural unique column, so
 * `npm run db:seed` can be re-run safely. To start from an empty database use
 * `npm run db:reset` (destructive - drops and recreates the schema).
 *
 * Figures come straight from docs/SEED_DATA.md so the documented canonical
 * quotation arithmetic stays reproducible.
 */
import { env } from '../src/config/env';
import { prisma, disconnectPrisma } from '../src/db/prisma';
import { hashPassword } from '../src/modules/auth/password';

/**
 * Development-only password shared by every seeded account. Documented in the
 * README. Override with SEED_PASSWORD when seeding a shared environment.
 */
const SEED_PASSWORD = process.env['SEED_PASSWORD'] ?? 'DealFlow!2026';

async function main(): Promise<void> {
  if (env.isProduction) {
    throw new Error('Refusing to seed demo data with NODE_ENV=production.');
  }

  // -------------------------------------------------------------------------
  // Customer tiers - docs/SEED_DATA.md "Customer tiers"
  // -------------------------------------------------------------------------
  const tierSpecs = [
    { code: 'BRONZE', name: 'Bronze', ceiling: '5.000' },
    { code: 'SILVER', name: 'Silver', ceiling: '10.000' },
    { code: 'GOLD', name: 'Gold', ceiling: '15.000' },
  ] as const;

  const tiers = new Map<string, string>();
  for (const spec of tierSpecs) {
    const tier = await prisma.customerTier.upsert({
      where: { code: spec.code },
      update: { name: spec.name, defaultDiscountCeiling: spec.ceiling, active: true },
      create: {
        code: spec.code,
        name: spec.name,
        defaultDiscountCeiling: spec.ceiling,
      },
    });
    tiers.set(spec.code, tier.id);
  }

  // -------------------------------------------------------------------------
  // Categories - docs/SEED_DATA.md "Categories"
  // -------------------------------------------------------------------------
  const categorySpecs = [
    { code: 'HARDWARE', name: 'Hardware', margin: '25.000' },
    { code: 'SERVICES', name: 'Services', margin: '60.000' },
    { code: 'SUBSCRIPTIONS', name: 'Subscriptions', margin: '70.000' },
  ] as const;

  const categories = new Map<string, string>();
  for (const spec of categorySpecs) {
    const category = await prisma.category.upsert({
      where: { code: spec.code },
      update: { name: spec.name, defaultMarginPercent: spec.margin, active: true },
      create: { code: spec.code, name: spec.name, defaultMarginPercent: spec.margin },
    });
    categories.set(spec.code, category.id);
  }

  // -------------------------------------------------------------------------
  // Subscription plan - docs/SEED_DATA.md "Premium Monthly"
  // -------------------------------------------------------------------------
  const premiumMonthly = await prisma.subscriptionPlan.upsert({
    where: { code: 'PREMIUM_MONTHLY' },
    update: {
      name: 'Premium Monthly',
      interval: 'MONTHLY',
      prorationRule: 'DAILY_PRORATION',
      cancellationRule: 'END_OF_PERIOD',
      refundRule: 'PARTIAL_PRORATED',
      active: true,
    },
    create: {
      code: 'PREMIUM_MONTHLY',
      name: 'Premium Monthly',
      interval: 'MONTHLY',
      prorationRule: 'DAILY_PRORATION',
      cancellationRule: 'END_OF_PERIOD',
      refundRule: 'PARTIAL_PRORATED',
    },
  });

  // -------------------------------------------------------------------------
  // Products - docs/SEED_DATA.md "Products"
  //
  // cost_price is an Implementation Decision (see schema.prisma): margin is
  // undefined without it. Values are chosen to match the indicative category
  // margins above so demo margin figures look plausible.
  // -------------------------------------------------------------------------
  const productSpecs = [
    {
      sku: 'HW-LAPTOP-ENT',
      name: 'Enterprise Laptop',
      category: 'HARDWARE',
      productType: 'ONE_TIME',
      unit: 'unit',
      basePrice: '80000.00',
      costPrice: '60000.00',
      taxPercent: '18.000',
      description: '14" enterprise-class laptop, 3-year on-site coverage.',
      planId: null,
    },
    {
      sku: 'SV-SETUP',
      name: 'Setup Service',
      category: 'SERVICES',
      productType: 'ONE_TIME',
      unit: 'engagement',
      basePrice: '10000.00',
      costPrice: '4000.00',
      taxPercent: '18.000',
      description: 'On-site imaging, provisioning and handover per device batch.',
      planId: null,
    },
    {
      sku: 'SB-SUPPORT-PREM',
      name: 'Premium Support',
      category: 'SUBSCRIPTIONS',
      productType: 'RECURRING',
      unit: 'seat/month',
      basePrice: '5000.00',
      costPrice: '1500.00',
      taxPercent: '18.000',
      description: '24x7 priority support with a 4-hour response target.',
      planId: premiumMonthly.id,
    },
    {
      sku: 'SV-WARRANTY-EXT',
      name: 'Extended Warranty',
      category: 'SERVICES',
      productType: 'ONE_TIME',
      unit: 'unit',
      basePrice: '7500.00',
      costPrice: '2250.00',
      taxPercent: '18.000',
      description: 'Two additional years of hardware replacement cover.',
      planId: null,
    },
  ] as const;

  const products = new Map<string, string>();
  for (const spec of productSpecs) {
    const categoryId = categories.get(spec.category);
    if (!categoryId) throw new Error(`Unknown category ${spec.category}`);

    const product = await prisma.product.upsert({
      where: { sku: spec.sku },
      update: {
        name: spec.name,
        categoryId,
        productType: spec.productType,
        unit: spec.unit,
        basePrice: spec.basePrice,
        costPrice: spec.costPrice,
        taxPercent: spec.taxPercent,
        description: spec.description,
        subscriptionPlanId: spec.planId,
        active: true,
      },
      create: {
        sku: spec.sku,
        name: spec.name,
        categoryId,
        productType: spec.productType,
        unit: spec.unit,
        basePrice: spec.basePrice,
        costPrice: spec.costPrice,
        taxPercent: spec.taxPercent,
        description: spec.description,
        subscriptionPlanId: spec.planId,
      },
    });
    products.set(spec.sku, product.id);
  }

  // A variant so the variant path is exercised rather than merely existing.
  await prisma.productVariant.upsert({
    where: {
      productId_attribute_value: {
        productId: products.get('HW-LAPTOP-ENT')!,
        attribute: 'Memory',
        value: '32 GB',
      },
    },
    update: { extraPrice: '9000.00', active: true },
    create: {
      productId: products.get('HW-LAPTOP-ENT')!,
      attribute: 'Memory',
      value: '32 GB',
      extraPrice: '9000.00',
    },
  });

  // -------------------------------------------------------------------------
  // Price lists
  //
  // The Gold list is populated at base price. That exercises the price-list
  // lookup path without altering the documented canonical quotation figures;
  // Bronze and Silver stay empty so the fallback-to-base_price path is
  // exercised too.
  // -------------------------------------------------------------------------
  for (const spec of tierSpecs) {
    const priceList = await prisma.priceList.upsert({
      where: { code: `PL-${spec.code}-INR` },
      update: { name: `${spec.name} price list (INR)`, customerTierId: tiers.get(spec.code)!, active: true },
      create: {
        code: `PL-${spec.code}-INR`,
        name: `${spec.name} price list (INR)`,
        customerTierId: tiers.get(spec.code)!,
        currency: 'INR',
      },
    });

    if (spec.code !== 'GOLD') continue;

    for (const product of productSpecs) {
      await prisma.priceListItem.upsert({
        where: {
          priceListId_productId: {
            priceListId: priceList.id,
            productId: products.get(product.sku)!,
          },
        },
        update: { price: product.basePrice },
        create: {
          priceListId: priceList.id,
          productId: products.get(product.sku)!,
          price: product.basePrice,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Customer - docs/SEED_DATA.md "Acme Corp", Gold tier
  // -------------------------------------------------------------------------
  const acme = await prisma.customer.upsert({
    where: { code: 'ACME' },
    update: { name: 'Acme Corp', tierId: tiers.get('GOLD')!, active: true },
    create: {
      code: 'ACME',
      name: 'Acme Corp',
      tierId: tiers.get('GOLD')!,
      contactName: 'Priya Raman',
      contactEmail: 'buyer@acme.local',
      contactPhone: '+91 80 4000 1200',
      billingAddress: 'Acme Corp, 4th Floor, Prestige Tech Park, Bengaluru 560103',
    },
  });

  // A second customer exists purely so portal-isolation tests have a genuine
  // "other customer" to be denied access to (docs/ACCEPTANCE_TESTS.md AT-02).
  const globex = await prisma.customer.upsert({
    where: { code: 'GLOBEX' },
    update: { name: 'Globex Industries', tierId: tiers.get('SILVER')!, active: true },
    create: {
      code: 'GLOBEX',
      name: 'Globex Industries',
      tierId: tiers.get('SILVER')!,
      contactName: 'Daniel Okafor',
      contactEmail: 'buyer@globex.local',
      billingAddress: 'Globex Industries, Plot 22, MIDC Andheri, Mumbai 400093',
    },
  });

  // -------------------------------------------------------------------------
  // Users - docs/SEED_DATA.md "Users"
  //
  // Hash once and reuse: scrypt is deliberately slow, and every seeded account
  // shares the same development password.
  // -------------------------------------------------------------------------
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const userSpecs = [
    { email: 'admin@dealflow.local', name: 'Aarti Deshpande', role: 'ADMIN', customerId: null },
    { email: 'rep@dealflow.local', name: 'Rohit Sharma', role: 'SALES_REP', customerId: null },
    { email: 'manager@dealflow.local', name: 'Meera Nair', role: 'SALES_MANAGER', customerId: null },
    { email: 'finance@dealflow.local', name: 'Farhan Qureshi', role: 'FINANCE_OPERATIONS', customerId: null },
    { email: 'buyer@acme.local', name: 'Priya Raman', role: 'CUSTOMER', customerId: acme.id },
    { email: 'buyer@globex.local', name: 'Daniel Okafor', role: 'CUSTOMER', customerId: globex.id },
  ] as const;

  for (const spec of userSpecs) {
    await prisma.user.upsert({
      where: { email: spec.email },
      // Password is only set on create so a locally changed password survives
      // re-seeding.
      update: { name: spec.name, role: spec.role, customerId: spec.customerId, active: true },
      create: {
        email: spec.email,
        name: spec.name,
        role: spec.role,
        customerId: spec.customerId,
        passwordHash,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Discount rules - docs/SEED_DATA.md "Category discount ceilings"
  //
  // One tier-wide fallback per tier, plus the documented Gold category
  // ceilings. Category rules are more specific and therefore win
  // (docs/BUSINESS_RULES.md 1) - priority only breaks ties at equal
  // specificity.
  // -------------------------------------------------------------------------
  const discountRuleSpecs = [
    { tier: 'BRONZE', category: null, max: '5.000', priority: 0 },
    { tier: 'SILVER', category: null, max: '10.000', priority: 0 },
    { tier: 'GOLD', category: null, max: '15.000', priority: 0 },
    { tier: 'GOLD', category: 'HARDWARE', max: '15.000', priority: 10 },
    { tier: 'GOLD', category: 'SERVICES', max: '10.000', priority: 10 },
    { tier: 'GOLD', category: 'SUBSCRIPTIONS', max: '15.000', priority: 10 },
  ] as const;

  for (const spec of discountRuleSpecs) {
    const customerTierId = tiers.get(spec.tier)!;
    const categoryId = spec.category ? categories.get(spec.category)! : null;

    // A composite unique on (tier, category) cannot be used for the tier-wide
    // rows because Postgres treats NULLs as distinct, so those are matched by
    // hand against the partial unique index declared in the init migration.
    const existing = categoryId
      ? await prisma.discountRule.findFirst({ where: { customerTierId, categoryId } })
      : await prisma.discountRule.findFirst({ where: { customerTierId, categoryId: null } });

    if (existing) {
      await prisma.discountRule.update({
        where: { id: existing.id },
        data: { maximumDiscount: spec.max, priority: spec.priority, active: true },
      });
    } else {
      await prisma.discountRule.create({
        data: { customerTierId, categoryId, maximumDiscount: spec.max, priority: spec.priority },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Approval rules - docs/BUSINESS_RULES.md 4
  //
  // Bands are half-open [minimumRisk, maximumRisk); a NULL maximum is
  // unbounded, so the three rows tile 0..infinity with no gap or overlap.
  //
  // The scale is the blended risk score defined in AGENTS.md "Blended risk
  // model": dominated by the worst single line violation in percentage points,
  // plus a revenue-weighted term so several small violations can also cross a
  // threshold. Reference points:
  //   - canonical quote (Setup Service 18% against a 10% ceiling) scores ~8.2
  //     and must route to the Sales Manager (AT-04);
  //   - a customer countering to 30% on that line scores ~20 and must add
  //     Finance (AT-13).
  // -------------------------------------------------------------------------
  const approvalRuleSpecs = [
    { name: 'No approval required', min: '0.0000', max: '4.0000', level: 'NONE', priority: 0 },
    { name: 'Sales Manager approval', min: '4.0000', max: '15.0000', level: 'MANAGER', priority: 10 },
    { name: 'Sales Manager then Finance approval', min: '15.0000', max: null, level: 'MANAGER_FINANCE', priority: 20 },
  ] as const;

  for (const spec of approvalRuleSpecs) {
    await prisma.approvalRule.upsert({
      where: { name: spec.name },
      update: {
        minimumRisk: spec.min,
        maximumRisk: spec.max,
        requiredLevel: spec.level,
        priority: spec.priority,
        active: true,
      },
      create: {
        name: spec.name,
        minimumRisk: spec.min,
        maximumRisk: spec.max,
        requiredLevel: spec.level,
        priority: spec.priority,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Warehouses and stock - docs/SEED_DATA.md "Warehouses"
  //
  // Main is the cheaper origin, so the recommended split for a demand of 20
  // laptops is Main 12 + East 8 - exactly the documented expectation. The
  // weights differ so the optimisation has a real decision to make.
  // -------------------------------------------------------------------------
  const warehouseSpecs = [
    { code: 'MAIN', name: 'Main Warehouse', shippingWeight: '1.0000', laptopStock: 12, reorderPoint: 5 },
    { code: 'EAST', name: 'East Depot', shippingWeight: '1.6000', laptopStock: 20, reorderPoint: 8 },
  ] as const;

  for (const spec of warehouseSpecs) {
    const warehouse = await prisma.warehouse.upsert({
      where: { code: spec.code },
      update: { name: spec.name, shippingWeight: spec.shippingWeight, active: true },
      create: { code: spec.code, name: spec.name, shippingWeight: spec.shippingWeight },
    });

    await prisma.inventory.upsert({
      where: {
        warehouseId_productId: {
          warehouseId: warehouse.id,
          productId: products.get('HW-LAPTOP-ENT')!,
        },
      },
      update: { availableQuantity: spec.laptopStock, reorderPoint: spec.reorderPoint },
      create: {
        warehouseId: warehouse.id,
        productId: products.get('HW-LAPTOP-ENT')!,
        availableQuantity: spec.laptopStock,
        reorderPoint: spec.reorderPoint,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Recommendations - docs/ACCEPTANCE_TESTS.md AT-08
  // -------------------------------------------------------------------------
  const pairingSpecs = [
    { from: 'HW-LAPTOP-ENT', to: 'SV-WARRANTY-EXT', weight: '0.9000' },
    { from: 'HW-LAPTOP-ENT', to: 'SV-SETUP', weight: '0.7000' },
    { from: 'HW-LAPTOP-ENT', to: 'SB-SUPPORT-PREM', weight: '0.6000' },
    { from: 'SV-SETUP', to: 'SB-SUPPORT-PREM', weight: '0.5000' },
  ] as const;

  for (const spec of pairingSpecs) {
    await prisma.productPairing.upsert({
      where: {
        productId_recommendedProductId: {
          productId: products.get(spec.from)!,
          recommendedProductId: products.get(spec.to)!,
        },
      },
      update: { weight: spec.weight, active: true },
      create: {
        productId: products.get(spec.from)!,
        recommendedProductId: products.get(spec.to)!,
        weight: spec.weight,
      },
    });
  }

  await prisma.promotion.upsert({
    where: { code: 'WARRANTY-BUNDLE' },
    update: {
      name: 'Warranty bundle',
      productId: products.get('SV-WARRANTY-EXT')!,
      active: true,
      priority: 10,
    },
    create: {
      code: 'WARRANTY-BUNDLE',
      name: 'Warranty bundle',
      productId: products.get('SV-WARRANTY-EXT')!,
      priority: 10,
    },
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const counts = {
    customerTiers: await prisma.customerTier.count(),
    categories: await prisma.category.count(),
    products: await prisma.product.count(),
    productVariants: await prisma.productVariant.count(),
    priceLists: await prisma.priceList.count(),
    priceListItems: await prisma.priceListItem.count(),
    customers: await prisma.customer.count(),
    users: await prisma.user.count(),
    discountRules: await prisma.discountRule.count(),
    approvalRules: await prisma.approvalRule.count(),
    subscriptionPlans: await prisma.subscriptionPlan.count(),
    warehouses: await prisma.warehouse.count(),
    inventory: await prisma.inventory.count(),
    productPairings: await prisma.productPairing.count(),
    promotions: await prisma.promotion.count(),
  };

  const width = Math.max(...Object.keys(counts).map((key) => key.length));
  console.log('DealFlow360 seed complete\n');
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key.padEnd(width)}  ${value}`);
  }
  console.log(`\n  every seeded account uses the password: ${SEED_PASSWORD}`);
}

try {
  await main();
} catch (error) {
  console.error('Seed failed:', error);
  process.exitCode = 1;
} finally {
  await disconnectPrisma();
}
