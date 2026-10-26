import { NextResponse } from "next/server";
import {
  baseUrlFromRequest,
  buildOrganizationOidcAuthorizeUrl,
  buildOrganizationSamlAuthorizeUrl,
  sanitizeReturnTo
} from "@/src/platform/org-sso-login";
import { resolveOrganizationSso } from "@/src/platform/organization-sso";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("org")?.trim() ?? "";
  const email = url.searchParams.get("email")?.trim() ?? "";
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"));

  const resolved = await resolveOrganizationSso({
    slug: slug || undefined,
    email: email || undefined
  });
  if (!resolved) {
    return NextResponse.redirect(new URL("/login?error=sso_not_configured", request.url));
  }
  const baseUrl = baseUrlFromRequest(request);
  try {
    const target =
      resolved.config.protocol === "saml"
        ? (
            await buildOrganizationSamlAuthorizeUrl({
              organizationSlug: resolved.organization.slug,
              baseUrl,
              returnTo
            })
          ).url
        : await buildOrganizationOidcAuthorizeUrl({
            organizationSlug: resolved.organization.slug,
            baseUrl,
            returnTo
          });
    return NextResponse.redirect(target);
  } catch {
    return NextResponse.redirect(new URL("/login?error=sso_start_failed", request.url));
  }
}
