import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { getApprovedMarketplaceItem } from "@/src/platform/marketplace";

export const dynamic = "force-dynamic";

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "marketplace:item", limit: 120 } },
    async () => {
      const { id } = await context.params;
      return NextResponse.json({ item: await getApprovedMarketplaceItem(id) });
    }
  );
}
