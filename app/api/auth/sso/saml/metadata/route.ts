import {
  baseUrlFromRequest,
  buildSamlServiceProviderMetadata
} from "@/src/platform/org-sso-login";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  const org = url.searchParams.get("org") ?? "";
  const baseUrl = baseUrlFromRequest(request);
  if (!org) {
    return new Response("Missing org", { status: 400 });
  }
  return new Response(
    buildSamlServiceProviderMetadata({ baseUrl, organizationSlug: org }),
    {
      headers: {
        "Content-Type": "application/samlmetadata+xml; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}
