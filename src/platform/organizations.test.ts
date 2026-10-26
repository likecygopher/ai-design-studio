// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  orgUpsert: vi.fn(),
  orgFindUnique: vi.fn(),
  orgUpdate: vi.fn(),
  memberUpsert: vi.fn(),
  memberFindUnique: vi.fn(),
  memberFindMany: vi.fn(),
  memberFindFirst: vi.fn(),
  memberCreate: vi.fn(),
  memberUpdate: vi.fn(),
  memberDelete: vi.fn(),
  memberCount: vi.fn(),
  userUpdateMany: vi.fn(),
  orgDelete: vi.fn(),
  transaction: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      update: mocks.userUpdate,
      updateMany: mocks.userUpdateMany
    },
    organization: {
      upsert: mocks.orgUpsert,
      findUnique: mocks.orgFindUnique,
      update: mocks.orgUpdate,
      delete: mocks.orgDelete
    },
    $transaction: mocks.transaction,
    organizationMember: {
      upsert: mocks.memberUpsert,
      findUnique: mocks.memberFindUnique,
      findMany: mocks.memberFindMany,
      findFirst: mocks.memberFindFirst,
      create: mocks.memberCreate,
      update: mocks.memberUpdate,
      delete: mocks.memberDelete,
      count: mocks.memberCount
    }
  }
}));

import {
  addOrganizationMember,
  archiveOrganization,
  deleteOrganization,
  ensurePersonalOrganization,
  getOrganizationOverview,
  removeOrganizationMember,
  switchOrganization
} from "./organizations";

const now = new Date("2026-01-01T00:00:00.000Z");

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.userFindUnique.mockResolvedValue({
    id: "user-1",
    name: "Demo",
    email: "demo@example.com",
    organizationId: null
  });
  mocks.userUpdate.mockResolvedValue({});
  mocks.orgUpsert.mockResolvedValue({ id: "org_user-1", name: "Demo" });
  mocks.memberUpsert.mockResolvedValue({});
  mocks.orgFindUnique.mockResolvedValue({
    id: "org_user-1",
    name: "Demo",
    slug: "personal-user-1",
    createdAt: now
  });
  mocks.memberFindUnique.mockResolvedValue({
    id: "m-1",
    organizationId: "org_user-1",
    userId: "user-1",
    role: "owner"
  });
  mocks.memberFindMany.mockImplementation(async (args: { include?: unknown }) =>
    args?.include && "user" in (args.include as object)
      ? [
          {
            id: "m-1",
            userId: "user-1",
            role: "owner",
            createdAt: now,
            user: { email: "demo@example.com", name: "Demo" }
          }
        ]
      : [
          {
            id: "m-1",
            role: "owner",
            organization: { id: "org_user-1", name: "Demo", slug: "personal-user-1" }
          }
        ]
  );
  mocks.memberFindFirst.mockResolvedValue({ id: "m-1", role: "owner", userId: "user-1" });
  mocks.memberCreate.mockResolvedValue({ id: "m-2", role: "member", createdAt: now });
  mocks.memberCount.mockResolvedValue(2);
  mocks.orgUpdate.mockResolvedValue({});
  mocks.orgDelete.mockResolvedValue({});
  mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (operations: unknown[]) => Promise.all(operations));
});

describe("organizations", () => {
  it("creates a personal organization and active pointer", async () => {
    mocks.memberFindUnique.mockResolvedValue(null);
    const orgId = await ensurePersonalOrganization("user-1");
    expect(orgId).toBe("org_user-1");
    expect(mocks.memberUpsert).toHaveBeenCalled();
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { organizationId: "org_user-1" }
    });
  });

  it("returns overview with members and memberships", async () => {
    const overview = await getOrganizationOverview("user-1");
    expect(overview.organization?.name).toBe("Demo");
    expect(overview.members[0].email).toBe("demo@example.com");
    expect(overview.role).toBe("owner");
  });

  it("adds an existing user by email", async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      id: "user-1",
      name: "Demo",
      email: "demo@example.com",
      organizationId: "org_user-1"
    });
    mocks.memberFindUnique
      .mockResolvedValueOnce({ id: "m-1", role: "owner" })
      .mockResolvedValueOnce({ id: "m-1", role: "owner" })
      .mockResolvedValueOnce(null);
    mocks.userFindUnique.mockResolvedValueOnce({
      id: "user-2",
      email: "member@example.com",
      name: "Member",
      disabled: false
    });
    const member = await addOrganizationMember("user-1", "member@example.com", "member");
    expect(member.userId).toBe("user-2");
  });

  it("does not remove the last owner", async () => {
    mocks.memberCount.mockResolvedValue(1);
    await expect(removeOrganizationMember("user-1", "m-1")).rejects.toMatchObject({
      status: 409
    });
  });

  it("forbids switching to an organization without membership", async () => {
    mocks.memberFindUnique.mockResolvedValue(null);
    await expect(switchOrganization("user-1", "org-other")).rejects.toMatchObject({
      status: 403
    });
  });
});

describe("organization archive/delete", () => {
  it("forbids archiving the personal organization", async () => {
    await expect(archiveOrganization("user-1")).rejects.toMatchObject({ status: 409 });
  });

  it("archives a shared organization owned by the caller", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      name: "Demo",
      email: "demo@example.com",
      organizationId: "org-acme"
    });
    await archiveOrganization("user-1");
    expect(mocks.orgUpdate).toHaveBeenCalledWith({
      where: { id: "org-acme" },
      data: { archivedAt: expect.any(Date) }
    });
  });

  it("requires the exact organization name before deletion", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      name: "Demo",
      email: "demo@example.com",
      organizationId: "org-acme"
    });
    mocks.orgFindUnique.mockResolvedValue({ id: "org-acme", name: "Acme" });
    await expect(deleteOrganization("user-1", "Wrong")).rejects.toMatchObject({
      status: 409
    });
  });

  it("deletes a shared organization and clears active pointers", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      name: "Demo",
      email: "demo@example.com",
      organizationId: "org-acme"
    });
    mocks.orgFindUnique.mockResolvedValue({ id: "org-acme", name: "Acme" });
    await deleteOrganization("user-1", "Acme");
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-acme" },
      data: { organizationId: null }
    });
    expect(mocks.transaction).toHaveBeenCalled();
  });
});
