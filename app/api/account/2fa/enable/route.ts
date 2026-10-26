import { z } from "zod";
import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { enableTwoFactor } from "@/src/platform/two-factor";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: z.string().trim().min(6).max(16) });

export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:2fa:enable", limit: 10, windowMs: 15 * 60_000 } },
    async (ctx) => {
      const body = await ctx.body(bodySchema);
      const data = await enableTwoFactor(ctx.userId as string, body.code);
      return NextResponse.json(data);
    }
  );
}
