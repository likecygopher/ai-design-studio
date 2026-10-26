import { handleScim } from "@/src/platform/scim-http";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleScim(request, async () =>
    Response.json(
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        documentationUri: "/api/openapi",
        patch: { supported: true },
        bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
        filter: { supported: true, maxResults: 500 },
        changePassword: { supported: false },
        sort: { supported: false },
        etag: { supported: false },
        authenticationSchemes: [
          {
            type: "oauthbearertoken",
            name: "Bearer token",
            description: "Organization SCIM token",
            primary: true
          }
        ]
      },
      {
        headers: {
          "Content-Type": "application/scim+json",
          "Cache-Control": "no-store"
        }
      }
    )
  );
}
