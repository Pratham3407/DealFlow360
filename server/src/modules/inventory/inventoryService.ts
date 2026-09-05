import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../db/prisma';
import { ConflictError, NotFoundError } from '../../http/errors';
import { WEIGHT_SCALE, formatWeight, toDecimalString } from '../../http/fields';
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

type DecimalLike = Prisma.Decimal;

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

const warehouseSelect = {
  id: true,
  code: true,
  name: true,
  shippingWeight: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { inventory: true } },
} as const;

export interface WarehouseView {
  id: string;
  code: string;
  name: string;
  /** Relative shipping-cost multiplier; lower is cheaper to ship from. */
  shippingWeight: string;
  active: boolean;
  stockedProductCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type WarehouseRow = {
  id: string;
  code: string;
  name: string;
  shippingWeight: DecimalLike;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { inventory: number };
};

function toWarehouseView(row: WarehouseRow): WarehouseView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    shippingWeight: formatWeight(row.shippingWeight),
    active: row.active,
    stockedProductCount: row._count.inventory,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listWarehouses(query: ListQuery): Promise<Paginated<WarehouseView>> {
  const where = { ...searchFilter(query, ['code', 'name']), ...activeFilter(query) };

  const [rows, total] = await prisma.$transaction([
    prisma.warehouse.findMany({
      where,
      select: warehouseSelect,
      orderBy: { shippingWeight: 'asc' },
      ...pageArgs(query),
    }),
    prisma.warehouse.count({ where }),
  ]);

  return paginated(rows.map(toWarehouseView), total, query);
}

export interface CreateWarehouseInput {
  code: string;
  name: string;
  shippingWeight?: number | undefined;
}

export async function createWarehouse(
  actor: AuthContext,
  input: CreateWarehouseInput,
): Promise<WarehouseView> {
  if (await prisma.warehouse.findUnique({ where: { code: input.code }, select: { id: true } })) {
    throw new ConflictError(`A warehouse with code ${input.code} already exists`);
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.warehouse.create({
      data: {
        code: input.code,
        name: input.name,
        shippingWeight: toDecimalString(input.shippingWeight ?? 1, WEIGHT_SCALE),
      },
      select: warehouseSelect,
    });

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.WAREHOUSE,
      entityId: created.id,
      after: {
        code: created.code,
        name: created.name,
        shippingWeight: formatWeight(created.shippingWeight),
      },
    });

    return toWarehouseView(created);
  });
}

export interface UpdateWarehouseInput {
  name?: string | undefined;
  shippingWeight?: number | undefined;
  active?: boolean | undefined;
}

export async function updateWarehouse(
  actor: AuthContext,
  id: string,
  input: UpdateWarehouseInput,
): Promise<WarehouseView> {
  const existing = await prisma.warehouse.findUnique({ where: { id }, select: warehouseSelect });
  if (!existing) throw new NotFoundError('Warehouse not found');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.warehouse.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.shippingWeight === undefined
          ? {}
          : { shippingWeight: toDecimalString(input.shippingWeight, WEIGHT_SCALE) }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
      select: warehouseSelect,
    });

    const change = diffFields(toWarehouseView(existing), toWarehouseView(updated), [
      'updatedAt',
      'stockedProductCount',
    ]);
    if (change) {
      await recordConfigChange(tx, {
        actor,
        entityType: AuditEntity.WAREHOUSE,
        entityId: id,
        before: change.before,
        after: change.after,
      });
    }

    return toWarehouseView(updated);
  });
}

// ---------------------------------------------------------------------------
// Inventory
//
// Stock semantics (Active Technical Decision, AGENTS.md):
//   availableQuantity = units free to allocate
//   reservedQuantity  = units already committed to a fulfillment
//   physical stock    = available + reserved
//
// Allocation moves units from available to reserved inside one transaction, so
// the two counters can never disagree. That is why this module refuses to set
// reservedQuantity directly: it belongs to the fulfillment engine, and letting an
// administrator edit it would allow the same unit to be promised twice.
// ---------------------------------------------------------------------------

const inventorySelect = {
  id: true,
  warehouseId: true,
  productId: true,
  availableQuantity: true,
  reservedQuantity: true,
  reorderPoint: true,
  updatedAt: true,
  product: { select: { sku: true, name: true, unit: true, active: true } },
} as const;

export interface InventoryView {
  warehouseId: string;
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  /** Free to allocate. */
  availableQuantity: number;
  /** Committed to a fulfillment; not allocatable. */
  reservedQuantity: number;
  /** available + reserved. */
  physicalQuantity: number;
  reorderPoint: number;
  belowReorderPoint: boolean;
  updatedAt: Date;
}

type InventoryRow = {
  id: string;
  warehouseId: string;
  productId: string;
  availableQuantity: number;
  reservedQuantity: number;
  reorderPoint: number;
  updatedAt: Date;
  product: { sku: string; name: string; unit: string; active: boolean };
};

