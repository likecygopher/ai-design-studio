// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configFindUnique: vi.fn(),
  configFindMany: vi.fn(),
  configUpsert: vi.fn(),
  orgFindUnique: vi.fn(),
  overview: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: {
    organizationSsoConfig: {
      findUnique: mocks.configFindUnique,
      findMany: mocks.configFindMany,
      upsert: mocks.configUpsert
    },
    organization: { findUnique: mocks.orgFindUnique }
  }
}));
vi.mock("@/src/platform/organizations", () => ({
  getOrganizationOverview: mocks.overview
}));
vi.mock("@/src/platform/secrets", () => ({
  encryptSecret: (value: string) => `enc:${value}`,
  decryptSecret: (value: string) => value.replace(/^enc:/, "")
}));

import {
  getOrganizationSsoConfig,
  hashScimToken,
  resolveOrganizationSso,
  resolveRoleFromGroups,
  saveOrganizationSsoConfig,
  verifyScimToken
} from "./organization-sso";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.overview.mockResolvedValue({
    organization: { id: "org-1", name: "Acme", slug: "acme" },
    role: "owner",
    members: [],
    organizations: [],
    personalOrganizationId: "org_user",
    canDelete: true
  });
  mocks.configFindUnique.mockResolvedValue(null);
  mocks.configFindMany.mockResolvedValue([]);
  mocks.configUpsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({
    ...create,
    displayName: create.displayName ?? null,
    allowedDomains: create.allowedDomains ?? [],
    groupRoleMap: create.groupRoleMap ?? {}
  }));
});

describe("organization SSO config", () => {
  it("maps IdP groups to the highest-privilege role", () => {
    const map = { "acme-admins": "admin", "acme-owners": "owner" };
    expect(resolveRoleFromGroups(["acme-admins"], map, "member")).toBe("admin");
    expect(resolveRoleFromGroups(["acme-admins", "acme-owners"], map, "member")).toBe("owner");
    expect(resolveRoleFromGroups([], map, "member")).toBe("member");
    expect(resolveRoleFromGroups(["unknown"], map, "member")).toBe("member");
  });

  it("does not enable OIDC without issuer/client id", async () => {
    await expect(
      saveOrganizationSsoConfig("user-1", {
        enabled: true,
        protocol: "oidc",
        oidcClientId: "client"
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("encrypts the OIDC secret and masks it in the view", async () => {
    const view = await saveOrganizationSsoConfig("user-1", {
      enabled: true,
      protocol: "oidc",
      oidcIssuer: "https://idp.example.com",
      oidcClientId: "client",
      oidcClientSecret: "secret"
    });
    expect(view.hasOidcClientSecret).toBe(true);
    expect(JSON.stringify(view)).not.toContain("secret");
    expect(mocks.configUpsert.mock.calls[0][0].create.oidcClientSecretCipher).toBe("enc:secret");
  });

  it("returns null when no config exists", async () => {
    expect(await getOrganizationSsoConfig("user-1")).toBeNull();
  });

  it("verifies SCIM tokens against the stored hash", () => {
    const token = "scim_test-token";
    const hash = hashScimToken(token);
    expect(verifyScimToken(token, hash)).toBe(true);
    expect(verifyScimToken("other", hash)).toBe(false);
    expect(verifyScimToken(token, null)).toBe(false);
  });

  it("resolves an enabled organization by slug", async () => {
    mocks.orgFindUnique.mockResolvedValue({ id: "org-1", name: "Acme", slug: "acme" });
    mocks.configFindUnique.mockResolvedValue({
      organizationId: "org-1",
      enabled: true,
      protocol: "oidc",
      allowedDomains: ["acme.com"]
    });
    const resolved = await resolveOrganizationSso({ slug: "acme" });
    expect(resolved?.organization.slug).toBe("acme");
  });
});
