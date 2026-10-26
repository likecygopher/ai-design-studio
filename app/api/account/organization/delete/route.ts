import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { deleteOrganization } from "@/src/platform/organizations";

export const dynamic = "force-dynamic";

const schema = z.object({ confirmName: z.string().trim().min(1).max(80) });

export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "organization:delete", limit: 3 } },
    async (ctx) => {
      const body = await ctx.body(schema);
      await deleteOrganization(ctx.userId as string, body.confirmName);
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "organization.delete",
        targetType: "organization",
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ ok: true });
    }
  );
}
