import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { beginTwoFactorSetup } from "@/src/platform/two-factor";

export const dynamic = "force-dynamic";

/** Start setup: returns the secret + otpauth URI; nothing is active until enable. */
export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:2fa:setup", limit: 5, windowMs: 15 * 60_000 } },
    async (ctx) => {
      const data = await beginTwoFactorSetup(ctx.userId as string);
      return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
    }
  );
}
