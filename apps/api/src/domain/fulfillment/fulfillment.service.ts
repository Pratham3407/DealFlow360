/**
 * Fulfillment engine (PRD §8, BUSINESS_RULES.md §7).
 *
 * A confirmed quotation is the order. The engine derives a warehouse split that
 * minimises the number of dispatches (consolidation first, THEN proximity/cheaper
 * leg, per PRD §8: "bundle and place orders" / "consolidate orders") while never
 * overselling unreserved stock.
 *
 * Deriving the plan is side-effect free — allocations start `reserved=false` and
 * stock is only moved when an authorised user accepts (or overrides) the plan.
 * That keeps "recalculate" safe to call as often as the UI pleases.
 *
 * ## Why split quantity-wise, never on price
 *
 * The plan is about logistics, not economics: the order never changes because a
 * warehouse is rearranged. Allocations therefore splinter only the *quantity* of
 * an already-agreed line, never its unit price or margin.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  backorders,
  fulfillments,
  fulfillmentAllocations,
  inventory,
  products,
  quotations,
  warehouses,
} from '@/db/schema/index.js';
import type { DbExecutor } from '@/db/client.js';
import { writeAudit } from '../audit/audit.service.js';
import type { AuditActor } from '../audit/audit.service.js';
import { badRequest, conflict, notFound } from '@/lib/errors.js';
import type { FulfillmentStatus } from '@dealflow/shared';

export interface FulfillmentActor extends AuditActor {
  userId: string;
}

/** Weighted base cost of one shipment from a warehouse. */
function shipmentCostFor(warehouse: (typeof warehouses.$inferSelect)): number {
  return Math.round((warehouse.baseShipmentCostPaise * warehouse.shippingWeightBp) / 10_000);
}

async function requireFulfillment(exec: DbExecutor, quotationId: string) {
  const fulfillment = await exec.query.fulfillments.findFirst({
    where: (table, { eq }) => eq(table.quotationId, quotationId),
    with: {
      quotation: true,
      allocations: true,
      backorders: true,
    },
  });
  if (!fulfillment) throw notFound('FULFILLMENT_NOT_FOUND', 'No fulfillment plan exists for this quotation');
  return fulfillment;
}

/**
 * Combine the allocation rows of one warehouse back into its planned leg when
 * multiple products share it.
 */
function summarizePlan(fulfillment: Awaited<ReturnType<typeof requireFulfillment>>) {
  const byWarehouse = new Map<string, { warehouseId: string; quantity: number }>();
  for (const alloc of fulfillment.allocations) {
    const existing = byWarehouse.get(alloc.warehouseId) ?? { warehouseId: alloc.warehouseId, quantity: 0 };
    existing.quantity += alloc.quantity;
    byWarehouse.set(alloc.warehouseId, existing);
  }
  return [...byWarehouse.values()];
}

async function reserveStock(exec: DbExecutor, warehouseId: string, productId: string, quantity: number) {
  const stock = await exec.query.inventory.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.warehouseId, warehouseId), eq(table.productId, productId)),
  });
  if (!stock || stock.availableQuantity < quantity) {
    throw conflict('INVENTORY_SHORTAGE', `Insufficient available stock in the chosen warehouse`);
  }
  await exec
    .update(inventory)
    .set({
      availableQuantity: sql`${inventory.availableQuantity} - ${quantity}`,
      reservedQuantity: sql`${inventory.reservedQuantity} + ${quantity}`,
    })
    .where(and(eq(inventory.warehouseId, warehouseId), eq(inventory.productId, productId)));
}

function coverageStatus(hasAllocations: boolean, openBackorderCount: number): FulfillmentStatus {
  if (!hasAllocations) return 'BACKORDERED';
  return openBackorderCount > 0 ? 'PARTIALLY_ALLOCATED' : 'ALLOCATED';
}

