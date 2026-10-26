// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  recordAudit: vi.fn(),
  findMany: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/src/platform/db", () => ({
  prisma: { auditLog: { findMany: mocks.findMany } }
}));

import { GET } from "./route";

const adminSession = { id: "admin-1", email: "admin@example.com", role: "admin" };
const createdAt = new Date("2026-01-01T00:00:00.000Z");

function logRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "audit-1",
    action: "auth.login",
    actorRole: "admin",
    userId: "admin-1",
    targetType: "user",
    targetId: "admin-1",
    metadata: { ok: true },
    ip: "127.0.0.1",
    requestId: "req_1",
    createdAt,
    user: { email: "admin@example.com" },
    ...overrides
  };
}

beforeEach(() => {
  mocks.getSessionUser.mockReset().mockResolvedValue(adminSession);
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
  mocks.findMany.mockReset().mockImplementation(async (args: Record<string, unknown>) => {
    if (args.distinct) {
      return [{ action: "auth.login" }, { action: "job.enqueue" }];
    }
    return [logRow()];
  });
});

describe("GET /api/admin/audit", () => {
  it("requires admin", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u", role: "user" });
    const response = await GET(new Request("http://localhost/api/admin/audit"));
    expect(response.status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("returns audit logs, distinct actions and pagination state", async () => {
    const response = await GET(new Request("http://localhost/api/admin/audit?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0]).toMatchObject({
      id: "audit-1",
      action: "auth.login",
      userEmail: "admin@example.com",
      createdAt: createdAt.toISOString()
    });
    expect(body.actions).toEqual(["auth.login", "job.enqueue"]);
    expect(body.nextCursor).toBeNull();
    expect(mocks.recordAudit.mock.calls[0][0].action).toBe("admin.audit.list");
  });

  it("filters by action and query", async () => {
    await GET(
      new Request("http://localhost/api/admin/audit?action=job.cancel&q=admin")
    );
    const logQuery = mocks.findMany.mock.calls.find(
      (call) => !(call[0] as Record<string, unknown>).distinct
    )![0] as Record<string, unknown>;

    expect(logQuery.where).toMatchObject({
      action: "job.cancel",
      OR: expect.arrayContaining([
        { user: { email: { contains: "admin", mode: "insensitive" } } }
      ])
    });
  });

  it("returns a cursor when more rows exist", async () => {
    mocks.findMany.mockImplementation(async (args: Record<string, unknown>) => {
      if (args.distinct) {
        return [];
      }
      return [logRow(), logRow({ id: "audit-2" })];
    });

    const response = await GET(new Request("http://localhost/api/admin/audit?limit=1"));
    const body = await response.json();
    expect(body.logs).toHaveLength(1);
    expect(body.nextCursor).toBe("audit-1");
  });

  it("rejects an out-of-range limit", async () => {
    const response = await GET(new Request("http://localhost/api/admin/audit?limit=500"));
    expect(response.status).toBe(400);
  });
});
