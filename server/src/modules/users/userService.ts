import { Role } from '../../generated/prisma/enums';
import { prisma } from '../../db/prisma';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../http/errors';
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
import { hashPassword } from '../auth/password';
import { revokeAllSessionsForUser } from '../auth/sessionService';

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  customerId: string | null;
  customerName: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

/** Field selection that structurally cannot leak `passwordHash`. */
const summarySelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  customerId: true,
  lastLoginAt: true,
  createdAt: true,
  customer: { select: { name: true } },
} as const;

type SummaryRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  customerId: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  customer: { name: string } | null;
};

function toSummary(row: SummaryRow): UserSummary {
  const { customer, ...rest } = row;
  return { ...rest, customerName: customer?.name ?? null };
}

export interface ListUsersQuery extends ListQuery {
  role?: Role | undefined;
}

export async function listUsers(query: ListUsersQuery): Promise<Paginated<UserSummary>> {
  const where = {
    ...searchFilter(query, ['email', 'name']),
    ...activeFilter(query),
    ...(query.role ? { role: query.role } : {}),
  };

  // One round trip for the page and one for the count, inside a transaction so
  // `total` cannot disagree with the rows returned alongside it.
  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: summarySelect,
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
      ...pageArgs(query),
    }),
    prisma.user.count({ where }),
  ]);

  return paginated(rows.map(toSummary), total, query);
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role: Role;
  customerId?: string | null;
}

/**
 * Provision a user.
 *
 * Deviation from docs/PRD.md 6 FR-1, which describes internal self-signup. Open
 * signup would let an anonymous caller create an account and place it outside
 * the RBAC model, so account creation is an ADMIN-only operation instead. The
 * deviation is recorded in docs/PRD.md and AGENTS.md.
 */
export async function createUser(actor: AuthContext, input: CreateUserInput): Promise<UserSummary> {
  const email = input.email.trim().toLowerCase();
  const customerId = input.customerId ?? null;

  // Mirrors the users_customer_scope_check database constraint, so the caller
  // gets a clear business error rather than a constraint violation.
  if (input.role === Role.CUSTOMER && !customerId) {
    throw new BusinessRuleError('A customer account must be linked to a customer', [
      { path: 'customerId', message: 'required when role is CUSTOMER' },
    ]);
  }
  if (input.role !== Role.CUSTOMER && customerId) {
    throw new BusinessRuleError('Only customer accounts may be linked to a customer', [
      { path: 'customerId', message: 'must be omitted for internal roles' },
    ]);
  }

  if (customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundError('Customer not found');
    if (!customer.active) {
      throw new BusinessRuleError('Cannot create a login for an inactive customer');
    }
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new ConflictError('A user with this email already exists');

  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email, name: input.name.trim(), role: input.role, customerId, passwordHash },
      select: summarySelect,
    });

    await recordAudit(tx, {
      action: AuditAction.USER_CREATED,
      entityType: AuditEntity.USER,
      entityId: created.id,
      actorUserId: actor.userId,
      actorRole: actor.role,
      newValue: { email: created.email, role: created.role, customerId },
    });

    return toSummary(created);
  });
}

/**
 * Deactivate a user and drop its sessions.
 *
 * Users are never deleted: audit attribution must survive (AGENTS.md 20), and
 * the audit foreign key is ON DELETE RESTRICT.
 */
export async function deactivateUser(
  actor: AuthContext,
  userId: string,
  reason: string | null,
): Promise<UserSummary> {
  if (userId === actor.userId) {
    throw new BusinessRuleError('You cannot deactivate your own account');
  }

  const target = await prisma.user.findUnique({ where: { id: userId }, select: summarySelect });
  if (!target) throw new NotFoundError('User not found');
  if (!target.active) return toSummary(target);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { active: false },
      select: summarySelect,
    });

    const revoked = await revokeAllSessionsForUser(tx, userId);

    await recordAudit(tx, {
      action: AuditAction.USER_DEACTIVATED,
      entityType: AuditEntity.USER,
      entityId: userId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      oldValue: { active: true },
      newValue: { active: false, sessionsRevoked: revoked },
      reason,
    });

    return toSummary(updated);
  });
}