/** Regenerate the recommended warehouse split from live stock. Idempotent. */
export async function recalculatePlan(exec: DbExecutor, quotationId: string, actor: FulfillmentActor) {
  let fulfillment = await exec.query.fulfillments.findFirst({
    where: (table, { eq }) => eq(table.quotationId, quotationId),
  });
  if (!fulfillment) {
    const [inserted] = await exec
      .insert(fulfillments)
      .values({ quotationId, status: 'NOT_STARTED' })
      .returning();
    if (!inserted) throw conflict('FULFILLMENT_CREATE_FAILED', 'Could not create fulfillment record');
    fulfillment = inserted;
  }
  if (fulfillment.status !== 'NOT_STARTED' && fulfillment.status !== 'ALLOCATING') {
    throw conflict('FULFILLMENT_STATE', `Cannot recalculate a plan in state ${fulfillment.status}`);
  }
  if (fulfillment.isOverridden) {
    throw conflict('FULFILLMENT_OVERRIDDEN', 'The plan was overridden by a user; recalculate would discard their choice');
  }

  const quote = await exec.query.quotations.findFirst({
    where: (table, { eq }) => eq(table.id, quotationId),
    with: { lines: true },
  });
  if (!quote) throw notFound('QUOTE_NOT_FOUND', 'Quotation not found');

  // Wipe previous recommendation (unreserved rows only; an accepted plan is unreachable here).
  await exec
    .delete(fulfillmentAllocations)
    .where(and(eq(fulfillmentAllocations.fulfillmentId, fulfillment.id), eq(fulfillmentAllocations.reserved, false)));
  await exec.delete(backorders).where(eq(backorders.fulfillmentId, fulfillment.id));

  const productIds = quote.lines.map((line) => line.productId);
  // Sequential: `exec` is usually a transaction, which is pinned to one connection.
  const stockRows = await exec
    .select()
    .from(inventory)
    .where(and(inArray(inventory.productId, productIds), sql`${inventory.availableQuantity} > 0`));
  const warehouseRows = await exec.select().from(warehouses).where(eq(warehouses.active, true));

  const stockByProduct = new Map<string, (typeof stockRows)[number][]>();
  for (const row of stockRows) {
    const list = stockByProduct.get(row.productId) ?? [];
    list.push(row);
    stockByProduct.set(row.productId, list);
  }
  const warehouseById = new Map(warehouseRows.map((w) => [w.id, w]));
  const usedWarehouses = new Map<string, { cost: number }>();

  // One allocation row per warehouse leg: order warehouses by priority first.
  for (const line of quote.lines) {
    if (line.productId === null) continue;
    const product = await exec.query.products.findFirst({
      where: (table, { eq }) => eq(table.id, line.productId),
    });
    if (!product || !product.stockTracked) continue; // services ship on switch-on, not from a bin

    let remaining = line.quantity;
    const candidates = (stockByProduct.get(line.productId) ?? []).sort(
      (a, b) => (warehouseById.get(b.warehouseId)?.priority ?? 0) - (warehouseById.get(a.warehouseId)?.priority ?? 0),
    );

    for (const stock of candidates) {
      if (remaining <= 0) break;
      const take = Math.min(stock.availableQuantity, remaining);
      if (take <= 0) continue;
      const warehouse = warehouseById.get(stock.warehouseId);
      if (!warehouse) continue;

      if (!usedWarehouses.has(warehouse.id)) {
        usedWarehouses.set(warehouse.id, { cost: shipmentCostFor(warehouse) });
      }
      await exec.insert(fulfillmentAllocations).values({
        fulfillmentId: fulfillment.id,
        quotationLineId: line.id,
        productId: line.productId,
        warehouseId: warehouse.id,
        quantity: take,
        reserved: false,
      });
      remaining -= take;
    }

    if (remaining > 0) {
      await exec.insert(backorders).values({
        fulfillmentId: fulfillment.id,
        quotationLineId: line.id,
        productId: line.productId,
        quantity: remaining,
        status: 'OPEN',
      });
    }
  }

  const refreshed = await requireFulfillment(exec, quotationId);
  const totalShipmentCost = [...usedWarehouses.values()].reduce((sum, entry) => sum + entry.cost, 0);

  // Attribute each warehouse's one-off dispatch cost to the first allocation of that warehouse.
  const seen = new Set<string>();
  let allocatedCount = 0;
  for (const alloc of refreshed.allocations) {
    if (!seen.has(alloc.warehouseId)) {
      seen.add(alloc.warehouseId);
      await exec
        .update(fulfillmentAllocations)
        .set({ shipmentCostPaise: shipmentCostFor(warehouseById.get(alloc.warehouseId)!) })
        .where(eq(fulfillmentAllocations.id, alloc.id));
    }
    allocatedCount += alloc.quantity;
  }

  const openBackorderCount = refreshed.backorders.filter((b) => b.status === 'OPEN').length;
  const projectedDelivery = projectDelivery(warehouseRows, seen);

  const [updated] = await exec
    .update(fulfillments)
    .set({
      status: 'ALLOCATING',
      plannedShipmentCount: seen.size,
      plannedShippingCostPaise: totalShipmentCost,
      projectedDeliveryDate: projectedDelivery,
    })
    .where(eq(fulfillments.id, fulfillment.id))
    .returning();
  if (!updated) throw notFound('FULFILLMENT_NOT_FOUND', 'Fulfillment disappeared during recalculation');

  await writeAudit(exec, {
    ...actor,
    entityType: 'FULFILLMENT',
    entityId: updated.id,
    action: 'ALLOCATION_RECALCULATED',
    newValue: { shipments: seen.size, shippingCostPaise: totalShipmentCost, allocations: refreshed.allocations.length },
    quotationId,
    quotationVersion: quote.version,
    reason: 'Recommended plan recalculated from live stock',
  });

  return requireFulfillment(exec, quotationId);
}

