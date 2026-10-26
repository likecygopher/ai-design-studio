import { PLATFORM_CONFIG } from "@/src/platform/config";
import { prisma } from "@/src/platform/db";
import { ApiError } from "@/src/platform/errors";

/**
 * Monthly AI usage budget (estimated units recorded by the cost ledger).
 *
 * Precedence: `User.monthlyBudgetUnits` > `DEFAULT_MONTHLY_BUDGET_UNITS` > unlimited.
 * - null on the user = inherit the platform default;
 * - 0 on the user = explicitly unlimited.
 */

export type BudgetSnapshot = {
  monthStart: string;
  usedUnits: number;
  /** null = unlimited. */
  budgetUnits: number | null;
  remainingUnits: number | null;
  percent: number | null;
  exceeded: boolean;
  /** true when the budget comes from the platform default rather than the user row. */
  inherited: boolean;
};

export function currentMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function resolveBudgetUnits(
  userBudget: number | null | undefined,
  defaultBudget: number | null | undefined,
  planBudget?: number | null
): number | null {
  if (userBudget === 0) {
    return null;
  }
  if (typeof userBudget === "number" && userBudget > 0) {
    return userBudget;
  }
  if (planBudget === 0) {
    return null;
  }
  if (typeof planBudget === "number" && planBudget > 0) {
    return planBudget;
  }
  if (typeof defaultBudget === "number" && defaultBudget > 0) {
    return defaultBudget;
  }
  return null;
}

export async function getMonthlyUsage(userId: string, now: Date = new Date()): Promise<number> {
  const aggregate = await prisma.costRecord.aggregate({
    where: { userId, createdAt: { gte: currentMonthStart(now) } },
    _sum: { estimatedUnits: true }
  });
  return aggregate._sum.estimatedUnits ?? 0;
}

export async function getBudgetSnapshot(
  userId: string,
  now: Date = new Date()
): Promise<BudgetSnapshot> {
  const [user, usedUnits] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        monthlyBudgetUnits: true,
        plan: { select: { monthlyBudgetUnits: true } }
      }
    }),
    getMonthlyUsage(userId, now)
  ]);

  const userBudget = user?.monthlyBudgetUnits ?? null;
  const budgetUnits = resolveBudgetUnits(
    userBudget,
    PLATFORM_CONFIG.defaultMonthlyBudgetUnits,
    user?.plan?.monthlyBudgetUnits ?? null
  );
  const remainingUnits = budgetUnits === null ? null : Math.max(0, budgetUnits - usedUnits);
  const percent = budgetUnits === null ? null : Math.min(100, Math.round((usedUnits / budgetUnits) * 100));

  return {
    monthStart: currentMonthStart(now).toISOString(),
    usedUnits,
    budgetUnits,
    remainingUnits,
    percent,
    exceeded: budgetUnits !== null && usedUnits >= budgetUnits,
    inherited: userBudget === null && budgetUnits !== null
  };
}

/** Throws before enqueueing a job once the user's monthly budget is exhausted. */
export async function assertWithinBudget(userId: string): Promise<BudgetSnapshot> {
  const snapshot = await getBudgetSnapshot(userId);
  if (snapshot.exceeded) {
    throw new ApiError(
      429,
      "COST_BUDGET_EXCEEDED",
      `本月 AI 额度已用尽（${snapshot.usedUnits}/${snapshot.budgetUnits} 单位）。请联系管理员调整预算或等待下月重置。`
    );
  }
  return snapshot;
}
