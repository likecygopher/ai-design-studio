import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { z } from "zod";
import { authConfig } from "@/src/platform/auth.config";
import { prisma } from "@/src/platform/db";
import {
  ensurePersonalOrganization,
  rememberActiveOrganization
} from "@/src/platform/organizations";
import { PLATFORM_CONFIG } from "@/src/platform/config";
import { ApiError, ForbiddenError } from "@/src/platform/errors";
import { logger } from "@/src/platform/logger";
import { recordAudit } from "@/src/platform/audit";
import { getLoginRateLimiter } from "@/src/platform/redis-rate-limit";
import { createAuthSession, revokeAuthSessionByToken, validateAuthSession } from "@/src/platform/sessions";
import { verifySecondFactorByUserId } from "@/src/platform/two-factor";
import {
  SSO_PROVIDER_ID,
  getSsoConfig,
  provisionSsoUser,
  validateSsoEmail
} from "@/src/platform/sso";
import { consumeLoginTicket } from "@/src/platform/org-sso-login";

const credentialsSchema = z.object({
  email: z.string().email(),
  // Length policy is enforced at registration; login accepts whatever was stored
  // so legacy/demo accounts keep working.
  password: z.string().min(1).max(200),
  /** TOTP or one-time recovery code; required only when the account enables 2FA. */
  totp: z.string().trim().max(64).optional()
});

/** Test helper: clears the per-IP/email login throttle. */
export function resetLoginThrottle(): void {
  void getLoginRateLimiter()
    .then((limiter) => limiter.reset())
    .catch(() => undefined);
}

function readIpFromRequest(request: Request | undefined): string {
  if (!request) {
    return "unknown";
  }
  const forwarded = request.headers?.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return (
    request.headers?.get("x-real-ip") ??
    request.headers?.get("cf-connecting-ip") ??
    "unknown"
  );
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) {
    return "***";
  }
  const visible = name.slice(0, 2);
  return `${visible}***@${domain}`;
}

