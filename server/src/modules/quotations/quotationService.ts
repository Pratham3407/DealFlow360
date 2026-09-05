import { QuotationStatus, Role } from '../../generated/prisma/enums';
import { prisma } from '../../db/prisma';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  VersionConflictError,
} from '../../http/errors';
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
import { AuditAction, AuditEntity, recordAudit } from '../audit/auditService';
import { toJsonValue } from '../audit/configAudit';
import { can, Capability } from '../auth/permissions';
import { nextQuoteNumber } from './quotationNumber';
import {
  assertOwnership,
  assertVersion,
  bumpVersion,
  findQuotationForActor,
  lineSelect,
  quotationSelect,
  recalculateQuotation,
  toQuotationView,
  visibilityScope,
  type QuotationView,
} from './quotationShared';
import { assertEditable, assertTransition, canSubmit } from './quotationStates';

/** Cost and margin are omitted entirely for a caller without margin:view. */
function includeCost(auth: AuthContext): boolean {
  return can(auth.role, Capability.MARGIN_VIEW);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface ListQuotationsQuery extends ListQuery {
  status?: QuotationStatus | undefined;
  customerId?: string | undefined;
  salesRepId?: string | undefined;
}

export async function listQuotations(
  auth: AuthContext,
  query: ListQuotationsQuery,
): Promise<Paginated<QuotationView>> {
  const where = {
    // Applied last so a rep cannot widen its own scope with ?salesRepId=
    ...(query.status ? { status: query.status } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.salesRepId ? { salesRepId: query.salesRepId } : {}),
    ...searchFilter(query, ['quoteNumber']),
    ...visibilityScope(auth),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.quotation.findMany({
      where,
      select: quotationSelect,
      orderBy: { createdAt: 'desc' },
      ...pageArgs(query),
    }),
    prisma.quotation.count({ where }),
  ]);

  return paginated(
    rows.map((row) => toQuotationView(row, { includeCost: includeCost(auth) })),
    total,
    query,
  );
}

/** One quotation with its lines. */
export async function getQuotation(auth: AuthContext, id: string): Promise<QuotationView> {
  const row = await findQuotationForActor(auth, id);
  const lines = await prisma.quotationLine.findMany({
    where: { quotationId: id },
    select: lineSelect,
    orderBy: { position: 'asc' },
  });

  return toQuotationView(row, { includeCost: includeCost(auth), lines });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateQuotationInput {
  customerId: string;
  /**
   * Whom the quotation belongs to. A rep may only create for itself; an admin or
   * manager may create on behalf of a named rep.
   */
  salesRepId?: string | null;
  notes?: string | null;
  validUntil?: Date | null;
}

export async function createQuotation(
  auth: AuthContext,
  input: CreateQuotationInput,
): Promise<QuotationView> {
  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { active: true },
  });
  if (!customer) throw new NotFoundError('Customer not found');
  if (!customer.active) throw new ConflictError('That customer is deactivated');

  const salesRepId = await resolveSalesRep(auth, input.salesRepId ?? null);

  if (input.validUntil && input.validUntil.getTime() < Date.now()) {
    throw new BusinessRuleError('The validity date cannot be in the past', [
      { path: 'validUntil', message: 'must be today or later' },
    ]);
  }

  return prisma.$transaction(async (tx) => {
    const quoteNumber = await nextQuoteNumber(tx);

    const created = await tx.quotation.create({
      data: {
        quoteNumber,
        customerId: input.customerId,
        salesRepId,
        // Status and version are server-assigned; both are absent from the request
        // schema, so a client cannot start a quotation mid-lifecycle.
        status: QuotationStatus.DRAFT,
        version: 1,
        notes: input.notes ?? null,
        validUntil: input.validUntil ?? null,
      },
      select: quotationSelect,
    });

    await recordAudit(tx, {
      action: AuditAction.QUOTATION_CREATED,
      entityType: AuditEntity.QUOTATION,
      entityId: created.id,
      actorUserId: auth.userId,
      actorRole: auth.role,
      entityVersion: created.version,
      newValue: toJsonValue({
        quoteNumber: created.quoteNumber,
        customerId: created.customerId,
        salesRepId: created.salesRepId,
        status: created.status,
      }),
    });

    return toQuotationView(created, { includeCost: includeCost(auth), lines: [] });
  });
}

