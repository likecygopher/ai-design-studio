import { NextResponse } from "next/server";
import {
  baseUrlFromRequest,
  handleOrganizationSamlCallback
} from "@/src/platform/org-sso-login";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const SAMLResponse = String(form.get("SAMLResponse") ?? "");
    const RelayState = String(form.get("RelayState") ?? "");
    if (!SAMLResponse || !RelayState) {
      return NextResponse.redirect(new URL("/login?error=saml_callback_invalid", request.url));
    }
    const result = await handleOrganizationSamlCallback({
      SAMLResponse,
      RelayState,
      baseUrl: baseUrlFromRequest(request)
    });
    const target = new URL("/login/sso", request.url);
    target.searchParams.set("ticket", result.ticket);
    target.searchParams.set("returnTo", result.returnTo ?? "/studio-home");
    return NextResponse.redirect(target);
  } catch {
    return NextResponse.redirect(new URL("/login?error=saml_callback_failed", request.url));
  }
}