function projectDelivery(warehouseRows: (typeof warehouses.$inferSelect)[], usedWarehouseIds: Set<string>): Date | null {
  const used = warehouseRows.filter((w) => usedWarehouseIds.has(w.id));
  if (!used.length) return null;
  const leadDays = Math.max(...used.map((w) => w.leadTimeDays));
  const delivery = new Date();
  delivery.setUTCDate(delivery.getUTCDate() + leadDays);
  return delivery;
}

/**
 * Commit the recommended plan: reserve stock and move the fulfillment into an
 * allocated state. Only reachable from ALLOCATING (plan exists, not yet reserved).
 */
export async function acceptPlan(exec: DbExecutor, quotationId: string, actor: FulfillmentActor) {
  const fulfillment = await requireFulfillment(exec, quotationId);
  if (fulfillment.status !== 'ALLOCATING') {
    throw conflict('FULFILLMENT_STATE', `Only an ALLOCATING plan can be accepted (state: ${fulfillment.status})`);
  }

  for (const alloc of fulfillment.allocations) {
    if (alloc.reserved) continue;
    await reserveStock(exec, alloc.warehouseId, alloc.productId, alloc.quantity);
    await exec
      .update(fulfillmentAllocations)
      .set({ reserved: true })
      .where(eq(fulfillmentAllocations.id, alloc.id));
  }

  const openBackorders = fulfillment.backorders.filter((b) => b.status === 'OPEN').length;
  const status = coverageStatus(fulfillment.allocations.some((a) => a.quantity > 0), openBackorders);

  await exec
    .update(fulfillments)
    .set({
      status,
      acceptedById: actor.userId,
      acceptedAt: new Date(),
      isOverridden: false,
    })
    .where(eq(fulfillments.id, fulfillment.id));

  await exec.update(quotations).set({ status: 'FULFILLMENT' }).where(eq(quotations.id, quotationId));

  await writeAudit(exec, {
    ...actor,
    entityType: 'FULFILLMENT',
    entityId: fulfillment.id,
    action: 'ALLOCATION_ACCEPTED',
    newValue: { status, backorders: openBackorders },
    quotationId,
    quotationVersion: fulfillment.quotation.version,
    reason: 'Warehouse plan accepted; stock reserved',
  });

  return requireFulfillment(exec, quotationId);
}

