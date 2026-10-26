import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { getTwoFactorStatus } from "@/src/platform/two-factor";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:2fa:read", limit: 60, windowMs: 60_000 } },
    async (ctx) => {
      const status = await getTwoFactorStatus(ctx.userId as string);
      return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
    }
  );
}
