import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { cloneMarketplaceItem } from "@/src/platform/marketplace";

export const dynamic = "force-dynamic";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "marketplace:clone", limit: 60 } },
    async (ctx) => {
      const { id } = await context.params;
      const result = await cloneMarketplaceItem(ctx.userId as string, id);
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "marketplace.clone",
        targetType: "marketplace_item",
        targetId: id,
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json(result, { status: 201 });
    }
  );
}
