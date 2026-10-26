import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { aiProviderInputSchema } from "@/src/platform/ai-provider-schema";
import {
  deleteProvider,
  listProviders,
  updateProvider
} from "@/src/platform/ai-config";
import { NotFoundError } from "@/src/platform/errors";

export const dynamic = "force-dynamic";

function hasProvider(data: { providers: Array<{ id: string }> }, id: string): boolean {
  return data.providers.some((provider) => provider.id === id);
}

export function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:ai:providers:update", limit: 40, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      const input = await ctx.body(aiProviderInputSchema);

      const before = await listProviders();
      if (!hasProvider(before, id)) {
        throw new NotFoundError("AI 供应商不存在。");
      }

      const data = await updateProvider(id, input);

      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "admin.ai_config.update",
        targetType: "ai_provider",
        targetId: id,
        metadata: {
          channel: input.channel,
          enabled: input.enabled,
          hasApiKey: Boolean(input.apiKey),
          clearedApiKey: Boolean(input.clearApiKey)
        },
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      ctx.log.info("admin.ai_provider.update", { id, channel: input.channel });
      return NextResponse.json(data);
    }
  );
}

export function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:ai:providers:delete", limit: 20, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;

      const before = await listProviders();
      const target = before.providers.find((provider) => provider.id === id);
      if (!target) {
        throw new NotFoundError("AI 供应商不存在。");
      }

      const data = await deleteProvider(id);

      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "admin.ai_config.delete",
        targetType: "ai_provider",
        targetId: id,
        metadata: { name: target.name, channel: target.channel },
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      ctx.log.info("admin.ai_provider.delete", { id });
      return NextResponse.json(data);
    }
  );
}
