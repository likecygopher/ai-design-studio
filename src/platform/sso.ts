import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { prisma } from "@/src/platform/db";
import { ForbiddenError } from "@/src/platform/errors";
import { ensurePersonalOrganization } from "@/src/platform/organizations";

/**
 * Enterprise SSO via a single OIDC provider (Azure AD / Okta / Keycloak /
 * Google Workspace / ...). Configuration is environment-based so secrets never
 * enter the client bundle; the login page only receives enabled + display name.
 */

export const SSO_PROVIDER_ID = "enterprise-sso";

export type SsoConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  name: string;
  scopes: string;
  allowedDomains: string[];
  autoProvision: boolean;
  defaultOrgSlug: string | null;
};

export function getSsoConfig(): SsoConfig | null {
  const issuer = process.env.SSO_ISSUER?.trim();
  const clientId = process.env.SSO_CLIENT_ID?.trim();
  const clientSecret = process.env.SSO_CLIENT_SECRET?.trim();
  if (!issuer || !clientId || !clientSecret) {
    return null;
  }
  return {
    issuer,
    clientId,
    clientSecret,
    name: process.env.SSO_NAME?.trim() || "Enterprise SSO",
    scopes: process.env.SSO_SCOPES?.trim() || "openid email profile",
    allowedDomains: (process.env.SSO_ALLOWED_DOMAINS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
    autoProvision: process.env.SSO_AUTO_PROVISION !== "false",
    defaultOrgSlug: process.env.SSO_DEFAULT_ORG_SLUG?.trim() || null
  };
}

export function getSsoPublicInfo(): { enabled: boolean; name: string } {
  const config = getSsoConfig();
  return { enabled: Boolean(config), name: config?.name ?? "Enterprise SSO" };
}

export function validateSsoEmail(email: string, config: SsoConfig): boolean {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return false;
  }
  if (config.allowedDomains.length === 0) {
    return true;
  }
  const domain = normalized.split("@")[1] ?? "";
  return config.allowedDomains.includes(domain);
}

export type ProvisionedSsoUser = {
  user: { id: string; email: string; name: string | null; role: string; disabled: boolean; authVersion: number };
  created: boolean;
};

/**
 * Find/link/provision the local account for an OIDC identity. Existing email
 * accounts are linked to the SSO subject; unknown emails are auto-provisioned
 * when enabled (otherwise login is rejected).
 */
export async function provisionSsoUser(
  input: { subject: string; email: string; name?: string | null },
  config: SsoConfig
): Promise<ProvisionedSsoUser> {
  const email = input.email.trim().toLowerCase();
  if (!validateSsoEmail(email, config)) {
    throw new ForbiddenError("该企业账号不在允许的域名范围内。");
  }
  const subject = input.subject.trim();
  if (!subject) {
    throw new ForbiddenError("SSO 身份缺少 subject。");
  }

  const bySubject = await prisma.user.findFirst({
    where: { ssoProvider: SSO_PROVIDER_ID, ssoSubject: subject }
  });
  if (bySubject) {
    if (bySubject.disabled) throw new ForbiddenError("账号已被禁用。");
    if (bySubject.email !== email) {
      await prisma.user.update({ where: { id: bySubject.id }, data: { email } }).catch(() => undefined);
    }
    return { user: bySubject, created: false };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.disabled) throw new ForbiddenError("账号已被禁用。");
    const linked = await prisma.user.update({
      where: { id: existing.id },
      data: {
        ssoProvider: SSO_PROVIDER_ID,
        ssoSubject: subject,
        name: existing.name ?? input.name ?? null
      }
    });
    if (config.defaultOrgSlug) {
      await attachDefaultOrganization(linked.id, config.defaultOrgSlug);
    }
    return { user: linked, created: false };
  }

  if (!config.autoProvision) {
    throw new ForbiddenError("该企业账号尚未开通，请联系管理员。");
  }

  const passwordHash = await hash(randomBytes(32).toString("base64url"), 12);
  const user = await prisma.user.create({
    data: {
      email,
      name: input.name?.trim() || email.split("@")[0],
      passwordHash,
      ssoProvider: SSO_PROVIDER_ID,
      ssoSubject: subject,
      settings: { create: { country: "Mexico", language: "Spanish" } }
    }
  });
  await ensurePersonalOrganization(user.id).catch(() => undefined);
  if (config.defaultOrgSlug) {
    await attachDefaultOrganization(user.id, config.defaultOrgSlug);
  }
  return { user, created: true };
}

async function attachDefaultOrganization(userId: string, slug: string): Promise<void> {
  const organization = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true }
  });
  if (!organization) {
    return;
  }
  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: { organizationId: organization.id, userId }
    },
    create: { organizationId: organization.id, userId, role: "member" },
    update: {}
  });
  await prisma.user.update({
    where: { id: userId },
    data: { organizationId: organization.id }
  });
}
