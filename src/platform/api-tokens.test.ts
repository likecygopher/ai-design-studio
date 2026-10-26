// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: {
    apiToken: {
      create: mocks.create,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
      update: mocks.update
    }
  }
}));

import {
  authenticateApiToken,
  createApiToken,
  generateApiToken,
  hashApiToken,
  listApiTokens,
  revokeApiToken
} from "./api-tokens";

const createdAt = new Date("2026-01-01T00:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "token-1",
    userId: "user-1",
    name: "CI",
    prefix: "mcs_abcd1234",
    tokenHash: "hash",
    scopes: ["read", "write"],
    lastUsedAt: null,
    expiresAt: null,
    createdAt,
    revokedAt: null,
    ...overrides
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    row({ ...data, id: "token-new", createdAt })
  );
  mocks.findMany.mockResolvedValue([]);
  mocks.findUnique.mockResolvedValue(null);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.update.mockResolvedValue({});
});

describe("token generation", () => {
  it("creates prefixed tokens and a stable SHA-256 hash", () => {
    const first = generateApiToken();
    const second = generateApiToken();
    expect(first.token.startsWith("mcs_")).toBe(true);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(hashApiToken(first.token));
    expect(first.tokenHash).toHaveLength(64);
    expect(first.token).not.toContain(first.tokenHash);
  });
});

describe("createApiToken / listApiTokens", () => {
  it("stores only the hash and returns the plaintext once", async () => {
    const result = await createApiToken("user-1", { name: "CI" });
    expect(result.token.startsWith("mcs_")).toBe(true);
    const data = mocks.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashApiToken(result.token));
    expect(JSON.stringify(data)).not.toContain(result.token);
    expect(data.scopes).toEqual(["read", "write"]);
    expect(result.view.prefix).toBe(result.token.slice(0, 12));
  });

  it("stores the requested scopes", async () => {
    await createApiToken("user-1", { name: "reader", scopes: ["read"] });
    expect(mocks.create.mock.calls[0][0].data.scopes).toEqual(["read"]);
  });

  it("maps stored rows to views without hashes", async () => {
    mocks.findMany.mockResolvedValue([row({ tokenHash: "secret-hash" })]);
    const views = await listApiTokens("user-1");
    expect(views[0]).toMatchObject({ id: "token-1", name: "CI", scopes: ["read", "write"] });
    expect(JSON.stringify(views)).not.toContain("secret-hash");
  });

  it("revokes only the caller's active token", async () => {
    await expect(revokeApiToken("user-1", "token-1")).resolves.toBe(true);
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(revokeApiToken("user-1", "missing")).resolves.toBe(false);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "missing", userId: "user-1", revokedAt: null } })
    );
  });
});

describe("authenticateApiToken", () => {
  it("returns the owner and role for an active token", async () => {
    mocks.findUnique.mockResolvedValue({
      ...row(),
      user: { id: "user-1", role: "admin", disabled: false }
    });

    const auth = await authenticateApiToken("mcs_abc");
    expect(auth).toMatchObject({ userId: "user-1", role: "admin", tokenId: "token-1" });
    expect(mocks.update).toHaveBeenCalled();
  });

  it("rejects malformed, revoked, expired, and disabled-owner tokens", async () => {
    expect(await authenticateApiToken("not-a-token")).toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();

    mocks.findUnique.mockResolvedValue({
      ...row({ revokedAt: new Date() }),
      user: { id: "user-1", role: "user", disabled: false }
    });
    expect(await authenticateApiToken("mcs_x")).toBeNull();

    mocks.findUnique.mockResolvedValue({
      ...row({ expiresAt: new Date(Date.now() - 1000) }),
      user: { id: "user-1", role: "user", disabled: false }
    });
    expect(await authenticateApiToken("mcs_x")).toBeNull();

    mocks.findUnique.mockResolvedValue({
      ...row(),
      user: { id: "user-1", role: "user", disabled: true }
    });
    expect(await authenticateApiToken("mcs_x")).toBeNull();
  });
});
