import { prisma } from "@/src/platform/db";
import { ConflictError, NotFoundError } from "@/src/platform/errors";

/** Commercial plans: default quotas for members without per-user overrides. */

export type PlanView = {
  id: string;
  name: string;
  description: string | null;
  monthlyBudgetUnits: number | null;
  maxActiveJobs: number | null;
  usersCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PlanInput = {
  name: string;
  description?: string | null;
  monthlyBudgetUnits?: number | null;
  maxActiveJobs?: number | null;
};

function toView(row: {
  id: string;
  name: string;
  description: string | null;
  monthlyBudgetUnits: number | null;
  maxActiveJobs: number | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { users: number };
}): PlanView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    monthlyBudgetUnits: row.monthlyBudgetUnits,
    maxActiveJobs: row.maxActiveJobs,
    usersCount: row._count?.users ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function listPlans(): Promise<PlanView[]> {
  const rows = await prisma.plan.findMany({
    orderBy: [{ createdAt: "asc" }],
    include: { _count: { select: { users: true } } }
  });
  return rows.map(toView);
}

export async function createPlan(input: PlanInput): Promise<PlanView> {
  const name = input.name.trim();
  const existing = await prisma.plan.findUnique({ where: { name }, select: { id: true } });
  if (existing) {
    throw new ConflictError("套餐名称已存在。", "CONFLICT");
  }
  const row = await prisma.plan.create({
    data: {
      name,
      description: input.description?.trim() || null,
      monthlyBudgetUnits: input.monthlyBudgetUnits ?? null,
      maxActiveJobs: input.maxActiveJobs ?? null
    },
    include: { _count: { select: { users: true } } }
  });
  return toView(row);
}

export async function updatePlan(id: string, input: PlanInput): Promise<PlanView> {
  const existing = await prisma.plan.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new NotFoundError("套餐不存在。");
  }
  const name = input.name.trim();
  const duplicate = await prisma.plan.findFirst({
    where: { name, id: { not: id } },
    select: { id: true }
  });
  if (duplicate) {
    throw new ConflictError("套餐名称已存在。", "CONFLICT");
  }
  const row = await prisma.plan.update({
    where: { id },
    data: {
      name,
      description: input.description?.trim() || null,
      monthlyBudgetUnits: input.monthlyBudgetUnits ?? null,
      maxActiveJobs: input.maxActiveJobs ?? null
    },
    include: { _count: { select: { users: true } } }
  });
  return toView(row);
}

/** Plans with assigned users cannot be deleted (reassign first). */
export async function deletePlan(id: string): Promise<void> {
  const row = await prisma.plan.findUnique({
    where: { id },
    select: { id: true, _count: { select: { users: true } } }
  });
  if (!row) {
    throw new NotFoundError("套餐不存在。");
  }
  if (row._count.users > 0) {
    throw new ConflictError("仍有用户使用该套餐，请先调整用户套餐。", "CONFLICT");
  }
  await prisma.plan.delete({ where: { id } });
}
