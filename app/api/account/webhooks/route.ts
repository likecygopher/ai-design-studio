import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { ValidationError } from "@/src/platform/errors";
import {
  WEBHOOK_EVENTS,
  createWebhookEndpoint,
  listWebhookEndpoints,
  validateWebhookUrl
} from "@/src/platform/webhooks";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  url: z.string().trim().min(1, "请输入 Webhook URL。").max(600),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "请至少选择一个事件。").max(10)
});

export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:webhooks:read", limit: 60, windowMs: 60_000 } },
    async (ctx) => {
      const webhooks = await listWebhookEndpoints(ctx.userId as string);
      return NextResponse.json({ webhooks }, { headers: { "Cache-Control": "no-store" } });
    }
  );
}

export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:webhooks:create", limit: 10, windowMs: 60_000 } },
    async (ctx) => {
      const body = await ctx.body(createSchema);
      const validated = validateWebhookUrl(body.url);
      if (!validated.ok) {
        throw new ValidationError(validated.error);
      }
      const { endpoint, secret } = await createWebhookEndpoint(ctx.userId as string, {
        url: validated.url,
        events: body.events
      });
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "account.webhook_create",
        targetType: "webhook",
        targetId: endpoint.id,
        metadata: { url: endpoint.url, events: endpoint.events },
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      // The secret is shown once so the receiver can verify HMAC signatures.
      return NextResponse.json({ webhook: endpoint, secret }, { status: 201 });
    }
  );
}
