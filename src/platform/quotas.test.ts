// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  aggregate: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique },
    costRecord: { aggregate: mocks.aggregate }
  }
}));

import { ApiError } from "@/src/platform/errors";
import {
  assertWithinBudget,
  currentMonthStart,
  getBudgetSnapshot,
  resolveBudgetUnits
} from "./quotas";

beforeEach(() => {
  mocks.findUnique.mockReset().mockResolvedValue({ monthlyBudgetUnits: null });
  mocks.aggregate.mockReset().mockResolvedValue({ _sum: { estimatedUnits: 0 } });
});

describe("resolveBudgetUnits", () => {
  it("prefers a positive user budget, treats 0 as unlimited, and falls back to the default", () => {
    expect(resolveBudgetUnits(120, 500)).toBe(120);
    expect(resolveBudgetUnits(0, 500)).toBeNull();
    expect(resolveBudgetUnits(null, 500)).toBe(500);
    expect(resolveBudgetUnits(undefined, 0)).toBeNull();
    expect(resolveBudgetUnits(null, null)).toBeNull();
  });
});

describe("getBudgetSnapshot", () => {
  it("computes usage, remaining units and percentage for a per-user budget", async () => {
    mocks.findUnique.mockResolvedValue({ monthlyBudgetUnits: 100 });
    mocks.aggregate.mockResolvedValue({ _sum: { estimatedUnits: 12 } });

    const snapshot = await getBudgetSnapshot("user-1", new Date("2026-03-15T10:00:00.000Z"));

    expect(snapshot).toMatchObject({
      monthStart: "2026-03-01T00:00:00.000Z",
      usedUnits: 12,
      budgetUnits: 100,
      remainingUnits: 88,
      percent: 12,
      exceeded: false,
      inherited: false
    });
    expect(mocks.aggregate.mock.calls[0][0].where.createdAt.gte).toEqual(
      new Date("2026-03-01T00:00:00.000Z")
    );
  });

  it("reports exceeded and clamps the percent at 100", async () => {
    mocks.findUnique.mockResolvedValue({ monthlyBudgetUnits: 10 });
    mocks.aggregate.mockResolvedValue({ _sum: { estimatedUnits: 14.5 } });

    const snapshot = await getBudgetSnapshot("user-1");
    expect(snapshot).toMatchObject({
      usedUnits: 14.5,
      budgetUnits: 10,
      remainingUnits: 0,
      percent: 100,
      exceeded: true
    });
  });

  it("treats a user budget of 0 as unlimited", async () => {
    mocks.findUnique.mockResolvedValue({ monthlyBudgetUnits: 0 });
    mocks.aggregate.mockResolvedValue({ _sum: { estimatedUnits: 9999 } });

    const snapshot = await getBudgetSnapshot("user-1");
    expect(snapshot).toMatchObject({
      budgetUnits: null,
      remainingUnits: null,
      percent: null,
      exceeded: false
    });
  });

  it("uses the platform default when the user has no override", async () => {
    vi.resetModules();
    vi.stubEnv("DEFAULT_MONTHLY_BUDGET_UNITS", "50");
    const module = await import("./quotas");
    mocks.findUnique.mockResolvedValue({ monthlyBudgetUnits: null });
    mocks.aggregate.mockResolvedValue({ _sum: { estimatedUnits: 20 } });

    const snapshot = await module.getBudgetSnapshot("user-1");
    expect(snapshot).toMatchObject({
      budgetUnits: 50,
      usedUnits: 20,
      inherited: true,
      exceeded: false
    });
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe("assertWithinBudget", () => {
  it("passes when below budget", async () => {
    mocks.findUnique.mockResolvedValue({ monthlyBudgetUnits: 10 });
    mocks.aggregate.mockResolvedValue({ _sum: { estimatedUnits: 2 } });
    await expect(assertWithinBudget("user-1")).resolves.toMatchObject({ exceeded: false });
  });

  it("throws COST_BUDGET_EXCEEDED at the limit", async () => {
    mocks.findUnique.mockResolvedValue({ monthlyBudgetUnits: 10 });
    mocks.aggregate.mockResolvedValue({ _sum: { estimatedUnits: 10 } });

    await expect(assertWithinBudget("user-1")).rejects.toMatchObject({
      code: "COST_BUDGET_EXCEEDED",
      status: 429
    } satisfies Partial<ApiError>);
  });
});

describe("plan budget precedence", () => {
  it("uses the plan budget when the user has no override", async () => {
    mocks.findUnique.mockResolvedValue({
      monthlyBudgetUnits: null,
      plan: { monthlyBudgetUnits: 30 }
    });
    mocks.aggregate.mockResolvedValue({ _sum: { estimatedUnits: 5 } });
    const snapshot = await getBudgetSnapshot("user-1");
    expect(snapshot.budgetUnits).toBe(30);
    expect(snapshot.exceeded).toBe(false);
  });

  it("lets a user override beat the plan budget", async () => {
    mocks.findUnique.mockResolvedValue({
      monthlyBudgetUnits: 10,
      plan: { monthlyBudgetUnits: 30 }
    });
    mocks.aggregate.mockResolvedValue({ _sum: { estimatedUnits: 5 } });
    expect((await getBudgetSnapshot("user-1")).budgetUnits).toBe(10);
  });
});

describe("currentMonthStart", () => {
  it("returns the UTC first day of the month", () => {
    expect(currentMonthStart(new Date("2026-12-31T23:59:59.000Z")).toISOString()).toBe(
      "2026-12-01T00:00:00.000Z"
    );
  });
});
