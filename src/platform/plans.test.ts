// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: {
    plan: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      findFirst: mocks.findFirst,
      create: mocks.create,
      update: mocks.update,
      delete: mocks.delete
    }
  }
}));

import { createPlan, deletePlan, listPlans, updatePlan } from "./plans";

const now = new Date("2026-01-01T00:00:00.000Z");
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    name: "Pro",
    description: "专业版",
    monthlyBudgetUnits: 500,
    maxActiveJobs: 3,
    createdAt: now,
    updatedAt: now,
    _count: { users: 2 },
    ...overrides
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.findMany.mockResolvedValue([row()]);
  mocks.findUnique.mockResolvedValue(null);
  mocks.findFirst.mockResolvedValue(null);
  mocks.create.mockResolvedValue(row());
  mocks.update.mockResolvedValue(row());
  mocks.delete.mockResolvedValue(row());
});

describe("plans", () => {
  it("lists plans with member counts", async () => {
    const plans = await listPlans();
    expect(plans[0]).toMatchObject({
      name: "Pro",
      monthlyBudgetUnits: 500,
      maxActiveJobs: 3,
      usersCount: 2
    });
  });

  it("creates a plan and rejects duplicate names", async () => {
    await createPlan({ name: "Pro", monthlyBudgetUnits: 100, maxActiveJobs: 2 });
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ name: "Pro" });

    mocks.findUnique.mockResolvedValue({ id: "other" });
    await expect(createPlan({ name: "Pro" })).rejects.toMatchObject({ status: 409 });
  });

  it("updates a plan and prevents duplicate rename", async () => {
    mocks.findUnique.mockResolvedValue({ id: "plan-1" });
    await updatePlan("plan-1", { name: "Pro", maxActiveJobs: 5 });
    expect(mocks.update).toHaveBeenCalled();

    mocks.findFirst.mockResolvedValue({ id: "other" });
    await expect(updatePlan("plan-1", { name: "Taken" })).rejects.toMatchObject({ status: 409 });
  });

  it("refuses to delete a plan that still has members", async () => {
    mocks.findUnique.mockResolvedValue({ id: "plan-1", _count: { users: 2 } });
    await expect(deletePlan("plan-1")).rejects.toMatchObject({ status: 409 });
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("deletes an unused plan", async () => {
    mocks.findUnique.mockResolvedValue({ id: "plan-1", _count: { users: 0 } });
    await deletePlan("plan-1");
    expect(mocks.delete).toHaveBeenCalledWith({ where: { id: "plan-1" } });
  });
});