/**
 * Decide the owning rep.
 *
 * A sales rep always owns what it creates - a client-supplied salesRepId is
 * refused rather than ignored, so an attempt to assign work to someone else is
 * visible. Other internal roles may nominate a rep, which must be an active
 * SALES_REP.
 */
async function resolveSalesRep(auth: AuthContext, requested: string | null): Promise<string> {
  if (auth.role === Role.SALES_REP) {
    if (requested && requested !== auth.userId) {
      throw new BusinessRuleError('A sales representative can only create quotations they own', [
        { path: 'salesRepId', message: 'must be omitted or your own user id' },
      ]);
    }
    return auth.userId;
  }

  if (!requested) {
    throw new BusinessRuleError('Specify the sales representative who will own this quotation', [
      { path: 'salesRepId', message: 'required when you are not a sales representative' },
    ]);
  }

  const rep = await prisma.user.findUnique({
    where: { id: requested },
    select: { role: true, active: true },
  });
  if (!rep) throw new NotFoundError('Sales representative not found');
  if (!rep.active) throw new ConflictError('That user account is deactivated');
  if (rep.role !== Role.SALES_REP) {
    throw new BusinessRuleError('A quotation must be owned by a sales representative', [
      { path: 'salesRepId', message: `that user is ${rep.role}` },
    ]);
  }
  return requested;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export interface UpdateQuotationInput {
  /** Optimistic concurrency token; always required. */
  version: number;
  customerId?: string | undefined;
  orderDiscountPercent?: number | undefined;
  notes?: string | null | undefined;
  validUntil?: Date | null | undefined;
}

/**
 * Patch a quotation.
 *
 * Splits the change into material and non-material parts. `customerId` and
 * `orderDiscountPercent` alter what is being sold and for how much, so they bump
 * the version and trigger recalculation; notes and the validity date do neither,
 * because bumping the version would needlessly invalidate an approval
 * (AGENTS.md §11).
 */
export async function updateQuotation(
  auth: AuthContext,
  id: string,
  input: UpdateQuotationInput,
): Promise<QuotationView> {
  const existing = await findQuotationForActor(auth, id);
  assertOwnership(auth, existing.salesRepId);
  assertVersion(existing.version, input.version);

  const wantsMaterial =
    input.customerId !== undefined || input.orderDiscountPercent !== undefined;

  if (wantsMaterial) {
    // Commercial content is frozen outside DRAFT / REVISION_REQUIRED.
    assertEditable(existing.status);
  }

  if (input.orderDiscountPercent !== undefined) {
    assertDiscountCapability(auth);
  }

  if (input.customerId !== undefined && input.customerId !== existing.customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: input.customerId },
      select: { active: true },
    });
    if (!customer) throw new NotFoundError('Customer not found');
    if (!customer.active) throw new ConflictError('That customer is deactivated');
  }

  if (input.validUntil && input.validUntil.getTime() < Date.now()) {
    throw new BusinessRuleError('The validity date cannot be in the past', [
      { path: 'validUntil', message: 'must be today or later' },
    ]);
  }

  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const data: Record<string, unknown> = {};

  if (input.customerId !== undefined && input.customerId !== existing.customerId) {
    data['customerId'] = input.customerId;
    changes['customerId'] = { before: existing.customerId, after: input.customerId };
  }

  if (input.orderDiscountPercent !== undefined) {
    const next = toDecimalString(input.orderDiscountPercent, PERCENT_SCALE);
    const before = existing.orderDiscountPercent.toFixed(PERCENT_SCALE);
    if (next !== before) {
      data['orderDiscountPercent'] = next;
      changes['orderDiscountPercent'] = { before, after: next };
    }
  }

  if (input.notes !== undefined && input.notes !== existing.notes) {
    data['notes'] = input.notes;
    changes['notes'] = { before: existing.notes, after: input.notes };
  }

  if (input.validUntil !== undefined) {
    const before = existing.validUntil?.toISOString() ?? null;
    const after = input.validUntil?.toISOString() ?? null;
    if (before !== after) {
      data['validUntil'] = input.validUntil;
      changes['validUntil'] = { before, after };
    }
  }

  // Nothing actually differs: return as-is and write no audit row.
  if (Object.keys(changes).length === 0) {
    return getQuotation(auth, id);
  }

  const materialChanged =
    changes['customerId'] !== undefined || changes['orderDiscountPercent'] !== undefined;

  await prisma.$transaction(async (tx) => {
    const version = materialChanged
      ? await bumpVersion(tx, id, input.version)
      : existing.version;

    await tx.quotation.update({
      where: { id },
      data: { ...data, lastActivityAt: new Date() },
    });

    if (materialChanged) await recalculateQuotation(tx, id);

    await recordAudit(tx, {
      action:
        changes['orderDiscountPercent'] !== undefined
          ? AuditAction.DISCOUNT_CHANGED
          : AuditAction.QUOTATION_EDITED,
      entityType: AuditEntity.QUOTATION,
      entityId: id,
      actorUserId: auth.userId,
      actorRole: auth.role,
      entityVersion: version,
      oldValue: toJsonValue(
        Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value.before])),
      ),
      newValue: toJsonValue(
        Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value.after])),
      ),
    });
  });

  return getQuotation(auth, id);
}

