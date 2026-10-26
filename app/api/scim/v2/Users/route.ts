import {
  createScimUser,
  listScimUsers,
  scimError
} from "@/src/platform/scim";
import { handleScim, scimBody } from "@/src/platform/scim-http";

export const dynamic = "force-dynamic";

function intParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function GET(request: Request) {
  return handleScim(request, async (context) => {
    const url = new URL(request.url);
    const result = await listScimUsers(context, {
      filter: url.searchParams.get("filter") ?? undefined,
      startIndex: intParam(url.searchParams.get("startIndex")),
      count: intParam(url.searchParams.get("count"))
    });
    return Response.json(result, {
      headers: { "Content-Type": "application/scim+json", "Cache-Control": "no-store" }
    });
  });
}

export function POST(request: Request) {
  return handleScim(request, async (context) => {
    const body = await scimBody(request);
    const resource = await createScimUser(context, body);
    return Response.json(resource, {
      status: 201,
      headers: { "Content-Type": "application/scim+json" }
    });
  });
}
