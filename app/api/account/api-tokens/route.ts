import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import {
  API_TOKEN_SCOPES,
  createApiToken,
  listApiTokens
} from "@/src/platform/api-tokens";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1, "请输入令牌名称。").max(80),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
  scopes: z.array(z.enum(API_TOKEN_SCOPES)).min(1).max(2).optional()
});

export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:tokens:read", limit: 60, windowMs: 60_000 } },
    async (ctx) => {
      const tokens = await listApiTokens(ctx.userId as string);
      return NextResponse.json({ tokens }, { headers: { "Cache-Control": "no-store" } });
    }
  );
}

/** The plaintext token is returned exactly once; only its hash is stored. */
export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:tokens:create", limit: 10, windowMs: 60_000 } },
    async (ctx) => {
      const body = await ctx.body(createSchema);
      const { token, view } = await createApiToken(ctx.userId as string, body);
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "account.api_token_create",
        targetType: "api_token",
        targetId: view.id,
        metadata: { name: view.name, prefix: view.prefix, expiresAt: view.expiresAt },
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ token, apiToken: view }, { status: 201 });
    }
  );
}
