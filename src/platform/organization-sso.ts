import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/src/platform/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/src/platform/errors";
import { getOrganizationOverview } from "@/src/platform/organizations";
import { decryptSecret, encryptSecret } from "@/src/platform/secrets";

/** Per-organization identity provider configuration + SCIM token management. */

export const SSO_PROTOCOLS = ["oidc", "saml"] as const;
export type SsoProtocol = (typeof SSO_PROTOCOLS)[number];
export const ORG_ROLE_VALUES = ["owner", "admin", "member"] as const;

export type OrganizationSsoConfigView = {
  organizationId: string;
  enabled: boolean;
  protocol: SsoProtocol;
  displayName: string | null;
  oidcIssuer: string | null;
  oidcClientId: string | null;
  hasOidcClientSecret: boolean;
  samlEntryPoint: string | null;
  samlIssuer: string | null;
  samlCert: string | null;
  allowedDomains: string[];
  autoProvision: boolean;
  defaultRole: string;
  groupRoleMap: Record<string, string>;
  scimEnabled: boolean;
  hasScimToken: boolean;
  scimTokenPrefix: string | null;
};

export type OrganizationSsoConfigInput = {
  enabled: boolean;
  protocol: SsoProtocol;
  displayName?: string | null;
  oidcIssuer?: string | null;
  oidcClientId?: string | null;
  oidcClientSecret?: string | null;
  samlEntryPoint?: string | null;
  samlIssuer?: string | null;
  samlCert?: string | null;
  allowedDomains?: string[];
  autoProvision?: boolean;
  defaultRole?: string;
  groupRoleMap?: Record<string, string>;
  scimEnabled?: boolean;
};

type ConfigRow = {
  organizationId: string;
  enabled: boolean;
  protocol: string;
  displayName: string | null;
  oidcIssuer: string | null;
  oidcClientId: string | null;
  oidcClientSecretCipher: string | null;
  samlEntryPoint: string | null;
  samlIssuer: string | null;
  samlCert: string | null;
  allowedDomains: unknown;
  autoProvision: boolean;
  defaultRole: string;
  groupRoleMap: unknown;
  scimEnabled: boolean;
  scimTokenHash: string | null;
  scimTokenPrefix: string | null;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asRoleMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const map: Record<string, string> = {};
  for (const [key, role] of Object.entries(value as Record<string, unknown>)) {
    if (typeof role === "string" && ORG_ROLE_VALUES.includes(role as never)) {
      map[key] = role;
    }
  }
  return map;
}

export function toOrganizationSsoView(row: ConfigRow): OrganizationSsoConfigView {
  return {
    organizationId: row.organizationId,
    enabled: row.enabled,
    protocol: row.protocol === "saml" ? "saml" : "oidc",
    displayName: row.displayName,
    oidcIssuer: row.oidcIssuer,
    oidcClientId: row.oidcClientId,
    hasOidcClientSecret: Boolean(row.oidcClientSecretCipher),
    samlEntryPoint: row.samlEntryPoint,
    samlIssuer: row.samlIssuer,
    samlCert: row.samlCert,
    allowedDomains: asStringArray(row.allowedDomains),
    autoProvision: row.autoProvision,
    defaultRole: row.defaultRole,
    groupRoleMap: asRoleMap(row.groupRoleMap),
    scimEnabled: row.scimEnabled,
    hasScimToken: Boolean(row.scimTokenHash),
    scimTokenPrefix: row.scimTokenPrefix
  };
}

async function activeManager(userId: string): Promise<{ organizationId: string; role: string }> {
  const overview = await getOrganizationOverview(userId);
  if (!overview.organization) throw new NotFoundError("当前没有组织。");
  if (overview.role !== "owner" && overview.role !== "admin") {
    throw new ForbiddenError("只有组织 owner/admin 可以配置 SSO。");
  }
  return { organizationId: overview.organization.id, role: overview.role };
}

export async function getOrganizationSsoConfig(userId: string): Promise<OrganizationSsoConfigView | null> {
  const { organizationId } = await activeManager(userId);
  const row = await prisma.organizationSsoConfig.findUnique({ where: { organizationId } });
  return row ? toOrganizationSsoView(row) : null;
}

