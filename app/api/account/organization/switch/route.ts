import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { switchOrganization } from "@/src/platform/organizations";

export const dynamic = "force-dynamic";

const schema = z.object({ organizationId: z.string().trim().min(1) });

export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "organization:switch", limit: 30 } },
    async (ctx) => {
      const body = await ctx.body(schema);
      await switchOrganization(ctx.userId as string, body.organizationId);
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "organization.switch",
        targetType: "organization",
        targetId: body.organizationId,
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ ok: true });
    }
  );
}
