import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { listWebhookDeliveries } from "@/src/platform/webhooks";

export const dynamic = "force-dynamic";

export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "webhooks:deliveries:list", limit: 60 } },
    async (ctx) => {
      const { id } = await context.params;
      const deliveries = await listWebhookDeliveries(ctx.userId as string, id);
      return NextResponse.json({ deliveries }, { headers: { "Cache-Control": "no-store" } });
    }
  );
}
