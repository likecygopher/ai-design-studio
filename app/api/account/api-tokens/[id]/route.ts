import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { revokeApiToken } from "@/src/platform/api-tokens";
import { NotFoundError } from "@/src/platform/errors";

export const dynamic = "force-dynamic";

export function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:tokens:revoke", limit: 30, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      const revoked = await revokeApiToken(ctx.userId as string, id);
      if (!revoked) {
        throw new NotFoundError("API 令牌不存在或已吊销。");
      }
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "account.api_token_revoke",
        targetType: "api_token",
        targetId: id,
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ revoked: true });
    }
  );
}