const ssoConfig = getSsoConfig();
const ssoProvider = ssoConfig
  ? {
      id: SSO_PROVIDER_ID,
      name: ssoConfig.name,
      type: "oidc" as const,
      issuer: ssoConfig.issuer,
      clientId: ssoConfig.clientId,
      clientSecret: ssoConfig.clientSecret,
      authorization: { params: { scope: ssoConfig.scopes } },
      checks: ["pkce", "state"] as const,
      profile(profile: Record<string, unknown>) {
        const email =
          typeof profile.email === "string"
            ? profile.email
            : typeof profile.preferred_username === "string"
              ? profile.preferred_username
              : "";
        return {
          id: String(profile.sub ?? ""),
          email,
          name:
            (typeof profile.name === "string" ? profile.name : undefined) ??
            (typeof profile.preferred_username === "string"
              ? profile.preferred_username
              : email),
          image: typeof profile.picture === "string" ? profile.picture : undefined
        };
      }
    }
  : null;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Email and Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        totp: { label: "Two-factor code", type: "text" }
      },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) {
          return null;
        }

        const email = parsed.data.email.trim().toLowerCase();
        const ip = readIpFromRequest(request);
        const throttleKey = `login:${ip}:${email}`;

        const decision = await (await getLoginRateLimiter()).consume(
          throttleKey,
          PLATFORM_CONFIG.loginMaxAttempts,
          PLATFORM_CONFIG.loginWindowMs
        );
        if (!decision.ok) {
          logger.warn("auth.login_rate_limited", { email: maskEmail(email), ip });
          void recordAudit({
            action: "auth.login_failed",
            ip,
            metadata: { reason: "rate_limited", email: maskEmail(email) }
          });
          return null;
        }

        let user;
        try {
          user = await prisma.user.findUnique({ where: { email } });
        } catch (error) {
          logger.error("auth.lookup_failed", error, { email: maskEmail(email) });
          return null;
        }

        if (!user) {
          logger.info("auth.login_failed", { email: maskEmail(email), reason: "unknown_user", ip });
          void recordAudit({
            action: "auth.login_failed",
            ip,
            metadata: { reason: "unknown_user", email: maskEmail(email) }
          });
          return null;
        }

        const valid = await compare(parsed.data.password, user.passwordHash);
        if (!valid) {
          logger.info("auth.login_failed", { email: maskEmail(email), reason: "bad_password", ip });
          void recordAudit({
            userId: user.id,
            actorRole: user.role,
            action: "auth.login_failed",
            ip,
            metadata: { reason: "bad_password" }
          });
          return null;
        }

        // Disabled accounts keep the generic failure response: never reveal the
        // reason to the caller (constitution §4), but record it for operators.
        if (user.disabled) {
          logger.warn("auth.login_failed", { email: maskEmail(email), reason: "disabled", ip });
          void recordAudit({
            userId: user.id,
            actorRole: user.role,
            action: "auth.login_failed",
            ip,
            metadata: { reason: "disabled" }
          });
          return null;
        }

        if (user.totpEnabled) {
          const secondFactor = parsed.data.totp?.trim() ?? "";
          if (!secondFactor) {
            logger.info("auth.login_failed", {
              email: maskEmail(email),
              reason: "two_factor_required",
              ip
            });
            void recordAudit({
              userId: user.id,
              actorRole: user.role,
              action: "auth.login_failed",
              ip,
              metadata: { reason: "two_factor_required" }
            });
            return null;
          }
          const validSecondFactor = await verifySecondFactorByUserId(user.id, secondFactor);
          if (!validSecondFactor) {
            logger.info("auth.login_failed", {
              email: maskEmail(email),
              reason: "two_factor_invalid",
              ip
            });
            void recordAudit({
              userId: user.id,
              actorRole: user.role,
              action: "auth.login_failed",
              ip,
              metadata: { reason: "two_factor_invalid" }
            });
            return null;
          }
        }

        await (await getLoginRateLimiter()).reset(throttleKey);

        let sessionId: string;
        try {
          sessionId = await createAuthSession({
            userId: user.id,
            userAgent: request?.headers?.get("user-agent") ?? null,
            ip
          });
        } catch (error) {
          logger.error("auth.session_create_failed", error, { userId: user.id });
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.email,
          role: user.role,
          authVersion: user.authVersion,
          sessionId
        };
      }
    }),
    Credentials({
      id: "sso-ticket",
      name: "Organization SSO ticket",
      credentials: { ticket: { label: "Ticket", type: "password" } },
      async authorize(raw) {
        const ticket = typeof raw?.ticket === "string" ? raw.ticket : "";
        if (!ticket) return null;
        try {
          const consumed = await consumeLoginTicket(ticket);
          const user = await prisma.user.findUnique({ where: { id: consumed.userId } });
          if (!user || user.disabled) return null;
          const sessionId = await createAuthSession({
            userId: user.id,
            userAgent: null,
            ip: "organization-sso"
          });
          void recordAudit({
            userId: user.id,
            actorRole: user.role,
            action: "auth.login",
            metadata: { provider: "organization_sso", sessionId }
          });
          return {
            id: user.id,
            email: user.email,
            name: user.name ?? user.email,
            role: user.role,
            authVersion: user.authVersion,
            sessionId
          };
        } catch (error) {
          logger.warn("auth.sso_ticket_failed", {
            error: error instanceof Error ? error.message : String(error)
          });
          return null;
        }
      }
    }),
    ...(ssoProvider ? [ssoProvider as never] : [])
  ],
  callbacks: {
    authorized: authConfig.callbacks.authorized,
    async signIn({ account, profile, user }) {
      if (account?.provider !== SSO_PROVIDER_ID) {
        return true;
      }
      const config = getSsoConfig();
      if (!config) {
        return false;
      }
      const email =
        (profile as { email?: string; preferred_username?: string } | undefined)?.email ??
        (profile as { preferred_username?: string } | undefined)?.preferred_username ??
        user.email ??
        "";
      if (!email || !validateSsoEmail(email, config)) {
        logger.warn("auth.sso_domain_rejected", { email: maskEmail(email) });
        void recordAudit({
          action: "auth.login_failed",
          metadata: { reason: "sso_domain_rejected", email: maskEmail(email) }
        });
        return false;
      }
      try {
        await provisionSsoUser(
          {
            subject: String(account.providerAccountId ?? ""),
            email,
            name: user.name ?? null
          },
          config
        );
        return true;
      } catch (error) {
        logger.warn("auth.sso_provision_failed", {
          error: error instanceof Error ? error.message : String(error)
        });
        void recordAudit({
          action: "auth.login_failed",
          metadata: { reason: "sso_provision_failed", email: maskEmail(email) }
        });
        return false;
      }
    },
    async jwt({ token, user, account, profile }) {
      if (account?.provider === SSO_PROVIDER_ID) {
        const config = getSsoConfig();
        const email =
          (profile as { email?: string; preferred_username?: string } | undefined)?.email ??
          (profile as { preferred_username?: string } | undefined)?.preferred_username ??
          "";
        if (!config || !email) {
          return token;
        }
        try {
          const provisioned = await provisionSsoUser(
            {
              subject: String(account.providerAccountId ?? ""),
              email,
              name: user?.name ?? null
            },
            config
          );
          const sessionId = await createAuthSession({
            userId: provisioned.user.id,
            userAgent: null,
            ip: "sso"
          });
          token.sub = provisioned.user.id;
          token.role = provisioned.user.role;
          token.authVersion = provisioned.user.authVersion;
          token.sessionId = sessionId;
          (token as Record<string, unknown>).sso = true;
          void recordAudit({
            userId: provisioned.user.id,
            actorRole: provisioned.user.role,
            action: "auth.login",
            metadata: { provider: "sso", sessionId }
          });
          if (provisioned.created) {
            void recordAudit({
              userId: provisioned.user.id,
              actorRole: provisioned.user.role,
              action: "auth.sso_provision",
              metadata: { email: maskEmail(provisioned.user.email) }
            });
          }
        } catch (error) {
          logger.warn("auth.sso_session_failed", {
            error: error instanceof Error ? error.message : String(error)
          });
        }
        return token;
      }

      if (user) {
        token.sub = user.id;
        token.role = (user as { role?: string }).role ?? "user";
        token.authVersion = (user as { authVersion?: number }).authVersion ?? 0;
        token.sessionId = (user as { sessionId?: string }).sessionId;
      }
      return token;
    },
    session: authConfig.callbacks.session
  },
  events: {
    async signIn({ user, account }) {
      // SSO logins are audited in the jwt callback after the local account is resolved.
      if (account?.provider !== "credentials") {
        return;
      }
      await recordAudit({
        userId: user.id ?? null,
        actorRole: (user as { role?: string }).role ?? null,
        action: "auth.login",
        metadata: { sessionId: (user as { sessionId?: string }).sessionId }
      });
    },
    async signOut(payload) {
      const token = "token" in payload ? payload.token : null;
      const sessionId = typeof token?.sessionId === "string" ? token.sessionId : undefined;
      if (sessionId) {
        await revokeAuthSessionByToken(sessionId).catch(() => undefined);
      }
    }
  },
  secret: process.env.AUTH_SECRET
});

