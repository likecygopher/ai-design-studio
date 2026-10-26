import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { listUserTemplates } from "@/src/platform/marketplace";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:templates", limit: 60 } },
    async (ctx) => {
      const templates = await listUserTemplates(ctx.userId as string);
      return NextResponse.json({ templates }, { headers: { "Cache-Control": "no-store" } });
    }
  );
}
