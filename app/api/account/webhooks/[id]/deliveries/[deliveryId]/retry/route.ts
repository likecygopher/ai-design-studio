import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { NotFoundError } from "@/src/platform/errors";
import { retryWebhookDelivery } from "@/src/platform/webhooks";

export const dynamic = "force-dynamic";

export function POST(
  request: Request,
  context: { params: Promise<{ id: string; deliveryId: string }> }
) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "webhooks:deliveries:retry", limit: 20 } },
    async (ctx) => {
      const { id, deliveryId } = await context.params;
      const delivery = await retryWebhookDelivery(
        ctx.userId as string,
        id,
        deliveryId
      );
      if (!delivery) {
        throw new NotFoundError("投递记录不存在或不可重试。");
      }
      return NextResponse.json({ delivery });
    }
  );
}
