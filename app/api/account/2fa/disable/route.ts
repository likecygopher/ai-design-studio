import { z } from "zod";
import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { disableTwoFactor } from "@/src/platform/two-factor";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: z.string().trim().min(6).max(32) });

export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:2fa:disable", limit: 10, windowMs: 15 * 60_000 } },
    async (ctx) => {
      const body = await ctx.body(bodySchema);
      await disableTwoFactor(ctx.userId as string, body.code);
      return NextResponse.json({ enabled: false });
    }
  );
}
