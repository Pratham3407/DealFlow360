import { prisma } from '../../db/prisma';
import {
  BillingInterval,
  CancellationRule,
  ProrationRule,
  RefundRule,
} from '../../generated/prisma/enums';
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
import { AuditEntity } from '../audit/auditService';
import { diffFields, recordConfigChange } from '../audit/configAudit';

const planSelect = {
  id: true,
  code: true,
  name: true,
  interval: true,
  prorationRule: true,
  cancellationRule: true,
  refundRule: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true, subscriptions: true } },
} as const;

export interface SubscriptionPlanView {
  id: string;
  code: string;
  name: string;
  interval: BillingInterval;
  prorationRule: ProrationRule;
  cancellationRule: CancellationRule;
  refundRule: RefundRule;
  active: boolean;
  productCount: number;
  subscriptionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type PlanRow = {
  id: string;
  code: string;
  name: string;
  interval: BillingInterval;
  prorationRule: ProrationRule;
  cancellationRule: CancellationRule;
  refundRule: RefundRule;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { products: number; subscriptions: number };
};

function toPlanView(row: PlanRow): SubscriptionPlanView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    interval: row.interval,
    prorationRule: row.prorationRule,
    cancellationRule: row.cancellationRule,
    refundRule: row.refundRule,
    active: row.active,
    productCount: row._count.products,
    subscriptionCount: row._count.subscriptions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const PLAN_DERIVED = ['updatedAt', 'productCount', 'subscriptionCount'] as const;

export async function listSubscriptionPlans(
  query: ListQuery,
): Promise<Paginated<SubscriptionPlanView>> {
  const where = { ...searchFilter(query, ['code', 'name']), ...activeFilter(query) };

  const [rows, total] = await prisma.$transaction([
    prisma.subscriptionPlan.findMany({
      where,
      select: planSelect,
      orderBy: { name: 'asc' },
      ...pageArgs(query),
    }),
    prisma.subscriptionPlan.count({ where }),
  ]);

  return paginated(rows.map(toPlanView), total, query);
}

export interface CreateSubscriptionPlanInput {
  code: string;
  name: string;
  interval: BillingInterval;
  prorationRule?: ProrationRule | undefined;
  cancellationRule?: CancellationRule | undefined;
  refundRule?: RefundRule | undefined;
}

export async function createSubscriptionPlan(
  actor: AuthContext,
  input: CreateSubscriptionPlanInput,
): Promise<SubscriptionPlanView> {
  if (
    await prisma.subscriptionPlan.findUnique({ where: { code: input.code }, select: { id: true } })
  ) {
    throw new ConflictError(`A subscription plan with code ${input.code} already exists`);
  }

  const prorationRule = input.prorationRule ?? ProrationRule.DAILY_PRORATION;
  const refundRule = input.refundRule ?? RefundRule.PARTIAL_PRORATED;
  assertRulesCoherent(prorationRule, refundRule);

  return prisma.$transaction(async (tx) => {
    const created = await tx.subscriptionPlan.create({
      data: {
        code: input.code,
        name: input.name,
        interval: input.interval,
        prorationRule,
        cancellationRule: input.cancellationRule ?? CancellationRule.END_OF_PERIOD,
        refundRule,
      },
      select: planSelect,
    });

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.SUBSCRIPTION_PLAN,
      entityId: created.id,
      after: {
        code: created.code,
        name: created.name,
        interval: created.interval,
        prorationRule: created.prorationRule,
        cancellationRule: created.cancellationRule,
        refundRule: created.refundRule,
      },
    });

    return toPlanView(created);
  });
}

export interface UpdateSubscriptionPlanInput {
  name?: string | undefined;
  interval?: BillingInterval | undefined;
  prorationRule?: ProrationRule | undefined;
  cancellationRule?: CancellationRule | undefined;
  refundRule?: RefundRule | undefined;
  active?: boolean | undefined;
}

export async function updateSubscriptionPlan(
  actor: AuthContext,
  id: string,
  input: UpdateSubscriptionPlanInput,
): Promise<SubscriptionPlanView> {
  const existing = await prisma.subscriptionPlan.findUnique({ where: { id }, select: planSelect });
  if (!existing) throw new NotFoundError('Subscription plan not found');

  assertRulesCoherent(
    input.prorationRule ?? existing.prorationRule,
    input.refundRule ?? existing.refundRule,
  );

  /*
   * A plan that products still reference cannot be deactivated: a RECURRING
   * product must always point at an active plan, and the database enforces the
   * link with products_recurring_requires_plan_check. Detach the products first.
   */
  if (input.active === false && existing._count.products > 0) {
    throw new ConflictError(
      `${existing._count.products} product(s) still use this plan. Reassign them before deactivating it.`,
    );
  }

  // Changing cadence would silently reprice live subscriptions, so it is refused
  // once any subscription exists (docs/BUSINESS_RULES.md 9).
  if (
    input.interval !== undefined &&
    input.interval !== existing.interval &&
    existing._count.subscriptions > 0
  ) {
    throw new ConflictError(
      'This plan has active subscriptions, so its billing interval cannot change. Create a new plan instead.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.subscriptionPlan.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.interval === undefined ? {} : { interval: input.interval }),
        ...(input.prorationRule === undefined ? {} : { prorationRule: input.prorationRule }),
        ...(input.cancellationRule === undefined
          ? {}
          : { cancellationRule: input.cancellationRule }),
        ...(input.refundRule === undefined ? {} : { refundRule: input.refundRule }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
      select: planSelect,
    });

    const change = diffFields(toPlanView(existing), toPlanView(updated), [...PLAN_DERIVED]);
    if (change) {
      await recordConfigChange(tx, {
        actor,
        entityType: AuditEntity.SUBSCRIPTION_PLAN,
        entityId: id,
        before: change.before,
        after: change.after,
      });
    }

    return toPlanView(updated);
  });
}

/**
 * A prorated refund is computed from the unused fraction of a period
 * (docs/BUSINESS_RULES.md 9). With proration switched off there is no such
 * fraction to compute from, so the combination is rejected rather than left to
 * produce an arbitrary number at billing time.
 */
function assertRulesCoherent(prorationRule: ProrationRule, refundRule: RefundRule): void {
  if (prorationRule === ProrationRule.NONE && refundRule === RefundRule.PARTIAL_PRORATED) {
    throw new BusinessRuleError(
      'A prorated refund requires proration to be enabled',
      [
        { path: 'refundRule', message: 'PARTIAL_PRORATED needs prorationRule other than NONE' },
      ],
    );
  }
}