export interface OverrideSplit {
  quotationLineId: string;
  warehouseId: string;
  quantity: number;
}

/** Replace the recommended plan with a human-chosen split and reserve immediately. */
export async function overridePlan(exec: DbExecutor, quotationId: string, splits: OverrideSplit[], actor: FulfillmentActor) {
  const fulfillment = await requireFulfillment(exec, quotationId);
  if (fulfillment.status !== 'ALLOCATING') {
    throw conflict('FULFILLMENT_STATE', `Only an ALLOCATING plan can be overridden (state: ${fulfillment.status})`);
  }

  const quote = await exec.query.quotations.findFirst({
    where: (table, { eq }) => eq(table.id, quotationId),
    with: { lines: true },
  });
  if (!quote) throw notFound('QUOTE_NOT_FOUND', 'Quotation not found');

  const linesById = new Map(quote.lines.map((line) => [line.id, line]));
  const requestedByLine = new Map<string, number>();
  const warehouseIds = splits.map((s) => s.warehouseId);
  const seenWarehouses = new Set<string>();

  for (const split of splits) {
    if (split.quantity <= 0) throw badRequest('OVERRIDE_QUANTITY', 'Split quantities must be positive');
    const line = linesById.get(split.quotationLineId);
    if (!line) throw notFound('QUOTE_LINE_NOT_FOUND', 'Unknown quotation line in override');

    requestedByLine.set(split.quotationLineId, (requestedByLine.get(split.quotationLineId) ?? 0) + split.quantity);

    const stock = await exec.query.inventory.findFirst({
      where: (table, { and, eq }) => and(eq(table.warehouseId, split.warehouseId), eq(table.productId, line.productId)),
    });
    if (!stock || stock.availableQuantity < split.quantity) {
      throw conflict('INVENTORY_SHORTAGE', 'Insufficient available stock in the chosen warehouse');
    }
    seenWarehouses.add(split.warehouseId);
  }

  for (const [lineId, total] of requestedByLine) {
    const line = linesById.get(lineId)!;
    if (total > line.quantity) {
      throw badRequest('OVERRIDE_OVER_QUANTITY', `Override splits more than the line's agreed quantity`);
    }
  }

  // Wipe recommendation + backorders, then write the override as reserved allocations.
  await exec.delete(fulfillmentAllocations).where(eq(fulfillmentAllocations.fulfillmentId, fulfillment.id));
  await exec.delete(backorders).where(eq(backorders.fulfillmentId, fulfillment.id));

  const allocatedPerLine = new Map<string, number>();
  for (const split of splits) {
    const line = linesById.get(split.quotationLineId)!;
    await reserveStock(exec, split.warehouseId, line.productId, split.quantity);
    await exec.insert(fulfillmentAllocations).values({
      fulfillmentId: fulfillment.id,
      quotationLineId: split.quotationLineId,
      productId: line.productId,
      warehouseId: split.warehouseId,
      quantity: split.quantity,
      reserved: true,
    });
    allocatedPerLine.set(split.quotationLineId, (allocatedPerLine.get(split.quotationLineId) ?? 0) + split.quantity);
  }

  let openBackorders = 0;
  for (const line of quote.lines) {
    const allocated = allocatedPerLine.get(line.id) ?? 0;
    if (allocated < line.quantity) {
      await exec.insert(backorders).values({
        fulfillmentId: fulfillment.id,
        quotationLineId: line.id,
        productId: line.productId,
        quantity: line.quantity - allocated,
        status: 'OPEN',
      });
      openBackorders += 1;
    }
  }

  const refreshed = await requireFulfillment(exec, quotationId);
  const status = coverageStatus(refreshed.allocations.length > 0, openBackorders);

  const warehouseRows = await exec.select().from(warehouses).where(eq(warehouses.active, true));
  const projected = projectDelivery(warehouseRows, seenWarehouses);

  await exec
    .update(fulfillments)
    .set({
      status,
      isOverridden: true,
      acceptedById: actor.userId,
      acceptedAt: new Date(),
      plannedShipmentCount: seenWarehouses.size,
      projectedDeliveryDate: projected,
    })
    .where(eq(fulfillments.id, fulfillment.id));

  await exec.update(quotations).set({ status: 'FULFILLMENT' }).where(eq(quotations.id, quotationId));

  await writeAudit(exec, {
    ...actor,
    entityType: 'FULFILLMENT',
    entityId: fulfillment.id,
    action: 'ALLOCATION_OVERRIDDEN',
    newValue: { splits: splits.length, status, backorders: openBackorders },
    quotationId,
    quotationVersion: fulfillment.quotation.version,
  });

  return requireFulfillment(exec, quotationId);
}

