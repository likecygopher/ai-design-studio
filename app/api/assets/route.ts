import { NextResponse } from "next/server";
import { requireUserId } from "@/src/platform/auth";
import { recordAudit } from "@/src/platform/audit";
import { toErrorResponse } from "@/src/platform/http";
import { createUserWorkspace } from "@/src/platform/workspace";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const assetId = url.searchParams.get("id");

    if (!assetId) {
      return NextResponse.json({ error: "缺少资产 id。" }, { status: 400 });
    }

    const removed = await createUserWorkspace(userId).imageStore.removeAsset(assetId);
    if (!removed) {
      return NextResponse.json({ error: "资产不存在或无权删除。" }, { status: 400 });
    }

    // Audit is fire-and-forget: a logging failure must never break the deletion.
    void recordAudit({
      userId,
      action: "asset.delete",
      targetType: "asset",
      targetId: assetId
    });

    return NextResponse.json({ removed: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
