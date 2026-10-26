import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { getOrganizationOverview, renameOrganization } from "@/src/platform/organizations";

export const dynamic = "force-dynamic";

const renameSchema = z.object({ name: z.string().trim().min(1).max(80) });

export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "organization:read", limit: 60 } },
    async (ctx) => {
      const overview = await getOrganizationOverview(ctx.userId as string);
      return NextResponse.json(overview, { headers: { "Cache-Control": "no-store" } });
    }
  );
}

export function PATCH(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "organization:rename", limit: 20 } },
    async (ctx) => {
      const body = await ctx.body(renameSchema);
      await renameOrganization(ctx.userId as string, body.name);
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "organization.rename",
        targetType: "organization",
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ ok: true });
    }
  );
}