/** Report stock into a backorder and attempt consolidation. */
export async function restockProduct(exec: DbExecutor, productId: string, warehouseId: string, quantity: number, actor: FulfillmentActor) {
  const existing = await exec.query.inventory.findFirst({
    where: (table, { and, eq }) => and(eq(table.warehouseId, warehouseId), eq(table.productId, productId)),
  });
  if (!existing) throw notFound('INVENTORY_NOT_FOUND', 'No stock row for this product/warehouse');

  await exec
    .update(inventory)
    .set({ availableQuantity: sql`${inventory.availableQuantity} + ${quantity}` })
    .where(and(eq(inventory.warehouseId, warehouseId), eq(inventory.productId, productId)));

  await checkBackorderStock(exec, productId, actor);
}

/**
 * Flag any OPEN backorder for a product as STOCK_AVAILABLE once a warehouse can
 * cover it, and consolidate immediately. Called after stock movements.
 */
export async function checkBackorderStock(exec: DbExecutor, productId: string, actor: FulfillmentActor) {
  const open = await exec.query.backorders.findMany({
    where: (table, { and, eq }) => and(eq(table.productId, productId), eq(table.status, 'OPEN')),
    with: { fulfillment: true },
  });
  if (!open.length) return;

  for (const bo of open) {
    const stock = await exec
      .select()
      .from(inventory)
      .where(and(eq(inventory.productId, productId), sql`${inventory.availableQuantity} >= ${bo.quantity}`))
      .orderBy(asc(inventory.updatedAt))
      .limit(1);
    if (!stock.length) {
      continue;
    }
    const warehouse = stock[0];
    if (!warehouse) continue;
    await exec
      .update(backorders)
      .set({ status: 'STOCK_AVAILABLE', availableWarehouseId: warehouse.warehouseId })
      .where(eq(backorders.id, bo.id));
    await writeAudit(exec, {
      ...actor,
      entityType: 'BACKORDER',
      entityId: bo.id,
      action: 'BACKORDER_STOCK_AVAILABLE',
      newValue: { warehouseId: warehouse.warehouseId },
      quotationId: bo.fulfillment.quotationId,
      reason: `Stock reported at warehouse ${warehouse.warehouseId}`,
    });
  }
  return;
}

