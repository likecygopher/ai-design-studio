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

import { setRateLimiter } from "@/src/platform/api";
import { MemoryRateLimiter } from "@/src/platform/rate-limit";
import { GET } from "./route";

function request(query = "") {
  return GET(new Request(`http://localhost/api/admin/audit/export${query}`));
}

beforeEach(() => {
  setRateLimiter(new MemoryRateLimiter());
  mocks.getSessionUser.mockReset().mockResolvedValue({ id: "admin-1", role: "admin" });
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
  mocks.findMany.mockReset().mockResolvedValue([
    {
      id: "audit-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      action: "admin.user.update",
      actorRole: "admin",
      userId: "admin-1",
      targetType: "user",
      targetId: "user-1",
      ip: "127.0.0.1",
      requestId: "req_1",
      metadata: { note: 'value,with "comma"' },
      user: { email: "admin@example.com" }
    }
  ]);
});

describe("GET /api/admin/audit/export", () => {
  it("returns a CSV attachment with escaped metadata", async () => {
    const response = await request("?action=admin.user.update&limit=10");
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(text).toContain("createdAt,action,actorRole,userEmail");
    expect(text).toContain("2026-01-01T00:00:00.000Z,admin.user.update");
    expect(text).toContain('"{""note"":""value,with \\""comma\\""""}"');
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.audit_export" })
    );
  });

  it("rejects non-admin callers", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u", role: "user" });
    expect((await request()).status).toBe(403);
  });

  it("rejects invalid query parameters", async () => {
    expect((await request("?limit=99999")).status).toBe(400);
  });
});