export async function saveOrganizationSsoConfig(
  userId: string,
  input: OrganizationSsoConfigInput
): Promise<OrganizationSsoConfigView> {
  const { organizationId } = await activeManager(userId);
  if (input.enabled) {
    if (input.protocol === "oidc" && (!input.oidcIssuer || !input.oidcClientId)) {
      throw new ConflictError("启用 OIDC 需要 issuer 与 client id。");
    }
    if (input.protocol === "saml" && (!input.samlEntryPoint || !input.samlIssuer || !input.samlCert)) {
      throw new ConflictError("启用 SAML 需要 entry point、issuer 与签名证书。");
    }
  }
  const existing = await prisma.organizationSsoConfig.findUnique({ where: { organizationId } });
  const secretCipher = input.oidcClientSecret?.trim()
    ? encryptSecret(input.oidcClientSecret.trim())
    : existing?.oidcClientSecretCipher ?? null;

  const row = await prisma.organizationSsoConfig.upsert({
    where: { organizationId },
    create: {
      organizationId,
      enabled: input.enabled,
      protocol: input.protocol,
      displayName: input.displayName?.trim() || null,
      oidcIssuer: input.oidcIssuer?.trim() || null,
      oidcClientId: input.oidcClientId?.trim() || null,
      oidcClientSecretCipher: secretCipher,
      samlEntryPoint: input.samlEntryPoint?.trim() || null,
      samlIssuer: input.samlIssuer?.trim() || null,
      samlCert: input.samlCert?.trim() || null,
      allowedDomains: (input.allowedDomains ?? []).map((domain) => domain.trim().toLowerCase()).filter(Boolean),
      autoProvision: input.autoProvision ?? true,
      defaultRole: input.defaultRole ?? "member",
      groupRoleMap: input.groupRoleMap ?? {},
      scimEnabled: input.scimEnabled ?? false
    },
    update: {
      enabled: input.enabled,
      protocol: input.protocol,
      displayName: input.displayName?.trim() || null,
      oidcIssuer: input.oidcIssuer?.trim() || null,
      oidcClientId: input.oidcClientId?.trim() || null,
      ...(input.oidcClientSecret?.trim()
        ? { oidcClientSecretCipher: encryptSecret(input.oidcClientSecret.trim()) }
        : {}),
      samlEntryPoint: input.samlEntryPoint?.trim() || null,
      samlIssuer: input.samlIssuer?.trim() || null,
      samlCert: input.samlCert?.trim() || null,
      allowedDomains: (input.allowedDomains ?? []).map((domain) => domain.trim().toLowerCase()).filter(Boolean),
      autoProvision: input.autoProvision ?? true,
      defaultRole: input.defaultRole ?? "member",
      groupRoleMap: input.groupRoleMap ?? {},
      scimEnabled: input.scimEnabled ?? false
    }
  });
  return toOrganizationSsoView(row);
}

export function hashScimToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function rotateScimToken(
  userId: string
): Promise<{ token: string; prefix: string }> {
  const { organizationId } = await activeManager(userId);
  const token = `scim_${randomBytes(24).toString("base64url")}`;
  const prefix = token.slice(0, 12);
  await prisma.organizationSsoConfig.upsert({
    where: { organizationId },
    create: {
      organizationId,
      scimEnabled: true,
      scimTokenHash: hashScimToken(token),
      scimTokenPrefix: prefix
    },
    update: {
      scimEnabled: true,
      scimTokenHash: hashScimToken(token),
      scimTokenPrefix: prefix
    }
  });
  return { token, prefix };
}

export async function getOrganizationConfigById(organizationId: string) {
  return prisma.organizationSsoConfig.findUnique({ where: { organizationId } });
}

export function decryptOidcClientSecret(config: ConfigRow): string | null {
  if (!config.oidcClientSecretCipher) return null;
  try {
    return decryptSecret(config.oidcClientSecretCipher);
  } catch {
    return null;
  }
}

/** Map IdP groups to the highest-privilege configured organization role. */
export function resolveRoleFromGroups(
  groups: string[],
  map: unknown,
  defaultRole = "member"
): string {
  const roleMap = asRoleMap(map);
  const ranking = { member: 1, admin: 2, owner: 3 } as const;
  let resolved: keyof typeof ranking = ORG_ROLE_VALUES.includes(defaultRole as never)
    ? (defaultRole as keyof typeof ranking)
    : "member";
  for (const group of groups) {
    const role = roleMap[group];
    if (role && ranking[role as keyof typeof ranking] > ranking[resolved]) {
      resolved = role as keyof typeof ranking;
    }
  }
  return resolved;
}

/** Resolve an enabled org config by slug or email domain (public login discovery). */
export async function resolveOrganizationSso(input: {
  slug?: string;
  email?: string;
}): Promise<{ organization: { id: string; name: string; slug: string }; config: ConfigRow } | null> {
  if (input.slug) {
    const organization = await prisma.organization.findUnique({ where: { slug: input.slug } });
    if (!organization) return null;
    const config = await prisma.organizationSsoConfig.findUnique({
      where: { organizationId: organization.id }
    });
    return config?.enabled ? { organization, config } : null;
  }
  const email = input.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  const domain = email.split("@")[1] ?? "";
  const configs = await prisma.organizationSsoConfig.findMany({
    where: { enabled: true },
    include: { organization: { select: { id: true, name: true, slug: true } } }
  });
  const match = configs.find((config) => {
    const domains = asStringArray(config.allowedDomains);
    return domains.length === 0 || domains.includes(domain);
  });
  return match ? { organization: match.organization, config: match } : null;
}

export function verifyScimToken(token: string, expectedHash: string | null): boolean {
  if (!expectedHash) return false;
  const actual = Buffer.from(hashScimToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function listPublicSsoProviders(): Promise<
  Array<{ slug: string; name: string; protocol: string }>
> {
  const rows = await prisma.organizationSsoConfig.findMany({
    where: { enabled: true },
    include: { organization: { select: { slug: true, name: true } } },
    take: 50,
    orderBy: { updatedAt: "desc" }
  });
  return rows.map((row) => ({
    slug: row.organization.slug,
    name: row.displayName ?? row.organization.name,
    protocol: row.protocol
  }));
}
