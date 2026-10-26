import {
  deleteScimGroup,
  getScimGroup,
  patchScimGroup,
  scimError
} from "@/src/platform/scim";
import { handleScim, scimBody } from "@/src/platform/scim-http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const headers = { "Content-Type": "application/scim+json", "Cache-Control": "no-store" };

export function GET(request: Request, context: Context) {
  return handleScim(request, async (scim) => {
    const { id } = await context.params;
    const resource = await getScimGroup(scim, id);
    if (!resource) return scimError(404, "Group not found");
    return Response.json(resource, { headers });
  });
}

export function PATCH(request: Request, context: Context) {
  return handleScim(request, async (scim) => {
    const { id } = await context.params;
    const body = await scimBody(request);
    const resource = await patchScimGroup(scim, id, body);
    if (!resource) return scimError(404, "Group not found");
    return Response.json(resource, { headers });
  });
}

export function DELETE(request: Request, context: Context) {
  return handleScim(request, async (scim) => {
    const { id } = await context.params;
    const deleted = await deleteScimGroup(scim, id);
    if (!deleted) return scimError(404, "Group not found");
    return new Response(null, { status: 204 });
  });
}
