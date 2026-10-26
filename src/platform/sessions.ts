import { PLATFORM_CONFIG } from "@/src/platform/config";
import { prisma } from "@/src/platform/db";
import { logger } from "@/src/platform/logger";

/** Server-side device sessions on top of NextAuth's JWT. */

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type AuthSessionView = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

export async function createAuthSession(input: {
  userId: string;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<string> {
  const row = await prisma.authSession.create({
    data: {
      userId: input.userId,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      ip: input.ip?.slice(0, 80) ?? null
    },
    select: { id: true }
  });
  return row.id;
}

/**
 * Validate that the JWT's session id is still active and not expired, and
 * refresh `lastSeenAt` at most once every 5 minutes.
 */
export async function validateAuthSession(input: {
  userId: string;
  sessionId: string;
}): Promise<boolean> {
  const row = await prisma.authSession.findFirst({
    where: { id: input.sessionId, userId: input.userId, revokedAt: null },
    select: { id: true, createdAt: true, lastSeenAt: true }
  });
  if (!row) {
    return false;
  }

  const maxAgeMs = PLATFORM_CONFIG.authSessionMaxAgeSec * 1000;
  if (Date.now() - row.createdAt.getTime() > maxAgeMs) {
    return false;
  }

  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    void prisma.authSession
      .update({ where: { id: row.id }, data: { lastSeenAt: new Date() } })
      .catch((error) =>
        logger.warn("auth.session_touch_failed", {
          error: error instanceof Error ? error.message : String(error)
        })
      );
  }
  return true;
}

export async function listAuthSessions(
  userId: string,
  currentSessionId?: string | null
): Promise<AuthSessionView[]> {
  const rows = await prisma.authSession.findMany({
    where: { userId, revokedAt: null },
    orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }]
  });
  return rows.map((row) => ({
    id: row.id,
    userAgent: row.userAgent,
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    current: row.id === currentSessionId
  }));
}

export async function revokeAuthSession(
  userId: string,
  sessionId: string
): Promise<boolean> {
  const result = await prisma.authSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
  return result.count > 0;
}

export async function revokeAuthSessionByToken(sessionId: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
  return result.count;
}
