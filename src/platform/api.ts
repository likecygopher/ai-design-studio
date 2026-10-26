/**
 * Unified API route wrapper: request id, authentication/authorization, rate
 * limiting, structured logging and the error contract — in one place.
 *
 * Usage:
 *   export const POST = (request: Request) =>
 *     handleApi(request, { auth: "user", rateLimit: { name: "upload" } }, async (ctx) => {
 *       const body = await ctx.body(uploadSchema);
 *       return NextResponse.json({ ok: true });
 *     });
 */
import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";
import { PLATFORM_CONFIG } from "@/src/platform/config";
import { recordHttpRequest, recordRateLimitRejection } from "@/src/platform/metrics";
import {
  ForbiddenError,
  RateLimitError,
  UnauthorizedError,
  ValidationError
} from "@/src/platform/errors";
import { toErrorResponse } from "@/src/platform/http";
import { createLogger, type Logger } from "@/src/platform/logger";
import {
  AsyncMemoryRateLimiter,
  consumeOrThrow,
  defaultRateLimiter,
  ipRateLimitKey,
  userRateLimitKey,
  type RateLimiter
} from "@/src/platform/rate-limit";
import { recordAudit } from "@/src/platform/audit";
import { getRequestRateLimiter } from "@/src/platform/redis-rate-limit";

export type AuthMode = "user" | "admin" | "public";

export type RateLimitOption =
  | false
  | {
      /** Logical bucket name, e.g. "upload" or "jobs:create". */
      name: string;
      limit?: number;
      windowMs?: number;
      /** Defaults to "user" when authenticated, "ip" for public routes. */
      key?: "user" | "ip";
    };

export type ApiOptions = {
  auth?: AuthMode;
  rateLimit?: RateLimitOption;
};

export type ApiContext = {
  requestId: string;
  ip: string;
  request: Request;
  userId?: string;
  role?: string;
  /** Server-side device session id backing the JWT (undefined for legacy tokens). */
  sessionId?: string;
  log: Logger;
  /** Parse and validate a JSON body; throws `ValidationError` on failure. */
  body<T>(schema: ZodSchema<T>): Promise<T>;
  form(): Promise<FormData>;
};

export class RequestId {
  private constructor(readonly value: string) {}

  static fromRequest(request: Request): RequestId {
    const incoming = request.headers.get("x-request-id");
    if (incoming && /^[A-Za-z0-9._:-]{8,128}$/.test(incoming)) {
      return new RequestId(incoming);
    }
    return new RequestId(`req_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`);
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "127.0.0.1"
  );
}

function isFormDataBody(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("multipart/form-data");
}

function formatZodIssues(error: unknown): Array<{ path: string; message: string }> {
  if (!error || typeof error !== "object" || !("issues" in error)) {
    return [];
  }
  const issues = (error as { issues: Array<{ path?: Array<string | number>; message: string }> })
    .issues;
  return issues.map((issue) => ({
    path: (issue.path ?? []).join("."),
    message: issue.message
  }));
}

