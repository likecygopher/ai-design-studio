// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hash } from "bcryptjs";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  recordAudit: vi.fn(),
  findUnique: vi.fn(),
  count: vi.fn(),
  deleteUser: vi.fn(),
  assetFindMany: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/src/platform/db", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique, count: mocks.count, delete: mocks.deleteUser },
    asset: { findMany: mocks.assetFindMany }
  }
}));

import { setRateLimiter } from "@/src/platform/api";
import { MemoryRateLimiter } from "@/src/platform/rate-limit";
import { DELETE } from "./route";

let passwordHash = "";

beforeAll(async () => {
  passwordHash = await hash("CurrentPass1", 10);
});

function request(body: unknown) {
  return DELETE(
    new Request("http://localhost/api/account", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

beforeEach(() => {
  setRateLimiter(new MemoryRateLimiter());
  mocks.getSessionUser.mockReset().mockResolvedValue({
    id: "user-1",
    email: "user@example.com",
    role: "user"
  });
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
  mocks.findUnique.mockReset().mockResolvedValue({
    id: "user-1",
    email: "user@example.com",
    role: "user",
    disabled: false,
    passwordHash
  });
  mocks.count.mockReset().mockResolvedValue(2);
  mocks.deleteUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.assetFindMany.mockReset().mockResolvedValue([]);
});

describe("DELETE /api/account", () => {
  it("deletes the account after password confirmation and audits it", async () => {
    const response = await request({ password: "CurrentPass1" });
    expect(response.status).toBe(200);
    expect((await response.json()).deleted).toBe(true);
    expect(mocks.deleteUser).toHaveBeenCalledWith({ where: { id: "user-1" } });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account.data_delete", userId: null })
    );
  });

  it("rejects a wrong password", async () => {
    const response = await request({ password: "WrongPass1" });
    expect(response.status).toBe(400);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("prevents deleting the last active admin", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      role: "admin",
      disabled: false,
      passwordHash
    });
    mocks.count.mockResolvedValue(1);
    const response = await request({ password: "CurrentPass1" });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("LAST_ADMIN");
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("requires a password", async () => {
    const response = await request({});
    expect(response.status).toBe(400);
  });

  it("requires auth", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await request({ password: "CurrentPass1" })).status).toBe(401);
  });
});