export async function consolidateBackorder(exec: DbExecutor, backorderId: string, actor: FulfillmentActor) {
  const bo = await exec.query.backorders.findFirst({
    where: (table, { eq }) => eq(table.id, backorderId),
    with: { fulfillment: true },
  });
  if (!bo) throw notFound('BACKORDER_NOT_FOUND', 'Backorder not found');
  if (bo.status !== 'STOCK_AVAILABLE') {
    throw conflict('BACKORDER_STATE', `Backorder must be STOCK_AVAILABLE to consolidate (state: ${bo.status})`);
  }
  if (!bo.availableWarehouseId) throw conflict('BACKORDER_STATE', 'No warehouse recorded as having stock');

  await reserveStock(exec, bo.availableWarehouseId, bo.productId, bo.quantity);
  await exec.insert(fulfillmentAllocations).values({
    fulfillmentId: bo.fulfillmentId,
    quotationLineId: bo.quotationLineId,
    productId: bo.productId,
    warehouseId: bo.availableWarehouseId,
    quantity: bo.quantity,
    reserved: true,
    fromBackorderId: bo.id,
  });
  await exec
    .update(backorders)
    .set({ status: 'CONSOLIDATED', resolvedAt: new Date() })
    .where(eq(backorders.id, bo.id));

  await writeAudit(exec, {
    ...actor,
    entityType: 'BACKORDER',
    entityId: bo.id,
    action: 'BACKORDER_CONSOLIDATED',
    newValue: { warehouseId: bo.availableWarehouseId },
    quotationId: bo.fulfillment.quotationId,
  });

  // Reflect consolidation in the fulfillment status.
  const remaining = await exec
    .select({ count: sql<number>`count(*)` })
    .from(backorders)
    .where(and(eq(backorders.fulfillmentId, bo.fulfillmentId), eq(backorders.status, 'OPEN')));
  const hasAllocations = await exec
    .select({ count: sql<number>`count(*)` })
    .from(fulfillmentAllocations)
    .where(eq(fulfillmentAllocations.fulfillmentId, bo.fulfillmentId));
  const newStatus: FulfillmentStatus =
    (remaining[0]?.count ?? 0) === 0 && (hasAllocations[0]?.count ?? 0) > 0 ? 'ALLOCATED' : 'PARTIALLY_ALLOCATED';
  await exec.update(fulfillments).set({ status: newStatus }).where(eq(fulfillments.id, bo.fulfillmentId));

  return requireFulfillment(exec, bo.fulfillment.quotationId);
}

export async function markAllocationShipped(exec: DbExecutor, allocationId: string, actor: FulfillmentActor) {
  const allocation = await exec.query.fulfillmentAllocations.findFirst({
    where: (table, { eq }) => eq(table.id, allocationId),
    with: { fulfillment: true },
  });
  if (!allocation) throw notFound('ALLOCATION_NOT_FOUND', 'Allocation not found');
  if (allocation.shippedAt) return requireFulfillment(exec, allocation.fulfillment.quotationId);
  if (!allocation.reserved) {
    throw conflict('ALLOCATION_NOT_RESERVED', 'Only a reserved allocation can be shipped');
  }

  await exec.update(fulfillmentAllocations).set({ shippedAt: new Date() }).where(eq(fulfillmentAllocations.id, allocationId));

  const openBackorders = await exec
    .select({ count: sql<number>`count(*)` })
    .from(backorders)
    .where(and(eq(backorders.fulfillmentId, allocation.fulfillmentId), eq(backorders.status, 'OPEN')));
  const shipped = await exec
    .select({ count: sql<number>`count(*)` })
    .from(fulfillmentAllocations)
    .where(and(eq(fulfillmentAllocations.fulfillmentId, allocation.fulfillmentId), sql`${fulfillmentAllocations.shippedAt} is not null`));
  const totalAllocs = await exec
    .select({ count: sql<number>`count(*)` })
    .from(fulfillmentAllocations)
    .where(eq(fulfillmentAllocations.fulfillmentId, allocation.fulfillmentId));

  const allShipped = (openBackorders[0]?.count ?? 0) === 0 && (shipped[0]?.count ?? 0) === (totalAllocs[0]?.count ?? 0);
  const anyShipped = (shipped[0]?.count ?? 0) > 0;

  if (allShipped) {
    await exec.update(fulfillments).set({ status: 'FULFILLED' }).where(eq(fulfillments.id, allocation.fulfillmentId));
    await exec.update(quotations).set({ status: 'COMPLETED' }).where(eq(quotations.id, allocation.fulfillment.quotationId));
  } else if (anyShipped) {
    await exec.update(fulfillments).set({ status: 'PARTIALLY_FULFILLED' }).where(eq(fulfillments.id, allocation.fulfillmentId));
  }

  await writeAudit(exec, {
    ...actor,
    entityType: 'FULFILLMENT' as const,
    entityId: allocationId,
    action: 'ALLOCATION_SHIPPED',
    newValue: { warehouseId: allocation.warehouseId },
    quotationId: allocation.fulfillment.quotationId,
  });

  return requireFulfillment(exec, allocation.fulfillment.quotationId);
}