import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { NotFoundError } from "@/src/platform/errors";
import { revokeAuthSession } from "@/src/platform/sessions";

export const dynamic = "force-dynamic";

/** Revoke one of the caller's device sessions (including the current device). */
export function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:sessions:revoke", limit: 30, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      const revoked = await revokeAuthSession(ctx.userId as string, id);
      if (!revoked) {
        throw new NotFoundError("会话不存在或已失效。");
      }

      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "account.session_revoke",
        targetType: "auth_session",
        targetId: id,
        metadata: { current: id === ctx.sessionId },
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      return NextResponse.json({ revoked: true, revokedCurrent: id === ctx.sessionId });
    }
  );
}
