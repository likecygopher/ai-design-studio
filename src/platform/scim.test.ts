// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configFindMany: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: {
    organizationSsoConfig: { findMany: mocks.configFindMany }
  }
}));
vi.mock("@/src/platform/organizations", () => ({
  ensurePersonalOrganization: vi.fn()
}));

import { authenticateScim, scimError, userResource } from "./scim";
import { hashScimToken } from "./organization-sso";

beforeEach(() => {
  mocks.configFindMany.mockReset();
});

describe("SCIM auth", () => {
  it("accepts a valid per-organization bearer token", async () => {
    const token = "scim_valid-token";
    mocks.configFindMany.mockResolvedValue([
      {
        id: "cfg-1",
        organizationId: "org-1",
        scimTokenHash: hashScimToken(token),
        defaultRole: "member",
        groupRoleMap: {}
      }
    ]);
    const context = await authenticateScim(
      new Request("http://localhost/api/scim/v2/Users", {
        headers: { authorization: `Bearer ${token}` }
      })
    );
    expect(context?.organizationId).toBe("org-1");
  });

  it("rejects missing or unknown tokens", async () => {
    mocks.configFindMany.mockResolvedValue([]);
    expect(
      await authenticateScim(new Request("http://localhost/api/scim/v2/Users"))
    ).toBeNull();
    expect(
      await authenticateScim(
        new Request("http://localhost/api/scim/v2/Users", {
          headers: { authorization: "Bearer wrong" }
        })
      )
    ).toBeNull();
  });

  it("returns SCIM-shaped errors and user resources", async () => {
    const response = scimError(401, "nope");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "nope",
      status: "401"
    });
    const resource = userResource({
      id: "m-1",
      externalId: "ext-1",
      userName: "person@acme.com",
      active: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      user: { id: "user-1", email: "person@acme.com", name: "Person", disabled: false }
    });
    expect(resource).toMatchObject({
      id: "m-1",
      userName: "person@acme.com",
      active: true,
      emails: [{ value: "person@acme.com", primary: true }]
    });
  });
});
