import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.csrf-token",
  "__Secure-authjs.csrf-token",
  "authjs.callback-url",
  "__Secure-authjs.callback-url"
];

/**
 * Build the externally visible origin. Route handlers behind `next start` or a
 * reverse proxy can see an internal `request.url` (e.g. localhost), so prefer the
 * forwarded Host/proto headers and never bounce the browser to an internal host.
 */
function externalOrigin(request: Request): string {
  const url = new URL(request.url);
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    url.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    url.host;
  return `${proto}://${host}`;
}

/**
 * Clear a session cookie that the server has decided is no longer valid
 * (disabled account, password reset on another device, stale `authVersion`).
 *
 * RSC pages cannot set cookies, so they redirect here; this handler clears the
 * cookies and forwards to /login. Without it, middleware would see the stale
 * token and redirect /login back to /studio-home (redirect loop).
 */
export function GET(request: Request) {
  const target = new URL("/login", externalOrigin(request));
  target.searchParams.set("expired", "1");
  const response = NextResponse.redirect(target);

  for (const name of SESSION_COOKIES) {
    response.cookies.set(name, "", {
      maxAge: 0,
      expires: new Date(0),
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: name.startsWith("__Secure-")
    });
  }

  return response;
}
