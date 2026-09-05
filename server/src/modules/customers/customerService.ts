import { prisma } from '../../db/prisma';
import { ConflictError, NotFoundError } from '../../http/errors';
import { PERCENT_SCALE, toDecimalString } from '../../http/fields';
import {
  activeFilter,
  pageArgs,
  paginated,
  searchFilter,
  type ListQuery,
  type Paginated,
} from '../../http/pagination';
import type { AuthContext } from '../../http/types';
import { AuditEntity } from '../audit/auditService';
import { diffFields, recordConfigChange } from '../audit/configAudit';

// ---------------------------------------------------------------------------
// Customer tiers
// ---------------------------------------------------------------------------

const tierSelect = {
  id: true,
  code: true,
  name: true,
  defaultDiscountCeiling: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { customers: true, discountRules: true } },
} as const;

export interface CustomerTierView {
  id: string;
  code: string;
  name: string;
  /** Percent, 0-100. Serialised as a string so the exact decimal survives JSON. */
  defaultDiscountCeiling: string;
  active: boolean;
  customerCount: number;
  discountRuleCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type TierRow = {
  id: string;
  code: string;
  name: string;
  defaultDiscountCeiling: { toString: () => string };
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { customers: number; discountRules: number };
};

function toTierView(row: TierRow): CustomerTierView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    defaultDiscountCeiling: row.defaultDiscountCeiling.toString(),
    active: row.active,
    customerCount: row._count.customers,
    discountRuleCount: row._count.discountRules,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listCustomerTiers(query: ListQuery): Promise<Paginated<CustomerTierView>> {
  const where = { ...searchFilter(query, ['code', 'name']), ...activeFilter(query) };

  const [rows, total] = await prisma.$transaction([
    prisma.customerTier.findMany({
      where,
      select: tierSelect,
      orderBy: { defaultDiscountCeiling: 'asc' },
      ...pageArgs(query),
    }),
    prisma.customerTier.count({ where }),
  ]);

  return paginated(rows.map(toTierView), total, query);
}

export interface CreateCustomerTierInput {
  code: string;
  name: string;
  defaultDiscountCeiling: number;
}

export async function createCustomerTier(
  actor: AuthContext,
  input: CreateCustomerTierInput,
): Promise<CustomerTierView> {
  await assertTierCodeFree(input.code);
  await assertTierNameFree(input.name);

  return prisma.$transaction(async (tx) => {
    const created = await tx.customerTier.create({
      data: {
        code: input.code,
        name: input.name,
        defaultDiscountCeiling: toDecimalString(input.defaultDiscountCeiling, PERCENT_SCALE),
      },
      select: tierSelect,
    });

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.CUSTOMER_TIER,
      entityId: created.id,
      after: {
        code: created.code,
        name: created.name,
        defaultDiscountCeiling: created.defaultDiscountCeiling.toString(),
      },
    });

    return toTierView(created);
  });
}

export interface UpdateCustomerTierInput {
  name?: string | undefined;
  defaultDiscountCeiling?: number | undefined;
  active?: boolean | undefined;
}

export async function updateCustomerTier(
  actor: AuthContext,
  id: string,
  input: UpdateCustomerTierInput,
): Promise<CustomerTierView> {
  const existing = await prisma.customerTier.findUnique({ where: { id }, select: tierSelect });
  if (!existing) throw new NotFoundError('Customer tier not found');

  if (input.name !== undefined && input.name !== existing.name) {
    await assertTierNameFree(input.name);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.customerTier.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.defaultDiscountCeiling === undefined
          ? {}
          : {
              defaultDiscountCeiling: toDecimalString(input.defaultDiscountCeiling, PERCENT_SCALE),
            }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
      select: tierSelect,
    });

    const change = diffFields(toTierView(existing), toTierView(updated), [
      'updatedAt',
      'customerCount',
      'discountRuleCount',
    ]);

    if (change) {
      await recordConfigChange(tx, {
        actor,
        entityType: AuditEntity.CUSTOMER_TIER,
        entityId: id,
        before: change.before,
        after: change.after,
      });
    }

    return toTierView(updated);
  });
}

async function assertTierCodeFree(code: string): Promise<void> {
  const clash = await prisma.customerTier.findUnique({ where: { code }, select: { id: true } });
  if (clash) throw new ConflictError(`A customer tier with code ${code} already exists`);
}

