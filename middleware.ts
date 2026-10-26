import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { defaultRateLimiter } from "@/src/platform/rate-limit";
import { buildContentSecurityPolicy, createCspNonce } from "@/src/platform/csp";

/**
 * Centralized route protection.
 *
 * - Public routes are declared explicitly (default deny).
 * - Credential sign-in attempts are rate limited per IP and per IP+email before
 *   they reach NextAuth, so brute-force traffic gets a 429 instead of a DB hit.
 * - Page requests redirect to /login; API requests get a JSON 401 with code.
 */

const PUBLIC_EXACT = new Set(["/", "/login", "/register", "/login/sso"]);

/** Static asset folders that intentionally bypass auth (bundled reference media). */
const PUBLIC_PREFIXES = [
  "/_next",
  "/favicon",
  "/midea-ai",
  "/home",
  "/demo-assets",
  "/style-references",
  "/pdp/",
  "/pop/",
  "/api/health",
  "/api/ready",
  "/api/openapi"
];

const AUTH_API_PREFIX = "/api/auth";
const CREDENTIALS_CALLBACK = "/api/auth/callback/credentials";

const LOGIN_IP_LIMIT = 30;
const LOGIN_EMAIL_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function createRequestId(request: NextRequest): string {
  const incoming = request.headers.get("x-request-id");
  if (incoming && /^[A-Za-z0-9._:-]{8,128}$/.test(incoming)) {
    return incoming;
  }
  return `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function clientIp(request: NextRequest): string {
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

function finalize(response: NextResponse, requestId: string, nonce: string): NextResponse {
  response.headers.set("x-request-id", requestId);
  response.headers.set(
    "Content-Security-Policy",
    buildContentSecurityPolicy(nonce, process.env.NODE_ENV === "production")
  );
  return response;
}

function proceed(request: NextRequest, requestId: string, nonce: string): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(
    "Content-Security-Policy",
    buildContentSecurityPolicy(nonce, process.env.NODE_ENV === "production")
  );
  return finalize(
    NextResponse.next({ request: { headers: requestHeaders } }),
    requestId,
    nonce
  );
}

function jsonError(
  requestId: string,
  nonce: string,
  message: string,
  code: string,
  status: number,
  retryAfterSec?: number
): NextResponse {
  const response = NextResponse.json({ error: message, code, requestId }, { status });
  if (retryAfterSec !== undefined) {
    response.headers.set("retry-after", String(retryAfterSec));
  }
  return finalize(response, requestId, nonce);
}

async function extractLoginEmail(request: NextRequest): Promise<string | undefined> {
  try {
    const text = await request.clone().text();
    if (!text) {
      return undefined;
    }
    const params = new URLSearchParams(text);
    const email = params.get("email");
    return email ? email.trim().toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = createRequestId(request);
  const nonce = createCspNonce();

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return proceed(request, requestId, nonce);
  }

  if (pathname.startsWith(AUTH_API_PREFIX)) {
    // Throttle credential sign-in per IP and per IP+email.
    if (pathname === CREDENTIALS_CALLBACK && request.method === "POST") {
      const ip = clientIp(request);
      const ipDecision = defaultRateLimiter.consume(
        `login:ip:${ip}`,
        LOGIN_IP_LIMIT,
        LOGIN_WINDOW_MS
      );
      if (!ipDecision.ok) {
        return jsonError(
          requestId,
          nonce,
          "登录尝试过于频繁，请稍后再试。",
          "RATE_LIMITED",
          429,
          ipDecision.retryAfterSec
        );
      }

      const email = await extractLoginEmail(request);
      if (email) {
        const emailDecision = defaultRateLimiter.consume(
          `login:${ip}:${email}`,
          LOGIN_EMAIL_LIMIT,
          LOGIN_WINDOW_MS
        );
        if (!emailDecision.ok) {
          return jsonError(
            requestId,
            nonce,
            "该账号登录尝试过于频繁，请 15 分钟后再试。",
            "RATE_LIMITED",
            429,
            emailDecision.retryAfterSec
          );
        }
      }
    }
    return proceed(request, requestId, nonce);
  }

  // NextAuth v5 names the session cookie `authjs.session-token`, prefixed with
  // `__Secure-` when served over HTTPS. Detection must match, or every request
  // behind TLS would look unauthenticated.
  const isSecure =
    request.nextUrl.protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https";

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: isSecure
  });
  const isLoggedIn = Boolean(token?.sub);

  if (pathname.startsWith("/api/")) {
    // Personal API tokens and METRICS_TOKEN are validated by the route wrapper
    // (DB lookup lives in Node.js, not the Edge middleware).
    const authorization = request.headers.get("authorization") ?? "";
    if (/^Bearer\s+\S+/i.test(authorization)) {
      return proceed(request, requestId, nonce);
    }
    if (!isLoggedIn) {
      return jsonError(
        requestId,
        nonce,
        "请先登录后再使用平台功能。",
        "AUTH_REQUIRED",
        401
      );
    }
    return proceed(request, requestId, nonce);
  }

  if (PUBLIC_EXACT.has(pathname)) {
    // `expired=1` is set by /api/auth/expire after clearing a revoked session;
    // allow the login page to render even if a stale token is still present.
    const expired = request.nextUrl.searchParams.get("expired") === "1";
    if (isLoggedIn && !expired && (pathname === "/login" || pathname === "/register")) {
      return finalize(
        NextResponse.redirect(new URL("/studio-home", request.url)),
        requestId,
        nonce
      );
    }
    return proceed(request, requestId, nonce);
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return finalize(NextResponse.redirect(loginUrl), requestId, nonce);
  }

  return proceed(request, requestId, nonce);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|svg|mp4|ico)$).*)"]
};
