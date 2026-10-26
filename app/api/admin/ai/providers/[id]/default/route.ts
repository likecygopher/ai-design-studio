import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { listProviders, setActiveProvider } from "@/src/platform/ai-config";
import { NotFoundError } from "@/src/platform/errors";

export const dynamic = "force-dynamic";

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:ai:providers:activate", limit: 30, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      const before = await listProviders();
      const target = before.providers.find((provider) => provider.id === id);
      if (!target) {
        throw new NotFoundError("AI 供应商不存在。");
      }

      const data = await setActiveProvider(id);

      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "admin.ai_config.activate",
        targetType: "ai_provider",
        targetId: id,
        metadata: { name: target.name, channel: target.channel },
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      ctx.log.info("admin.ai_provider.activate", { id });
      return NextResponse.json(data);
    }
  );
}
