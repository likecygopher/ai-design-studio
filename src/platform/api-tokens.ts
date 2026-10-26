import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/src/platform/db";

/** Personal access tokens for machine-to-machine API calls. */

export const API_TOKEN_PREFIX = "mcs_";
const TOKEN_BYTES = 24;

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

export function generateApiToken(): { token: string; tokenHash: string; prefix: string } {
  const token = `${API_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return { token, tokenHash: hashApiToken(token), prefix: token.slice(0, 12) };
}

export type ApiTokenView = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export type ApiTokenAuth = {
  tokenId: string;
  userId: string;
  role: string;
  scopes: string[];
};

function toView(row: {
  id: string;
  name: string;
  prefix: string;
  scopes: unknown;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}): ApiTokenView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((s): s is string => typeof s === "string") : [],
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null
  };
}

export const API_TOKEN_SCOPES = ["read", "write"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export async function createApiToken(
  userId: string,
  input: { name: string; expiresInDays?: number | null; scopes?: ApiTokenScope[] }
): Promise<{ token: string; view: ApiTokenView }> {
  const generated = generateApiToken();
  const expiresAt =
    typeof input.expiresInDays === "number" && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;
  const row = await prisma.apiToken.create({
    data: {
      userId,
      name: input.name.trim().slice(0, 80),
      prefix: generated.prefix,
      tokenHash: generated.tokenHash,
      scopes:
        input.scopes && input.scopes.length > 0 ? input.scopes : ["read", "write"],
      expiresAt
    }
  });
  return { token: generated.token, view: toView(row) };
}

export async function listApiTokens(userId: string): Promise<ApiTokenView[]> {
  const rows = await prisma.apiToken.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }],
    take: 50
  });
  return rows.map(toView);
}

export async function revokeApiToken(userId: string, id: string): Promise<boolean> {
  const result = await prisma.apiToken.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
  return result.count > 0;
}

/**
 * Resolve `Authorization: Bearer mcs_...` to a user. Tokens inherit the owner's
 * role; revoked, expired and disabled accounts are rejected.
 */
export async function authenticateApiToken(rawToken: string): Promise<ApiTokenAuth | null> {
  const token = rawToken.trim();
  if (!token.startsWith(API_TOKEN_PREFIX)) {
    return null;
  }
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashApiToken(token) },
    select: {
      id: true,
      userId: true,
      scopes: true,
      revokedAt: true,
      expiresAt: true,
      user: { select: { id: true, role: true, disabled: true } }
    }
  });
  if (!row || row.revokedAt || row.user.disabled) {
    return null;
  }
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  void prisma.apiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    tokenId: row.id,
    userId: row.user.id,
    role: row.user.role,
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((s): s is string => typeof s === "string") : []
  };
}
