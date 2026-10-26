// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  recordAudit: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  groupBy: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/src/platform/db", () => ({
  prisma: {
    user: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      create: mocks.create
    },
    costRecord: { groupBy: mocks.groupBy }
  }
}));

import { GET, POST } from "./route";

const adminSession = { id: "admin-1", email: "admin@example.com", role: "admin" };
const userSession = { id: "user-1", email: "user@example.com", role: "user" };

const createdAt = new Date("2026-01-01T00:00:00.000Z");
const updatedAt = new Date("2026-01-02T00:00:00.000Z");

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    email: "u1@example.com",
    name: "U1",
    role: "user",
    disabled: false,
    createdAt,
    updatedAt,
    _count: { products: 2, assets: 3, jobs: 4 },
    ...overrides
  };
}

function request(query = "", init?: RequestInit) {
  return new Request(`http://localhost/api/admin/users${query}`, init);
}

function createRequest(body: unknown) {
  return new Request("http://localhost/api/admin/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  mocks.getSessionUser.mockReset().mockResolvedValue(adminSession);
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
  mocks.findMany.mockReset().mockResolvedValue([]);
  mocks.groupBy.mockReset().mockResolvedValue([]);
  mocks.findUnique.mockReset().mockResolvedValue(null);
  mocks.create.mockReset().mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    listRow({
      id: "new-user",
      email: data.email,
      name: data.name,
      role: data.role,
      _count: undefined
    })
  );
});

describe("GET /api/admin/users", () => {
  it("rejects anonymous callers with 401", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(request());
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("AUTH_REQUIRED");
  });

  it("rejects non-admin users with 403", async () => {
    mocks.getSessionUser.mockResolvedValue(userSession);

    const response = await GET(request());
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("FORBIDDEN");
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("returns a page of users without password hashes, including account state", async () => {
    mocks.findMany.mockResolvedValue([listRow()]);
    mocks.groupBy.mockResolvedValue([{ userId: "u1", _sum: { estimatedUnits: 7 } }]);

    const response = await GET(request("?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.users).toEqual([
      {
        id: "u1",
        email: "u1@example.com",
        name: "U1",
        role: "user",
        disabled: false,
        monthlyBudgetUnits: null,
        requiresJobApproval: false,
        planId: null,
        planName: null,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        counts: { products: 2, assets: 3, jobs: 4 }
      }
    ]);
    expect(body.nextCursor).toBeNull();
    expect(body.usage).toEqual({ u1: 7 });
    expect(body.defaultBudgetUnits).toBeNull();
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.user.list" })
    );
  });

  it("filters by role and search term", async () => {
    mockSearch();

    await GET(request("?q=midea&role=admin"));

    const args = mocks.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      role: "admin",
      OR: [
        { email: { contains: "midea", mode: "insensitive" } },
        { name: { contains: "midea", mode: "insensitive" } }
      ]
    });
  });

  it("returns a cursor when more rows exist", async () => {
    mocks.findMany.mockResolvedValue([
      listRow({ id: "u1" }),
      listRow({ id: "u2", email: "b@x.com" })
    ]);

    const response = await GET(request("?limit=1"));
    const body = await response.json();

    expect(body.users).toHaveLength(1);
    expect(body.nextCursor).toBe("u1");
  });

  it("rejects an out-of-range limit", async () => {
    const response = await GET(request("?limit=1000"));
    expect(response.status).toBe(400);
  });

  it("rejects an unknown role filter", async () => {
    const response = await GET(request("?role=owner"));
    expect(response.status).toBe(400);
  });
});

describe("POST /api/admin/users", () => {
  it("rejects non-admin callers", async () => {
    mocks.getSessionUser.mockResolvedValue(userSession);
    const response = await POST(createRequest({ email: "new@example.com" }));
    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates a user with an explicit password and lower-cased email", async () => {
    const response = await POST(
      createRequest({
        email: "  New.User@Example.COM ",
        password: "StrongPass1",
        name: "New User",
        role: "user"
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.temporaryPassword).toBeUndefined();
    expect(body.user).toMatchObject({ email: "new.user@example.com", role: "user" });
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.user.create",
        metadata: { role: "user", generatedPassword: false }
      })
    );
  });

  it("returns a one-time temporary password when none is supplied", async () => {
    const response = await POST(createRequest({ email: "temp@example.com" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(typeof body.temporaryPassword).toBe("string");
    expect(body.temporaryPassword.length).toBeGreaterThanOrEqual(8);
    expect(body.temporaryPassword).toMatch(/[A-Za-z]/);
    expect(body.temporaryPassword).toMatch(/\d/);
    // The password is returned once but never audited/logged.
    expect(JSON.stringify(mocks.recordAudit.mock.calls)).not.toContain(body.temporaryPassword);
  });

  it("rejects a weak explicit password", async () => {
    const response = await POST(createRequest({ email: "weak@example.com", password: "short" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid role", async () => {
    const response = await POST(
      createRequest({ email: "role@example.com", role: "owner", password: "StrongPass1" })
    );
    expect(response.status).toBe(400);
  });

  it("rejects an existing email with 409 EMAIL_TAKEN", async () => {
    mocks.findUnique.mockResolvedValue({ id: "existing" });

    const response = await POST(
      createRequest({ email: "dupe@example.com", password: "StrongPass1" })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("EMAIL_TAKEN");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

function mockSearch() {
  mocks.findMany.mockResolvedValue([]);
}
