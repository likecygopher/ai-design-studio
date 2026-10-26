import { NextResponse } from "next/server";
import { requireUserId } from "@/src/platform/auth";
import { toErrorResponse } from "@/src/platform/http";
import { createUserWorkspace } from "@/src/platform/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json().catch(() => null);
    const productId = String(body?.productId ?? "");

    if (!productId) {
      return NextResponse.json({ error: "缺少 productId。" }, { status: 400 });
    }

    const workspace = createUserWorkspace(userId);
    const result = await workspace.productRegistry.recognizeSellingPoints(productId);

    const usedLlm = Boolean(result.model && result.model !== "rule-parser");
    await workspace.costLedger.appendRecord({
      taskId: `recognize-${productId}-${Date.now()}`,
      task: "Selling-point extraction",
      model: result.model ?? "rule-parser",
      mode: usedLlm ? "openai" : "deterministic",
      country: "-",
      language: "-",
      estimatedUnits: usedLlm ? 1 : 0,
      isFallback: false,
      sourceAssetIds: result.recognizedFrom ? [result.recognizedFrom] : []
    });

    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error, 400);
  }
}
