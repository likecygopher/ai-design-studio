// @vitest-environment node
import { hash } from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  recordAudit: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/src/platform/db", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      update: mocks.update
    },
    authSession: { updateMany: mocks.updateMany }
  }
}));

import { POST } from "./route";

const session = { id: "user-1", email: "user@example.com", role: "user" };
let currentHash = "";

function request(body: unknown) {
  return POST(
    new Request("http://localhost/api/account/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

beforeAll(async () => {
  currentHash = await hash("CurrentPass1", 10);
});

beforeEach(() => {
  mocks.getSessionUser.mockReset().mockResolvedValue(session);
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
  mocks.findUnique.mockReset().mockResolvedValue({
    id: "user-1",
    passwordHash: currentHash
  });
  mocks.update.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.updateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe("POST /api/account/password", () => {
  it("rejects anonymous callers", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const response = await request({
      currentPassword: "CurrentPass1",
      newPassword: "NextPass123"
    });
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("AUTH_REQUIRED");
  });

  it("returns 404 when the account no longer exists", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const response = await request({
      currentPassword: "CurrentPass1",
      newPassword: "NextPass123"
    });
    expect(response.status).toBe(404);
  });

  it("rejects a wrong current password", async () => {
    const response = await request({
      currentPassword: "WrongPass1",
      newPassword: "NextPass123"
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("当前密码不正确");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects reusing the current password", async () => {
    const response = await request({
      currentPassword: "CurrentPass1",
      newPassword: "CurrentPass1"
    });
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects new passwords that violate the policy", async () => {
    const response = await request({
      currentPassword: "CurrentPass1",
      newPassword: "short"
    });
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updates the password, revokes the session and audits the change", async () => {
    const response = await request({
      currentPassword: "CurrentPass1",
      newPassword: "NextPass123"
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ reauthRequired: true });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({ authVersion: { increment: 1 } })
      })
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "account.password_change",
        targetId: "user-1"
      })
    );
    expect(JSON.stringify(mocks.recordAudit.mock.calls)).not.toContain("NextPass123");
  });
});
