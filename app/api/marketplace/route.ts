import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import {
  MARKETPLACE_CATEGORIES,
  listMarketplace,
  publishMarketplaceItem
} from "@/src/platform/marketplace";

export const dynamic = "force-dynamic";

const publishSchema = z.object({
  title: z.string().trim().min(1, "请输入标题。").max(120),
  description: z.string().trim().max(500).nullable().optional(),
  category: z.enum(MARKETPLACE_CATEGORIES),
  prompt: z.string().trim().min(1, "请输入提示词。").max(4000),
  coverUrl: z.string().url().max(1000).nullable().optional()
});

export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "marketplace:list", limit: 120 } },
    async (ctx) => {
      const url = new URL(request.url);
      const result = await listMarketplace({
        q: url.searchParams.get("q") ?? undefined,
        category: url.searchParams.get("category") ?? undefined,
        page: Number(url.searchParams.get("page") ?? 1) || 1
      });
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
  );
}

export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "marketplace:publish", limit: 10, windowMs: 60 * 60 * 1000 } },
    async (ctx) => {
      const input = await ctx.body(publishSchema);
      const item = await publishMarketplaceItem(ctx.userId as string, input);
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "marketplace.publish",
        targetType: "marketplace_item",
        targetId: item.id,
        metadata: { category: item.category },
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ item }, { status: 201 });
    }
  );
}