/**
 * Recompute stored figures from persisted lines.
 *
 * Idempotent and deliberately not version-bumping: it changes no commercial
 * input, so it must not invalidate an approval. Useful after a catalogue tax
 * change, or to prove the stored totals match the lines.
 */
export async function recalculate(auth: AuthContext, id: string): Promise<QuotationView> {
  const existing = await findQuotationForActor(auth, id);
  assertOwnership(auth, existing.salesRepId);

  await prisma.$transaction(async (tx) => {
    await recalculateQuotation(tx, id);
  });

  return getQuotation(auth, id);
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Submit for approval.
 *
 * Slice 3 establishes the transition and its guards. Risk scoring decides the
 * target state, so until the risk engine exists this moves DRAFT to
 * PENDING_APPROVAL unconditionally and records the request. Slice 4 replaces the
 * fixed target with a scored one and slice 5 creates the approval instances; the
 * transition table, the version semantics and the audit shape do not change.
 */
export async function submitQuotation(
  auth: AuthContext,
  id: string,
  version: number,
): Promise<QuotationView> {
  const existing = await findQuotationForActor(auth, id);
  assertOwnership(auth, existing.salesRepId);
  assertVersion(existing.version, version);

  if (!canSubmit(existing.status)) {
    assertEditable(existing.status);
  }

  const lineCount = await prisma.quotationLine.count({ where: { quotationId: id } });
  if (lineCount === 0) {
    throw new BusinessRuleError('A quotation must have at least one line before it is submitted');
  }

  assertTransition(existing.status, QuotationStatus.PENDING_APPROVAL);

  await prisma.$transaction(async (tx) => {
    // Recalculate first: whatever is reviewed must be arithmetically current.
    await recalculateQuotation(tx, id);

    const affected = await tx.quotation.updateMany({
      where: { id, version, status: existing.status },
      data: { status: QuotationStatus.PENDING_APPROVAL, lastActivityAt: new Date() },
    });
    // Guarded on status as well as version: a concurrent submit must not produce
    // two approval requests for one quotation.
    if (affected.count === 0) throw new VersionConflictError();

    await recordAudit(tx, {
      action: AuditAction.APPROVAL_REQUESTED,
      entityType: AuditEntity.QUOTATION,
      entityId: id,
      actorUserId: auth.userId,
      actorRole: auth.role,
      entityVersion: version,
      oldValue: toJsonValue({ status: existing.status }),
      newValue: toJsonValue({ status: QuotationStatus.PENDING_APPROVAL }),
    });
  });

  return getQuotation(auth, id);
}

/** Applying or changing a discount is a distinct capability in docs/RBAC.md. */
export function assertDiscountCapability(auth: AuthContext): void {
  if (!can(auth.role, Capability.QUOTATIONS_APPLY_DISCOUNT)) {
    throw new ForbiddenError('Your role does not permit changing discounts');
  }
}
