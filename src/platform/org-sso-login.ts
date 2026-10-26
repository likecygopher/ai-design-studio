import { createHash, randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { prisma } from "@/src/platform/db";
import { ForbiddenError, NotFoundError } from "@/src/platform/errors";
import {
  decryptOidcClientSecret,
  resolveRoleFromGroups,
  resolveOrganizationSso
} from "@/src/platform/organization-sso";
import { ensurePersonalOrganization } from "@/src/platform/organizations";

/** Organization-scoped OIDC/SAML login + one-time ticket bridge to Auth.js. */

const STATE_TTL_MS = 10 * 60 * 1000;
const TICKET_TTL_MS = 2 * 60 * 1000;
const ROLE_RANK = { member: 1, admin: 2, owner: 3 } as const;

export function sanitizeReturnTo(value: string | null | undefined, fallback = "/studio-home"): string {
  if (value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) {
    return value;
  }
  return fallback;
}

export function baseUrlFromRequest(request: Request): string {
  return (process.env.APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
}

function hashTicket(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createLoginState(input: {
  organizationId: string;
  protocol: "oidc" | "saml";
  nonce?: string | null;
  codeVerifier?: string | null;
  returnTo?: string | null;
}): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  await prisma.ssoLoginState.create({
    data: {
      id: state,
      organizationId: input.organizationId,
      protocol: input.protocol,
      nonce: input.nonce ?? null,
      codeVerifier: input.codeVerifier ?? null,
      returnTo: input.returnTo ?? null,
      expiresAt: new Date(Date.now() + STATE_TTL_MS)
    }
  });
  return state;
}

export async function consumeLoginState(
  state: string,
  protocol: "oidc" | "saml"
): Promise<{ organizationId: string; nonce: string | null; codeVerifier: string | null; returnTo: string | null }> {
  const row = await prisma.ssoLoginState.findUnique({ where: { id: state } });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now() || row.protocol !== protocol) {
    throw new ForbiddenError("SSO 登录状态无效或已过期，请重新发起登录。");
  }
  await prisma.ssoLoginState.update({ where: { id: state }, data: { usedAt: new Date() } });
  return {
    organizationId: row.organizationId,
    nonce: row.nonce,
    codeVerifier: row.codeVerifier,
    returnTo: row.returnTo
  };
}

export async function issueLoginTicket(input: {
  userId: string;
  organizationId: string;
  protocol: "oidc" | "saml";
}): Promise<{ ticket: string; returnTo: string | null }> {
  const token = `sso_${randomBytes(24).toString("base64url")}`;
  await prisma.ssoLoginTicket.create({
    data: {
      tokenHash: hashTicket(token),
      userId: input.userId,
      organizationId: input.organizationId,
      protocol: input.protocol,
      expiresAt: new Date(Date.now() + TICKET_TTL_MS)
    }
  });
  return { ticket: token, returnTo: null };
}

export async function consumeLoginTicket(
  token: string
): Promise<{ userId: string; organizationId: string | null }> {
  const row = await prisma.ssoLoginTicket.findUnique({ where: { tokenHash: hashTicket(token) } });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    throw new ForbiddenError("SSO 登录票据无效或已过期。");
  }
  await prisma.ssoLoginTicket.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return { userId: row.userId, organizationId: row.organizationId };
}

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

const discoveryCache = new Map<string, { data: Discovery; expiresAt: number }>();

