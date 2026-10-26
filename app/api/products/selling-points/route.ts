import { NextResponse } from "next/server";
import type { SellingPoint } from "@/src/domain/types";
import { requireUserId } from "@/src/platform/auth";
import { toErrorResponse } from "@/src/platform/http";
import { createUserWorkspace } from "@/src/platform/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json().catch(() => null);
    const productId = String(body?.productId ?? "");

    if (!productId || !Array.isArray(body?.sellingPoints)) {
      return NextResponse.json({ error: "缺少 productId 或 sellingPoints。" }, { status: 400 });
    }

    const points: SellingPoint[] = body.sellingPoints
      .filter((item: unknown): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item: Record<string, unknown>, index: number) => ({
        id: String(item.id ?? `feature-manual-${index + 1}`),
        title: String(item.title ?? ""),
        shortLabel: String(item.shortLabel ?? item.title ?? ""),
        benefit: String(item.benefit ?? ""),
        technicalProof: item.technicalProof ? String(item.technicalProof) : undefined,
        priority: Number(item.priority ?? index + 1),
        enabled: item.enabled === false ? false : true
      }))
      .filter((point: SellingPoint) => point.title.length > 0);

    const product = await createUserWorkspace(userId).productRegistry.updateSellingPoints(
      productId,
      points
    );
    return NextResponse.json({ product });
  } catch (error) {
    return toErrorResponse(error, 400);
  }
}
