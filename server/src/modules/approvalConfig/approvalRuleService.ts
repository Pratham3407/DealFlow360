import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../db/prisma';
import type { ApprovalLevelRequirement } from '../../generated/prisma/enums';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../http/errors';
import { RISK_SCALE, formatRisk, toDecimalString } from '../../http/fields';
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
import { validateApprovalBands, type ApprovalBand } from './approvalBands';

const approvalRuleSelect = {
  id: true,
  name: true,
  minimumRisk: true,
  maximumRisk: true,
  requiredLevel: true,
  priority: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface ApprovalRuleView {
  id: string;
  name: string;
  minimumRisk: string;
  /** Null means unbounded - the top band. */
  maximumRisk: string | null;
  requiredLevel: ApprovalLevelRequirement;
  priority: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type ApprovalRuleRow = {
  id: string;
  name: string;
  minimumRisk: Prisma.Decimal;
  maximumRisk: Prisma.Decimal | null;
  requiredLevel: ApprovalLevelRequirement;
  priority: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toApprovalRuleView(row: ApprovalRuleRow): ApprovalRuleView {
  return {
    id: row.id,
    name: row.name,
    minimumRisk: formatRisk(row.minimumRisk),
    maximumRisk: row.maximumRisk === null ? null : formatRisk(row.maximumRisk),
    requiredLevel: row.requiredLevel,
    priority: row.priority,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface ApprovalRuleListView extends Paginated<ApprovalRuleView> {
  /**
   * Problems with the active set as a whole, reported alongside the rows so a
   * configuration screen can warn without a second request. Empty means the
   * bands tile 0 to infinity cleanly.
   */
  coverage: { valid: boolean; problems: string[] };
}

export async function listApprovalRules(query: ListQuery): Promise<ApprovalRuleListView> {
  const where = { ...searchFilter(query, ['name']), ...activeFilter(query) };

  const [rows, total, all] = await prisma.$transaction([
    prisma.approvalRule.findMany({
      where,
      select: approvalRuleSelect,
      orderBy: { minimumRisk: 'asc' },
      ...pageArgs(query),
    }),
    prisma.approvalRule.count({ where }),
    prisma.approvalRule.findMany({ select: approvalRuleSelect }),
  ]);

  const problems = validateApprovalBands(all as ApprovalBand[]);

  return {
    ...paginated(rows.map(toApprovalRuleView), total, query),
    coverage: { valid: problems.length === 0, problems: problems.map((problem) => problem.message) },
  };
}

export interface CreateApprovalRuleInput {
  name: string;
  minimumRisk: number;
  maximumRisk?: number | null;
  requiredLevel: ApprovalLevelRequirement;
  priority?: number | undefined;
}

export async function createApprovalRule(
  actor: AuthContext,
  input: CreateApprovalRuleInput,
): Promise<ApprovalRuleView> {
  if (await prisma.approvalRule.findUnique({ where: { name: input.name }, select: { id: true } })) {
    throw new ConflictError(`An approval rule named ${input.name} already exists`);
  }

  const existing = await prisma.approvalRule.findMany({ select: approvalRuleSelect });
  const candidate: ApprovalBand = {
    id: 'candidate',
    name: input.name,
    minimumRisk: toDecimalString(input.minimumRisk, RISK_SCALE),
    maximumRisk:
      input.maximumRisk === undefined || input.maximumRisk === null
        ? null
        : toDecimalString(input.maximumRisk, RISK_SCALE),
    requiredLevel: input.requiredLevel,
    active: true,
  };

  assertBandsValid([...(existing as ApprovalBand[]), candidate]);

  return prisma.$transaction(async (tx) => {
    const created = await tx.approvalRule.create({
      data: {
        name: input.name,
        minimumRisk: candidate.minimumRisk as string,
        maximumRisk: candidate.maximumRisk as string | null,
        requiredLevel: input.requiredLevel,
        priority: input.priority ?? 0,
      },
      select: approvalRuleSelect,
    });

    await recordConfigChange(tx, {
      actor,
      entityType: AuditEntity.APPROVAL_RULE,
      entityId: created.id,
      after: toApprovalRuleView(created),
    });

    return toApprovalRuleView(created);
  });
}

export interface UpdateApprovalRuleInput {
  name?: string | undefined;
  minimumRisk?: number | undefined;
  maximumRisk?: number | null | undefined;
  requiredLevel?: ApprovalLevelRequirement | undefined;
  priority?: number | undefined;
  active?: boolean | undefined;
}

export async function updateApprovalRule(
  actor: AuthContext,
  id: string,
  input: UpdateApprovalRuleInput,
): Promise<ApprovalRuleView> {
  const existing = await prisma.approvalRule.findUnique({
    where: { id },
    select: approvalRuleSelect,
  });
  if (!existing) throw new NotFoundError('Approval rule not found');

  if (input.name !== undefined && input.name !== existing.name) {
    if (await prisma.approvalRule.findUnique({ where: { name: input.name }, select: { id: true } })) {
      throw new ConflictError(`An approval rule named ${input.name} already exists`);
    }
  }

  const all = await prisma.approvalRule.findMany({ select: approvalRuleSelect });
  const projected = (all as ApprovalBand[]).map((band) =>
    band.id === id
      ? {
          ...band,
          name: input.name ?? band.name,
          minimumRisk:
            input.minimumRisk === undefined
              ? band.minimumRisk
              : toDecimalString(input.minimumRisk, RISK_SCALE),
          maximumRisk:
            input.maximumRisk === undefined
              ? band.maximumRisk
              : input.maximumRisk === null
                ? null
                : toDecimalString(input.maximumRisk, RISK_SCALE),
          requiredLevel: input.requiredLevel ?? band.requiredLevel,
          active: input.active ?? band.active,
        }
      : band,
  );

  // Validate the whole set as it will be, not just the row being touched:
  // deactivating a middle band is what typically opens a gap.
  assertBandsValid(projected);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.approvalRule.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.minimumRisk === undefined
          ? {}
          : { minimumRisk: toDecimalString(input.minimumRisk, RISK_SCALE) }),
        ...(input.maximumRisk === undefined
          ? {}
          : {
              maximumRisk:
                input.maximumRisk === null ? null : toDecimalString(input.maximumRisk, RISK_SCALE),
            }),
        ...(input.requiredLevel === undefined ? {} : { requiredLevel: input.requiredLevel }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
      select: approvalRuleSelect,
    });

    const change = diffFields(toApprovalRuleView(existing), toApprovalRuleView(updated));
    if (change) {
      await recordConfigChange(tx, {
        actor,
        entityType: AuditEntity.APPROVAL_RULE,
        entityId: id,
        before: change.before,
        after: change.after,
      });
    }

    return toApprovalRuleView(updated);
  });
}

/**
 * Reject a write that would leave the risk axis incompletely covered.
 *
 * Approval cannot be bypassed (AGENTS.md §6 invariant 5), and a gap in the bands
 * is exactly a bypass: a score landing in it would route to nobody.
 */
function assertBandsValid(bands: readonly ApprovalBand[]): void {
  const problems = validateApprovalBands(bands);
  if (problems.length === 0) return;

  throw new BusinessRuleError(
    'That change would leave approval routing incomplete',
    problems.map((problem) => ({ message: problem.message })),
  );
}
