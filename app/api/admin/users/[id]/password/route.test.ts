// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const adminSession = { id: "admin-1", email: "admin@example.com", role: "admin" };
const userSession = { id: "user-1", email: "user@example.com", role: "user" };
const now = new Date("2026-01-02T00:00:00.000Z");

function target(overrides: Record<string, unknown> = {}) {
  return {
    id: "target-1",
    email: "target@example.com",
    name: "Target",
    role: "user",
    disabled: false,
    passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function request(id: string, body: unknown = {}) {
  return POST(
    new Request(`http://localhost/api/admin/users/${id}/password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  mocks.getSessionUser.mockReset().mockResolvedValue(adminSession);
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
  mocks.findUnique.mockReset().mockResolvedValue(target());
  mocks.updateMany.mockReset().mockResolvedValue({ count: 2 });
  mocks.update.mockReset().mockImplementation(async ({ where, data }) => {
    const base = target({ id: where.id, ...data });
    delete (base as Record<string, unknown>).passwordHash;
    return base;
  });
});

describe("POST /api/admin/users/{id}/password", () => {
  it("rejects non-admin callers", async () => {
    mocks.getSessionUser.mockResolvedValue(userSession);
    const response = await request("target-1", { password: "StrongPass1" });
    expect(response.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown user", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const response = await request("missing", { password: "StrongPass1" });
    expect(response.status).toBe(404);
  });

  it("sets an explicit password and revokes existing sessions", async () => {
    const response = await request("target-1", { password: "StrongPass2" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.temporaryPassword).toBeUndefined();
    expect(body.reauthRequired).toBe(false);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "target-1" },
        data: expect.objectContaining({ authVersion: { increment: 1 } })
      })
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.user.password_reset",
        targetId: "target-1",
        metadata: { generatedPassword: false }
      })
    );
  });

  it("generates a one-time password when none is provided", async () => {
    const response = await request("target-1");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.temporaryPassword).toMatch(/[A-Za-z]/);
    expect(body.temporaryPassword).toMatch(/\d/);
    expect(JSON.stringify(mocks.recordAudit.mock.calls)).not.toContain(
      body.temporaryPassword
    );
  });

  it("rejects a weak explicit password", async () => {
    const response = await request("target-1", { password: "abc" });
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("signals re-authentication when an admin resets their own password", async () => {
    mocks.findUnique.mockResolvedValue(target({ id: "admin-1" }));

    const response = await request("admin-1", { password: "StrongPass3" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reauthRequired).toBe(true);
  });
});
