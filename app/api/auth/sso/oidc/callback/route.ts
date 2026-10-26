import { NextResponse } from "next/server";
import {
  baseUrlFromRequest,
  handleOrganizationOidcCallback
} from "@/src/platform/org-sso-login";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url));
  }
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=sso_callback_invalid", request.url));
  }
  try {
    const result = await handleOrganizationOidcCallback({
      code,
      state,
      baseUrl: baseUrlFromRequest(request)
    });
    const target = new URL("/login/sso", request.url);
    target.searchParams.set("ticket", result.ticket);
    target.searchParams.set("returnTo", result.returnTo ?? "/studio-home");
    return NextResponse.redirect(target);
  } catch {
    return NextResponse.redirect(new URL("/login?error=sso_callback_failed", request.url));
  }
}
