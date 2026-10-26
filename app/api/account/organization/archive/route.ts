import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { archiveOrganization } from "@/src/platform/organizations";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "organization:archive", limit: 5 } },
    async (ctx) => {
      await archiveOrganization(ctx.userId as string);
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "organization.archive",
        targetType: "organization",
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ ok: true });
    }
  );
}