async function assertTierNameFree(name: string): Promise<void> {
  const clash = await prisma.customerTier.findUnique({ where: { name }, select: { id: true } });
  if (clash) throw new ConflictError(`A customer tier named ${name} already exists`);
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

const customerSelect = {
  id: true,
  code: true,
  name: true,
  tierId: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  billingAddress: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  tier: { select: { id: true, code: true, name: true, defaultDiscountCeiling: true } },
  _count: { select: { users: true, quotations: true } },
} as const;

export interface CustomerView {
  id: string;
  code: string;
  name: string;
  tierId: string;
  tierCode: string;
  tierName: string;
  /** The tier's fallback discount ceiling, percent 0-100. */
  tierDiscountCeiling: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  billingAddress: string | null;
  active: boolean;
  portalUserCount: number;
  quotationCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type CustomerRow = {
  id: string;
  code: string;
  name: string;
  tierId: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  billingAddress: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  tier: { id: string; code: string; name: string; defaultDiscountCeiling: { toString: () => string } };
  _count: { users: number; quotations: number };
};

function toCustomerView(row: CustomerRow): CustomerView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    tierId: row.tierId,
    tierCode: row.tier.code,
    tierName: row.tier.name,
    tierDiscountCeiling: row.tier.defaultDiscountCeiling.toString(),
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    billingAddress: row.billingAddress,
    active: row.active,
    portalUserCount: row._count.users,
    quotationCount: row._count.quotations,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface ListCustomersQuery extends ListQuery {
  tierId?: string | undefined;
}

export async function listCustomers(query: ListCustomersQuery): Promise<Paginated<CustomerView>> {
  const where = {
    ...searchFilter(query, ['code', 'name', 'contactEmail', 'contactName']),
    ...activeFilter(query),
    ...(query.tierId ? { tierId: query.tierId } : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.customer.findMany({
      where,
      select: customerSelect,
      orderBy: { name: 'asc' },
      ...pageArgs(query),
    }),
    prisma.customer.count({ where }),
  ]);

  return paginated(rows.map(toCustomerView), total, query);
}

export async function getCustomer(id: string): Promise<CustomerView> {
  const row = await prisma.customer.findUnique({ where: { id }, select: customerSelect });
  if (!row) throw new NotFoundError('Customer not found');
  return toCustomerView(row);
}

export interface CreateCustomerInput {
  code: string;
  name: string;
  tierId: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  billingAddress?: string | null;
}

export async function createCustomer(
  actor: AuthContext,
  input: CreateCustomerInput,
): Promise<CustomerView> {
  const clash = await prisma.customer.findUnique({
    where: { code: input.code },
    select: { id: true },
  });
  if (clash) throw new ConflictError(`A customer with code ${input.code} already exists`);

  await assertTierUsable(input.tierId);

  return prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: {
        code: input.code,
        name: input.name,
        tierId: input.tierId,
        contactName: input.contactName ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        billingAddress: input.billingAddress ?? null,
      },
      select: customerSelect,
    });

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.CUSTOMER,
      entityId: created.id,
      after: { code: created.code, name: created.name, tierId: created.tierId },
    });

    return toCustomerView(created);
  });
}

export interface UpdateCustomerInput {
  name?: string | undefined;
  tierId?: string | undefined;
  contactName?: string | null | undefined;
  contactEmail?: string | null | undefined;
  contactPhone?: string | null | undefined;
  billingAddress?: string | null | undefined;
  active?: boolean | undefined;
}

export async function updateCustomer(
  actor: AuthContext,
  id: string,
  input: UpdateCustomerInput,
): Promise<CustomerView> {
  const existing = await prisma.customer.findUnique({ where: { id }, select: customerSelect });
  if (!existing) throw new NotFoundError('Customer not found');

  if (input.tierId !== undefined && input.tierId !== existing.tierId) {
    await assertTierUsable(input.tierId);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.customer.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.tierId === undefined ? {} : { tierId: input.tierId }),
        ...(input.contactName === undefined ? {} : { contactName: input.contactName }),
        ...(input.contactEmail === undefined ? {} : { contactEmail: input.contactEmail }),
        ...(input.contactPhone === undefined ? {} : { contactPhone: input.contactPhone }),
        ...(input.billingAddress === undefined ? {} : { billingAddress: input.billingAddress }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
      select: customerSelect,
    });

    const change = diffFields(toCustomerView(existing), toCustomerView(updated), [
      'updatedAt',
      'portalUserCount',
      'quotationCount',
      // Tier display fields move as a consequence of tierId; recording tierId is enough.
      'tierCode',
      'tierName',
      'tierDiscountCeiling',
    ]);

    if (change) {
      await recordConfigChange(tx, {
        actor,
        entityType: AuditEntity.CUSTOMER,
        entityId: id,
        before: change.before,
        after: change.after,
      });
    }

    return toCustomerView(updated);
  });
}

/**
 * A customer must sit on a tier that exists and is active: the tier supplies the
 * fallback discount ceiling for every quotation the customer receives, so an
 * inactive tier would leave pricing governance undefined.
 */
async function assertTierUsable(tierId: string): Promise<void> {
  const tier = await prisma.customerTier.findUnique({
    where: { id: tierId },
    select: { active: true },
  });
  if (!tier) throw new NotFoundError('Customer tier not found');
  if (!tier.active) throw new ConflictError('That customer tier is deactivated');
}
