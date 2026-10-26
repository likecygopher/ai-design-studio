import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { rotateScimToken } from "@/src/platform/organization-sso";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "organization:sso:scim-token", limit: 5 } },
    async (ctx) => {
      const result = await rotateScimToken(ctx.userId as string);
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "organization.scim_token_rotate",
        targetType: "organization_sso_config",
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json(result, { status: 201 });
    }
  );
}
