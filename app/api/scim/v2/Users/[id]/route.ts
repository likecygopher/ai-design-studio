import {
  deleteScimUser,
  getScimUser,
  patchScimUser,
  scimError
} from "@/src/platform/scim";
import { handleScim, scimBody } from "@/src/platform/scim-http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const headers = { "Content-Type": "application/scim+json", "Cache-Control": "no-store" };

export function GET(request: Request, context: Context) {
  return handleScim(request, async (scim) => {
    const { id } = await context.params;
    const resource = await getScimUser(scim, id);
    if (!resource) return scimError(404, "User not found");
    return Response.json(resource, { headers });
  });
}

export function PATCH(request: Request, context: Context) {
  return handleScim(request, async (scim) => {
    const { id } = await context.params;
    const body = await scimBody(request);
    const resource = await patchScimUser(scim, id, body);
    if (!resource) return scimError(404, "User not found");
    return Response.json(resource, { headers });
  });
}

export function DELETE(request: Request, context: Context) {
  return handleScim(request, async (scim) => {
    const { id } = await context.params;
    const deleted = await deleteScimUser(scim, id);
    if (!deleted) return scimError(404, "User not found");
    return new Response(null, { status: 204 });
  });
}