export type SessionUser = {
  id: string;
  email?: string;
  name?: string;
  role: string;
  /** Device session id; absent only for JWTs issued before session tracking. */
  sessionId?: string;
  /** Active organization id (personal organization by default). */
  organizationId?: string | null;
};

/**
 * Resolve the authenticated user and re-validate against the database.
 *
 * The JWT strategy alone cannot revoke sessions, so every server-side
 * authentication check compares `authVersion` and `disabled` from the DB.
 * This is one primary-key lookup per authenticated request — acceptable at the
 * current scale, and the documented hook for a short-TTL cache (P1).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) {
    return null;
  }

  const row = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      disabled: true,
      authVersion: true,
      organizationId: true,
      organization: { select: { archivedAt: true } }
    }
  });

  if (!row || row.disabled) {
    return null;
  }

  const sessionVersion = session.user.authVersion ?? 0;
  if (sessionVersion !== row.authVersion) {
    return null;
  }

  // Revoking the device row invalidates this JWT even though the cookie stays.
  const sessionId = session.user.sessionId;
  if (sessionId) {
    const active = await validateAuthSession({ userId: row.id, sessionId });
    if (!active) {
      return null;
    }
  }

  let activeOrganizationId = row.organizationId;
  if (row.organization?.archivedAt) {
    activeOrganizationId = await ensurePersonalOrganization(row.id).catch(
      () => row.organizationId
    );
  }
  rememberActiveOrganization(row.id, activeOrganizationId);

  // Role comes from the DB so role changes take effect without re-login.
  return {
    id: row.id,
    email: row.email,
    organizationId: activeOrganizationId,
    name: row.name ?? undefined,
    role: row.role,
    ...(sessionId ? { sessionId } : {})
  };
}

export async function requireUserId(): Promise<string> {
  const user = await getSessionUser();
  if (!user) {
    throw new AuthRequiredError();
  }
  return user.id;
}

export async function requireRole(role: "admin"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new AuthRequiredError();
  }
  if (role === "admin" && user.role !== "admin") {
    throw new ForbiddenError();
  }
  return user;
}

export class AuthRequiredError extends ApiError {
  constructor(message = "请先登录后再使用平台功能。") {
    super(401, "AUTH_REQUIRED", message);
    this.name = "AuthRequiredError";
  }
}
