import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { listAdminMarketplace } from "@/src/platform/marketplace";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:marketplace:list", limit: 120 } },
    async () => {
      const url = new URL(request.url);
      const result = await listAdminMarketplace({
        status: url.searchParams.get("status") ?? undefined,
        page: Number(url.searchParams.get("page") ?? 1) || 1
      });
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
  );
}
