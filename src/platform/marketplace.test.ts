// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  itemCreate: vi.fn(),
  itemFindMany: vi.fn(),
  itemCount: vi.fn(),
  itemFindFirst: vi.fn(),
  itemFindUnique: vi.fn(),
  itemUpdate: vi.fn(),
  templateCreate: vi.fn(),
  templateFindMany: vi.fn(),
  transaction: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: {
    marketplaceItem: {
      create: mocks.itemCreate,
      findMany: mocks.itemFindMany,
      count: mocks.itemCount,
      findFirst: mocks.itemFindFirst,
      findUnique: mocks.itemFindUnique,
      update: mocks.itemUpdate
    },
    userTemplate: {
      create: mocks.templateCreate,
      findMany: mocks.templateFindMany
    },
    $transaction: mocks.transaction
  }
}));

import {
  cloneMarketplaceItem,
  listMarketplace,
  publishMarketplaceItem,
  reviewMarketplaceItem
} from "./marketplace";

const now = new Date("2026-01-01T00:00:00.000Z");
const row = {
  id: "item-1",
  title: "Warm kitchen style",
  description: "A warm preset",
  category: "style",
  prompt: "Make it warm",
  coverUrl: null,
  status: "pending",
  clones: 0,
  reviewNote: null,
  createdAt: now,
  updatedAt: now,
  author: { name: "Demo", email: "demo@example.com" }
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.itemCreate.mockResolvedValue(row);
  mocks.itemFindMany.mockResolvedValue([{ ...row, status: "approved" }]);
  mocks.itemCount.mockResolvedValue(1);
  mocks.itemFindFirst.mockResolvedValue({ ...row, status: "approved" });
  mocks.itemFindUnique.mockResolvedValue({ id: "item-1" });
  mocks.itemUpdate.mockResolvedValue({ ...row, status: "approved", clones: 1 });
  mocks.templateCreate.mockResolvedValue({ id: "tpl-1" });
  mocks.templateFindMany.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      marketplaceItem: {
        findFirst: mocks.itemFindFirst,
        update: mocks.itemUpdate
      },
      userTemplate: { create: mocks.templateCreate }
    })
  );
});

describe("marketplace", () => {
  it("publishes pending items", async () => {
    const item = await publishMarketplaceItem("user-1", {
      title: "Warm kitchen style",
      category: "style",
      prompt: "Make it warm"
    });
    expect(item.status).toBe("pending");
    expect(mocks.itemCreate.mock.calls[0][0].data.status).toBe("pending");
  });

  it("lists only approved items with filters", async () => {
    const result = await listMarketplace({ q: "warm", category: "style" });
    expect(result.total).toBe(1);
    const where = mocks.itemFindMany.mock.calls[0][0].where;
    expect(where.status).toBe("approved");
    expect(where.category).toBe("style");
  });

  it("clones an approved item into the user template library", async () => {
    const result = await cloneMarketplaceItem("user-1", "item-1");
    expect(result.templateId).toBe("tpl-1");
    expect(mocks.templateCreate.mock.calls[0][0].data).toMatchObject({
      userId: "user-1",
      itemId: "item-1"
    });
    expect(mocks.itemUpdate.mock.calls[0][0].data.clones).toEqual({ increment: 1 });
  });

  it("reviews pending items", async () => {
    const item = await reviewMarketplaceItem("admin-1", "item-1", {
      status: "approved"
    });
    expect(item.status).toBe("approved");
    expect(mocks.itemUpdate.mock.calls[0][0].data).toMatchObject({
      status: "approved",
      reviewedBy: "admin-1"
    });
  });
});