export async function getOidcDiscovery(issuer: string): Promise<Discovery> {
  const cached = discoveryCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new ForbiddenError(`无法读取 OIDC 配置（HTTP ${response.status}）。`);
  }
  const data = (await response.json()) as Partial<Discovery>;
  if (
    !data.authorization_endpoint ||
    !data.token_endpoint ||
    !data.jwks_uri ||
    !data.issuer
  ) {
    throw new ForbiddenError("OIDC 发现文档不完整。");
  }
  const discovery: Discovery = {
    issuer: data.issuer,
    authorization_endpoint: data.authorization_endpoint,
    token_endpoint: data.token_endpoint,
    jwks_uri: data.jwks_uri
  };
  discoveryCache.set(issuer, { data: discovery, expiresAt: Date.now() + 10 * 60 * 1000 });
  return discovery;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export async function buildOrganizationOidcAuthorizeUrl(input: {
  organizationSlug: string;
  baseUrl: string;
  returnTo?: string | null;
}): Promise<string> {
  const resolved = await resolveOrganizationSso({ slug: input.organizationSlug });
  if (!resolved || resolved.config.protocol !== "oidc") {
    throw new NotFoundError("该组织未启用 OIDC 登录。");
  }
  const config = resolved.config;
  if (!config.oidcIssuer || !config.oidcClientId) {
    throw new ForbiddenError("OIDC 配置不完整。");
  }
  const discovery = await getOidcDiscovery(config.oidcIssuer);
  const nonce = randomBytes(16).toString("base64url");
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier)))
  );
  const state = await createLoginState({
    organizationId: resolved.organization.id,
    protocol: "oidc",
    nonce,
    codeVerifier,
    returnTo: input.returnTo ?? null
  });
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", config.oidcClientId);
  url.searchParams.set("redirect_uri", `${input.baseUrl}/api/auth/sso/oidc/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

type ExternalIdentity = {
  subject: string;
  email: string;
  name?: string | null;
  groups: string[];
};

function stringGroups(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value.split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

export async function handleOrganizationOidcCallback(input: {
  code: string;
  state: string;
  baseUrl: string;
}): Promise<{ ticket: string; returnTo: string | null; organizationSlug: string }> {
  const state = await consumeLoginState(input.state, "oidc");
  const configRow = await prisma.organizationSsoConfig.findUnique({
    where: { organizationId: state.organizationId },
    include: { organization: { select: { id: true, slug: true } } }
  });
  if (!configRow || !configRow.enabled || configRow.protocol !== "oidc") {
    throw new NotFoundError("组织 OIDC 配置不存在或已停用。");
  }
  if (!configRow.oidcIssuer || !configRow.oidcClientId) {
    throw new ForbiddenError("OIDC 配置不完整。");
  }
  const clientSecret = decryptOidcClientSecret(configRow);
  if (!clientSecret) {
    throw new ForbiddenError("OIDC client secret 不可用。");
  }
  const discovery = await getOidcDiscovery(configRow.oidcIssuer);
  const tokenResponse = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: `${input.baseUrl}/api/auth/sso/oidc/callback`,
      client_id: configRow.oidcClientId,
      client_secret: clientSecret,
      code_verifier: state.codeVerifier ?? ""
    }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!tokenResponse.ok) {
    throw new ForbiddenError(`OIDC token 交换失败（HTTP ${tokenResponse.status}）。`);
  }
  const tokens = (await tokenResponse.json()) as { id_token?: string };
  if (!tokens.id_token) {
    throw new ForbiddenError("OIDC 未返回 id_token。");
  }
  const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
  const verified = await jwtVerify(tokens.id_token, jwks, {
    issuer: discovery.issuer,
    audience: configRow.oidcClientId
  });
  if (state.nonce && verified.payload.nonce !== state.nonce) {
    throw new ForbiddenError("OIDC nonce 校验失败。");
  }
  const email =
    (typeof verified.payload.email === "string" ? verified.payload.email : "") ||
    (typeof verified.payload.preferred_username === "string"
      ? verified.payload.preferred_username
      : "");
  if (!email.includes("@")) {
    throw new ForbiddenError("IdP 未返回有效邮箱。");
  }
  const identity: ExternalIdentity = {
    subject: String(verified.payload.sub ?? ""),
    email,
    name: typeof verified.payload.name === "string" ? verified.payload.name : null,
    groups: stringGroups(verified.payload.groups ?? verified.payload.roles)
  };
  const user = await provisionOrganizationIdentity(state.organizationId, identity);
  const ticket = await issueLoginTicket({
    userId: user.id,
    organizationId: state.organizationId,
    protocol: "oidc"
  });
  return {
    ticket: ticket.ticket,
    returnTo: state.returnTo,
    organizationSlug: configRow.organization.slug
  };
}

function domainAllowed(email: string, allowedDomains: unknown): boolean {
  const domains = Array.isArray(allowedDomains)
    ? allowedDomains.filter((item): item is string => typeof item === "string")
    : [];
  if (domains.length === 0) return true;
  return domains.includes(email.split("@")[1]?.toLowerCase() ?? "");
}

async function provisionOrganizationIdentity(
  organizationId: string,
  identity: ExternalIdentity
) {
  const config = await prisma.organizationSsoConfig.findUnique({ where: { organizationId } });
  if (!config) throw new NotFoundError("组织 SSO 配置不存在。");
  const email = identity.email.trim().toLowerCase();
  if (!domainAllowed(email, config.allowedDomains)) {
    throw new ForbiddenError("该邮箱域名不在允许范围内。");
  }
  const role = resolveRoleFromGroups(identity.groups, config.groupRoleMap, config.defaultRole);
  let user = await prisma.user.findUnique({ where: { email } });
  if (user?.disabled) {
    throw new ForbiddenError("账号已被禁用。");
  }
  if (!user) {
    if (!config.autoProvision) {
      throw new ForbiddenError("该账号尚未开通，请联系管理员。");
    }
    user = await prisma.user.create({
      data: {
        email,
        name: identity.name?.trim() || email.split("@")[0],
        passwordHash: await hash(randomBytes(32).toString("base64url"), 12),
        settings: { create: { country: "Mexico", language: "Spanish" } }
      }
    });
    await ensurePersonalOrganization(user.id).catch(() => undefined);
  }
  const existing = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: user.id } }
  });
  let membershipRole = role;
  if (existing) {
    const current = existing.role as keyof typeof ROLE_RANK;
    const mapped = role as keyof typeof ROLE_RANK;
    membershipRole =
      (ROLE_RANK[current] ?? 0) > (ROLE_RANK[mapped] ?? 0) ? existing.role : role;
  }
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId, userId: user.id } },
    create: { organizationId, userId: user.id, role: role },
    update: { role: membershipRole }
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { organizationId }
  });
  return user;
}

export async function buildOrganizationSamlAuthorizeUrl(input: {
  organizationSlug: string;
  baseUrl: string;
  returnTo?: string | null;
}): Promise<{ url: string; state: string }> {
  const resolved = await resolveOrganizationSso({ slug: input.organizationSlug });
  if (!resolved || resolved.config.protocol !== "saml") {
    throw new NotFoundError("该组织未启用 SAML 登录。");
  }
  const config = resolved.config;
  if (!config.samlEntryPoint || !config.samlIssuer || !config.samlCert) {
    throw new ForbiddenError("SAML 配置不完整。");
  }
  const { SAML } = await import("@node-saml/node-saml");
  const saml = new SAML({
    entryPoint: config.samlEntryPoint,
    issuer: `${input.baseUrl}/api/auth/sso/saml/metadata?org=${resolved.organization.slug}`,
    idpCert: config.samlCert,
    callbackUrl: `${input.baseUrl}/api/auth/sso/saml/callback`
  });
  const state = await createLoginState({
    organizationId: resolved.organization.id,
    protocol: "saml",
    returnTo: input.returnTo ?? null
  });
  const url = await saml.getAuthorizeUrlAsync(state, input.baseUrl, {});
  return { url, state };
}

export async function handleOrganizationSamlCallback(input: {
  SAMLResponse: string;
  RelayState: string;
  baseUrl: string;
}): Promise<{ ticket: string; returnTo: string | null; organizationSlug: string }> {
  const state = await consumeLoginState(input.RelayState, "saml");
  const config = await prisma.organizationSsoConfig.findUnique({
    where: { organizationId: state.organizationId },
    include: { organization: { select: { id: true, slug: true } } }
  });
  if (!config || !config.enabled || config.protocol !== "saml") {
    throw new NotFoundError("组织 SAML 配置不存在或已停用。");
  }
  if (!config.samlEntryPoint || !config.samlIssuer || !config.samlCert) {
    throw new ForbiddenError("SAML 配置不完整。");
  }
  const { SAML } = await import("@node-saml/node-saml");
  const saml = new SAML({
    entryPoint: config.samlEntryPoint,
    issuer: `${input.baseUrl}/api/auth/sso/saml/metadata?org=${config.organization.slug}`,
    idpCert: config.samlCert,
    callbackUrl: `${input.baseUrl}/api/auth/sso/saml/callback`
  });
  const result = await saml.validatePostResponseAsync({ SAMLResponse: input.SAMLResponse });
  const profile = (result.profile ?? {}) as Record<string, unknown>;
  const attributes = (profile as { attributes?: Record<string, unknown> }).attributes ?? {};
  const email =
    (typeof profile.email === "string" ? profile.email : "") ||
    (typeof attributes.email === "string" ? attributes.email : "") ||
    (typeof attributes.mail === "string" ? attributes.mail : "") ||
    (typeof profile.nameID === "string" && profile.nameID.includes("@") ? profile.nameID : "");
  if (!email.includes("@")) {
    throw new ForbiddenError("SAML 断言未包含有效邮箱。");
  }
  const identity: ExternalIdentity = {
    subject: String(profile.nameID ?? email),
    email,
    name:
      (typeof profile.displayName === "string" ? profile.displayName : null) ??
      (typeof attributes.displayName === "string" ? attributes.displayName : null),
    groups: [
      ...stringGroups(attributes.groups),
      ...stringGroups(attributes.memberOf)
    ]
  };
  const user = await provisionOrganizationIdentity(state.organizationId, identity);
  const ticket = await issueLoginTicket({
    userId: user.id,
    organizationId: state.organizationId,
    protocol: "saml"
  });
  return {
    ticket: ticket.ticket,
    returnTo: state.returnTo,
    organizationSlug: config.organization.slug
  };
}

export function buildSamlServiceProviderMetadata(input: {
  baseUrl: string;
  organizationSlug: string;
}): string {
  const entityId = `${input.baseUrl}/api/auth/sso/saml/metadata?org=${input.organizationSlug}`;
  const acs = `${input.baseUrl}/api/auth/sso/saml/callback`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acs}" index="0" isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
}
