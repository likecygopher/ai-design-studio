// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  recordAudit: vi.fn(),
  userFindUnique: vi.fn(),
  settingsFindUnique: vi.fn(),
  productFindMany: vi.fn(),
  assetFindMany: vi.fn(),
  jobFindMany: vi.fn(),
  costFindMany: vi.fn(),
  auditFindMany: vi.fn(),
  tokenFindMany: vi.fn(),
  webhookFindMany: vi.fn(),
  sessionFindMany: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/src/platform/db", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    userSettings: { findUnique: mocks.settingsFindUnique },
    product: { findMany: mocks.productFindMany },
    asset: { findMany: mocks.assetFindMany },
    generationJob: { findMany: mocks.jobFindMany },
    costRecord: { findMany: mocks.costFindMany },
    auditLog: { findMany: mocks.auditFindMany },
    apiToken: { findMany: mocks.tokenFindMany },
    webhookEndpoint: { findMany: mocks.webhookFindMany },
    authSession: { findMany: mocks.sessionFindMany }
  }
}));

import { setRateLimiter } from "@/src/platform/api";
import { MemoryRateLimiter } from "@/src/platform/rate-limit";
import { GET } from "./route";

beforeEach(() => {
  setRateLimiter(new MemoryRateLimiter());
  mocks.getSessionUser.mockReset().mockResolvedValue({
    id: "user-1",
    email: "user@example.com",
    role: "user"
  });
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
  mocks.userFindUnique.mockResolvedValue({
    id: "user-1",
    email: "user@example.com",
    name: "U",
    role: "user",
    disabled: false,
    monthlyBudgetUnits: 100,
    totpEnabled: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z")
  });
  mocks.settingsFindUnique.mockResolvedValue({ country: "Mexico", language: "Spanish" });
  mocks.productFindMany.mockResolvedValue([{ id: "p1", name: "Product" }]);
  mocks.assetFindMany.mockResolvedValue([
    { id: "a1", filename: "a.png", url: "/api/assets/a1" }
  ]);
  mocks.jobFindMany.mockResolvedValue([{ id: "j1", status: "succeeded" }]);
  mocks.costFindMany.mockResolvedValue([{ id: "c1", estimatedUnits: 1 }]);
  mocks.auditFindMany.mockResolvedValue([{ id: "audit-1", action: "auth.login" }]);
  mocks.tokenFindMany.mockResolvedValue([
    { id: "t1", name: "CI", prefix: "mcs_abc", scopes: ["read", "write"] }
  ]);
  mocks.webhookFindMany.mockResolvedValue([{ id: "w1", url: "https://example.com/hook" }]);
  mocks.sessionFindMany.mockResolvedValue([{ id: "s1", userAgent: "Chrome" }]);
});

describe("GET /api/account/export", () => {
  it("returns a downloadable JSON export without secrets", async () => {
    const response = await GET(new Request("http://localhost/api/account/export"));
    const body = await response.text();
    const parsed = JSON.parse(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(parsed.format).toBe("midea-ai-content-studio-export");
    expect(parsed.user.email).toBe("user@example.com");
    expect(parsed.products[0].name).toBe("Product");
    expect(parsed.jobs[0].status).toBe("succeeded");
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("tokenHash");
    expect(body).not.toContain("secretCipher");
    expect(body).not.toContain("storageKey");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account.data_export" })
    );
  });

  it("requires auth", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/account/export"))).status).toBe(401);
  });
});
