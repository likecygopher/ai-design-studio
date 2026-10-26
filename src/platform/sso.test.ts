// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  orgFindUnique: vi.fn(),
  memberUpsert: vi.fn(),
  ensureOrg: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: {
    user: {
      findFirst: mocks.userFindFirst,
      findUnique: mocks.userFindUnique,
      create: mocks.userCreate,
      update: mocks.userUpdate
    },
    organization: { findUnique: mocks.orgFindUnique },
    organizationMember: { upsert: mocks.memberUpsert }
  }
}));
vi.mock("@/src/platform/organizations", () => ({
  ensurePersonalOrganization: mocks.ensureOrg
}));
vi.mock("bcryptjs", () => ({ hash: vi.fn(async () => "hashed-password") }));

import {
  getSsoConfig,
  getSsoPublicInfo,
  provisionSsoUser,
  validateSsoEmail
} from "./sso";

const config = {
  issuer: "https://idp.example.com",
  clientId: "client",
  clientSecret: "secret",
  name: "Acme SSO",
  scopes: "openid email profile",
  allowedDomains: ["acme.com"],
  autoProvision: true,
  defaultOrgSlug: null
};

const originalEnv = { ...process.env };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.userFindFirst.mockResolvedValue(null);
  mocks.userFindUnique.mockResolvedValue(null);
  mocks.userCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "user-sso",
    email: data.email,
    name: data.name,
    role: "user",
    disabled: false,
    authVersion: 0
  }));
  mocks.userUpdate.mockResolvedValue({
    id: "user-1",
    email: "person@acme.com",
    name: "Person",
    role: "user",
    disabled: false,
    authVersion: 0
  });
  mocks.ensureOrg.mockResolvedValue("org_user-sso");
  mocks.orgFindUnique.mockResolvedValue({ id: "org-acme" });
  mocks.memberUpsert.mockResolvedValue({});
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("SSO configuration", () => {
  it("is disabled unless issuer/client/secret are all present", () => {
    delete process.env.SSO_ISSUER;
    delete process.env.SSO_CLIENT_ID;
    delete process.env.SSO_CLIENT_SECRET;
    expect(getSsoConfig()).toBeNull();
    expect(getSsoPublicInfo().enabled).toBe(false);

    process.env.SSO_ISSUER = "https://idp.example.com";
    process.env.SSO_CLIENT_ID = "client";
    process.env.SSO_CLIENT_SECRET = "secret";
    process.env.SSO_ALLOWED_DOMAINS = "acme.com, example.com";
    process.env.SSO_AUTO_PROVISION = "false";
    const loaded = getSsoConfig();
    expect(loaded).toMatchObject({
      issuer: "https://idp.example.com",
      allowedDomains: ["acme.com", "example.com"],
      autoProvision: false
    });
    expect(getSsoPublicInfo().enabled).toBe(true);
  });

  it("enforces the domain allowlist", () => {
    expect(validateSsoEmail("person@acme.com", config)).toBe(true);
    expect(validateSsoEmail("person@other.com", config)).toBe(false);
    expect(validateSsoEmail("not-an-email", config)).toBe(false);
  });
});

describe("provisionSsoUser", () => {
  it("returns an existing account linked by subject", async () => {
    mocks.userFindFirst.mockResolvedValue({
      id: "user-1",
      email: "person@acme.com",
      name: "Person",
      role: "user",
      disabled: false,
      authVersion: 2
    });
    const result = await provisionSsoUser(
      { subject: "sub-1", email: "person@acme.com" },
      config
    );
    expect(result.user.id).toBe("user-1");
    expect(result.created).toBe(false);
  });

  it("links an existing email account", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      email: "person@acme.com",
      name: "Person",
      role: "user",
      disabled: false,
      authVersion: 0
    });
    const result = await provisionSsoUser(
      { subject: "sub-2", email: "person@acme.com", name: "Person" },
      config
    );
    expect(result.created).toBe(false);
    expect(mocks.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ssoProvider: "enterprise-sso", ssoSubject: "sub-2" })
      })
    );
  });

  it("auto-provisions a new user with a personal organization", async () => {
    const result = await provisionSsoUser(
      { subject: "sub-3", email: "new@acme.com", name: "New Person" },
      config
    );
    expect(result.created).toBe(true);
    expect(mocks.userCreate.mock.calls[0][0].data).toMatchObject({
      email: "new@acme.com",
      ssoProvider: "enterprise-sso",
      ssoSubject: "sub-3"
    });
    expect(mocks.ensureOrg).toHaveBeenCalledWith("user-sso");
  });

  it("rejects unknown users when auto-provisioning is disabled", async () => {
    await expect(
      provisionSsoUser(
        { subject: "sub-4", email: "new@acme.com" },
        { ...config, autoProvision: false }
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects domains outside the allowlist and disabled accounts", async () => {
    await expect(
      provisionSsoUser({ subject: "sub-5", email: "person@evil.com" }, config)
    ).rejects.toMatchObject({ status: 403 });

    mocks.userFindFirst.mockResolvedValue({
      id: "user-1",
      email: "person@acme.com",
      role: "user",
      disabled: true,
      authVersion: 0
    });
    await expect(
      provisionSsoUser({ subject: "sub-1", email: "person@acme.com" }, config)
    ).rejects.toMatchObject({ status: 403 });
  });
});