function toInventoryView(row: InventoryRow): InventoryView {
  return {
    warehouseId: row.warehouseId,
    productId: row.productId,
    sku: row.product.sku,
    productName: row.product.name,
    unit: row.product.unit,
    availableQuantity: row.availableQuantity,
    reservedQuantity: row.reservedQuantity,
    physicalQuantity: row.availableQuantity + row.reservedQuantity,
    reorderPoint: row.reorderPoint,
    belowReorderPoint: row.availableQuantity < row.reorderPoint,
    updatedAt: row.updatedAt,
  };
}

export async function listWarehouseInventory(
  warehouseId: string,
  query: ListQuery,
): Promise<Paginated<InventoryView>> {
  await assertWarehouseExists(warehouseId);

  const where = {
    warehouseId,
    ...(query.q
      ? {
          product: {
            OR: [
              { sku: { contains: query.q, mode: 'insensitive' as const } },
              { name: { contains: query.q, mode: 'insensitive' as const } },
            ],
          },
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.inventory.findMany({
      where,
      select: inventorySelect,
      orderBy: { product: { name: 'asc' } },
      ...pageArgs(query),
    }),
    prisma.inventory.count({ where }),
  ]);

  return paginated(rows.map(toInventoryView), total, query);
}

export interface SetStockInput {
  /** Absolute count of free-to-allocate units. Omit to leave unchanged. */
  availableQuantity?: number | undefined;
  reorderPoint?: number | undefined;
  reason?: string | null;
}

/**
 * Set stock levels for one product in one warehouse.
 *
 * An absolute set, used for corrections and initial load. Creates the inventory
 * row if the product has never been stocked here. `reservedQuantity` is
 * deliberately not settable - see the note above.
 */
export async function setWarehouseStock(
  actor: AuthContext,
  warehouseId: string,
  productId: string,
  input: SetStockInput,
): Promise<InventoryView> {
  await assertWarehouseExists(warehouseId);
  await assertProductExists(productId);

  const existing = await prisma.inventory.findUnique({
    where: { warehouseId_productId: { warehouseId, productId } },
    select: inventorySelect,
  });

  return prisma.$transaction(async (tx) => {
    const row = await tx.inventory.upsert({
      where: { warehouseId_productId: { warehouseId, productId } },
      create: {
        warehouseId,
        productId,
        availableQuantity: input.availableQuantity ?? 0,
        reorderPoint: input.reorderPoint ?? 0,
      },
      update: {
        ...(input.availableQuantity === undefined
          ? {}
          : { availableQuantity: input.availableQuantity }),
        ...(input.reorderPoint === undefined ? {} : { reorderPoint: input.reorderPoint }),
      },
      select: inventorySelect,
    });

    const after = toInventoryView(row);
    const change = existing
      ? diffFields(toInventoryView(existing), after, [
          'updatedAt',
          'sku',
          'productName',
          'unit',
          'belowReorderPoint',
          'physicalQuantity',
        ])
      : null;

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.INVENTORY,
      entityId: `${warehouseId}:${productId}`,
      before: change?.before ?? (existing ? undefined : null),
      after:
        change?.after ??
        (existing
          ? null
          : { availableQuantity: after.availableQuantity, reorderPoint: after.reorderPoint }),
      reason: input.reason ?? null,
    });

    return after;
  });
}

export interface ReceiveStockInput {
  quantity: number;
  reference?: string | null;
}

/**
 * Record a stock arrival.
 *
 * A relative increment rather than an absolute set, so two concurrent
 * replenishments cannot overwrite each other - the update is a single atomic
 * `increment` in the database, not a read-modify-write.
 *
 * docs/WORKFLOWS.md 7 says an arrival should surface a consolidation action when
 * a backorder is waiting. That reaction belongs to the fulfillment slice; this
 * endpoint only records the arrival.
 */
export async function receiveStock(
  actor: AuthContext,
  warehouseId: string,
  productId: string,
  input: ReceiveStockInput,
): Promise<InventoryView> {
  await assertWarehouseExists(warehouseId);
  await assertProductExists(productId);

  return prisma.$transaction(async (tx) => {
    const row = await tx.inventory.upsert({
      where: { warehouseId_productId: { warehouseId, productId } },
      create: { warehouseId, productId, availableQuantity: input.quantity },
      update: { availableQuantity: { increment: input.quantity } },
      select: inventorySelect,
    });

    const after = toInventoryView(row);

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.INVENTORY,
      entityId: `${warehouseId}:${productId}`,
      before: { availableQuantity: after.availableQuantity - input.quantity },
      after: { availableQuantity: after.availableQuantity, received: input.quantity },
      reason: input.reference ? `Stock arrival ${input.reference}` : 'Stock arrival',
    });

    return after;
  });
}

async function assertWarehouseExists(warehouseId: string): Promise<void> {
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true },
  });
  if (!warehouse) throw new NotFoundError('Warehouse not found');
}

async function assertProductExists(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) throw new NotFoundError('Product not found');
}
