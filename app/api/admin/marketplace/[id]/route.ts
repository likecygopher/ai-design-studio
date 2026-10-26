import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { reviewMarketplaceItem } from "@/src/platform/marketplace";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().max(500).nullable().optional()
});

export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:marketplace:review", limit: 60 } },
    async (ctx) => {
      const { id } = await context.params;
      const body = await ctx.body(reviewSchema);
      const item = await reviewMarketplaceItem(ctx.userId as string, id, body);
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "admin.marketplace_review",
        targetType: "marketplace_item",
        targetId: id,
        metadata: { status: body.status },
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ item });
    }
  );
}
