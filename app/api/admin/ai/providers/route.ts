import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { aiProviderInputSchema } from "@/src/platform/ai-provider-schema";
import { createProvider, listProviders } from "@/src/platform/ai-config";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:ai:providers:read" } },
    async () => {
      const data = await listProviders();
      return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
    }
  );
}

export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:ai:providers:create", limit: 20, windowMs: 60_000 } },
    async (ctx) => {
      const input = await ctx.body(aiProviderInputSchema);
      const data = await createProvider(input);

      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "admin.ai_config.create",
        targetType: "ai_provider",
        targetId: input.name,
        metadata: {
          channel: input.channel,
          baseUrl: input.baseUrl,
          hasApiKey: Boolean(input.apiKey)
        },
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      ctx.log.info("admin.ai_provider.create", { channel: input.channel });
      return NextResponse.json(data, { status: 201 });
    }
  );
}
