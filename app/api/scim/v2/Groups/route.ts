import { createScimGroup, listScimGroups } from "@/src/platform/scim";
import { handleScim, scimBody } from "@/src/platform/scim-http";

export const dynamic = "force-dynamic";

const headers = { "Content-Type": "application/scim+json", "Cache-Control": "no-store" };

export function GET(request: Request) {
  return handleScim(request, async (context) => {
    const result = await listScimGroups(context);
    return Response.json(result, { headers });
  });
}

export function POST(request: Request) {
  return handleScim(request, async (context) => {
    const body = await scimBody(request);
    const resource = await createScimGroup(context, body);
    return Response.json(resource, {
      status: 201,
      headers: { "Content-Type": "application/scim+json" }
    });
  });
}
