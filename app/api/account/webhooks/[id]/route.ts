import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { NotFoundError } from "@/src/platform/errors";
import { deleteWebhookEndpoint } from "@/src/platform/webhooks";

export const dynamic = "force-dynamic";

export function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:webhooks:delete", limit: 30, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      const deleted = await deleteWebhookEndpoint(ctx.userId as string, id);
      if (!deleted) {
        throw new NotFoundError("Webhook 不存在。");
      }
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "account.webhook_delete",
        targetType: "webhook",
        targetId: id,
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ deleted: true });
    }
  );
}