export async function handleApi(
  request: Request,
  options: ApiOptions,
  handler: (ctx: ApiContext) => Promise<Response>
): Promise<Response> {
  const requestId = RequestId.fromRequest(request).value;
  const ip = getClientIp(request);
  const url = new URL(request.url);
  const path = url.pathname;
  const startedAt = Date.now();
  const log = createLogger({ requestId, path, method: request.method });

  let userId: string | undefined;
  let role: string | undefined;
  let sessionId: string | undefined;
  let tokenScopes: string[] | null = null;
  let status = 200;
  let code: string | undefined;

  try {
    const authMode: AuthMode = options.auth ?? "user";

    if (authMode !== "public") {
      // Lazy import keeps `next-auth` out of public-only route test bundles.
      const { getSessionUser } = await import("@/src/platform/auth");
      const sessionUser = await getSessionUser();
      if (sessionUser) {
        userId = sessionUser.id;
        role = sessionUser.role;
        sessionId = sessionUser.sessionId;
      } else {
        const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
        if (bearer) {
          const { authenticateApiToken } = await import("@/src/platform/api-tokens");
          const tokenAuth = await authenticateApiToken(bearer);
          if (tokenAuth) {
            userId = tokenAuth.userId;
            role = tokenAuth.role;
            tokenScopes = tokenAuth.scopes;
          }
        }
        if (!userId) {
          throw new UnauthorizedError();
        }
      }
      if (authMode === "admin" && role !== "admin") {
        throw new ForbiddenError();
      }
      // Token scopes: read-only tokens cannot mutate state.
      if (
        tokenScopes &&
        !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase()) &&
        !tokenScopes.includes("write")
      ) {
        throw new ForbiddenError("该 API 令牌没有写权限。");
      }
    }

    const rateLimit = options.rateLimit ?? {
      name: "default",
      limit: PLATFORM_CONFIG.rateLimitLimit,
      windowMs: PLATFORM_CONFIG.rateLimitWindowMs
    };

    if (rateLimit !== false) {
      const keyKind = rateLimit.key ?? (userId ? "user" : "ip");
      const key =
        keyKind === "user" && userId
          ? userRateLimitKey(rateLimit.name, userId)
          : ipRateLimitKey(rateLimit.name, ip);
      try {
        const limiter = limiterOverride
          ? new AsyncMemoryRateLimiter(limiterOverride)
          : await getRequestRateLimiter();
        const decision = await limiter.consume(
          key,
          rateLimit.limit ?? PLATFORM_CONFIG.rateLimitLimit,
          rateLimit.windowMs ?? PLATFORM_CONFIG.rateLimitWindowMs
        );
        if (!decision.ok) {
          throw new RateLimitError(decision.retryAfterSec);
        }
      } catch (error) {
        recordRateLimitRejection(path);
        // Never let rate-limit auditing block the rejection.
        void recordAudit({
          userId,
          actorRole: role,
          action: "rate_limit.exceeded",
          targetType: "route",
          targetId: path,
          ip,
          requestId
        });
        throw error;
      }
    }

    const ctx: ApiContext = {
      requestId,
      ip,
      request,
      userId,
      role,
      sessionId,
      log,
      async body<T>(schema: ZodSchema<T>): Promise<T> {
        if (isFormDataBody(request)) {
          throw new ValidationError("该接口需要 JSON 请求体。");
        }
        const raw = await request.json().catch(() => undefined);
        if (raw === undefined) {
          throw new ValidationError("请求体必须是合法 JSON。");
        }
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          throw new ValidationError("请求参数无效。", { issues: formatZodIssues(parsed.error) });
        }
        return parsed.data;
      },
      form() {
        return request.formData();
      }
    };

    const response = await handler(ctx);
    status = response.status;
    attachCommonHeaders(response, requestId);
    return response;
  } catch (error) {
    const response = toErrorResponse(error, { requestId });
    status = response.status;
    code = (await response.clone().json().catch(() => ({}))).code;
    attachCommonHeaders(response, requestId);
    if (status >= 500) {
      log.error("api.unhandled", error, { status, code, userId });
    }
    return response;
  } finally {
    const durationMs = Date.now() - startedAt;
    const fields = {
      status,
      durationMs,
      userId,
      role,
      code,
      ip: path.startsWith("/api/auth") ? undefined : ip
    };
    recordHttpRequest({
      method: request.method,
      route: path,
      status,
      durationMs
    });
    if (status >= 500) {
      log.error("api.request", undefined, fields);
    } else if (status >= 400) {
      log.warn("api.request", fields);
    } else {
      log.info("api.request", fields);
    }
  }
}

function attachCommonHeaders(response: Response, requestId: string): void {
  try {
    response.headers.set("x-request-id", requestId);
  } catch {
    // Immutable response headers (e.g. redirected Responses); nothing to do.
  }
}

/** Test/embedding override; production uses getRequestRateLimiter() above. */
let limiterOverride: RateLimiter | null = null;

export function setRateLimiter(next: RateLimiter): void {
  limiterOverride = next;
}

export function getLimiter(): RateLimiter {
  return limiterOverride ?? defaultRateLimiter;
}
