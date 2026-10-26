// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  recordAudit: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  count: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/src/platform/db", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      update: mocks.update,
      count: mocks.count
    }
  }
}));

import { PATCH } from "./route";

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
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function request(id: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/admin/users/${id}`, {
      method: "PATCH",
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
  mocks.count.mockReset().mockResolvedValue(2);
  mocks.update.mockReset().mockImplementation(async ({ where, data }) =>
    target({ id: where.id, ...data })
  );
});

describe("PATCH /api/admin/users/{id}", () => {
  it("updates the monthly budget and audits it", async () => {
    const response = await request("target-1", { monthlyBudgetUnits: 250 });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.monthlyBudgetUnits).toBe(250);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { monthlyBudgetUnits: 250 } })
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.user.update",
        metadata: expect.objectContaining({ monthlyBudgetUnits: 250 })
      })
    );
  });

  it("allows resetting the budget to the platform default (null)", async () => {
    const response = await request("target-1", { monthlyBudgetUnits: null });
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { monthlyBudgetUnits: null } })
    );
  });

  it("rejects non-admin callers", async () => {
    mocks.getSessionUser.mockResolvedValue(userSession);
    const response = await request("target-1", { name: "x" });
    expect(response.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown user", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const response = await request("missing", { name: "x" });
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("NOT_FOUND");
  });

  it("updates the nickname and audits the change", async () => {
    const response = await request("target-1", { name: "New Name" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.name).toBe("New Name");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "target-1" }, data: { name: "New Name" } })
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.user.update", targetId: "target-1" })
    );
  });

  it("disables a user", async () => {
    const response = await request("target-1", { disabled: true });
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { disabled: true } })
    );
  });

  it("prevents an admin from disabling themselves", async () => {
    mocks.findUnique.mockResolvedValue(
      target({ id: "admin-1", role: "admin", email: "admin@example.com" })
    );

    const response = await request("admin-1", { disabled: true });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("CANNOT_MODIFY_SELF");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("prevents an admin from demoting themselves", async () => {
    mocks.findUnique.mockResolvedValue(target({ id: "admin-1", role: "admin" }));

    const response = await request("admin-1", { role: "user" });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("CANNOT_MODIFY_SELF");
  });

  it("refuses to demote the last remaining admin", async () => {
    mocks.findUnique.mockResolvedValue(target({ id: "other-admin", role: "admin" }));
    mocks.count.mockResolvedValue(1);

    const response = await request("other-admin", { role: "user" });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("LAST_ADMIN");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("allows demoting an admin when another admin remains", async () => {
    mocks.findUnique.mockResolvedValue(target({ id: "other-admin", role: "admin" }));
    mocks.count.mockResolvedValue(2);

    const response = await request("other-admin", { role: "user" });
    expect(response.status).toBe(200);
  });

  it("does not treat disabling a regular user as removing an admin", async () => {
    const response = await request("target-1", { disabled: true });
    expect(response.status).toBe(200);
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("rejects an empty patch body", async () => {
    const response = await request("target-1", {});
    expect(response.status).toBe(400);
  });

  it("returns the current user unchanged when nothing differs", async () => {
    const response = await request("target-1", { disabled: false, role: "user" });
    expect(response.status).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
