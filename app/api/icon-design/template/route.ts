import { NextResponse } from "next/server";
import { requireUserId } from "@/src/platform/auth";
import { createUserWorkspace } from "@/src/platform/workspace";
import { toErrorResponse } from "@/src/platform/http";
import type { Asset, AssetType } from "@/src/domain/types";
import { extractIconViPromptTemplate } from "@/src/services/vi-prompt-extractor";

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const viColorAssetId = String(body?.viColorAssetId ?? "").trim();
  const viStyleAssetId = String(body?.viStyleAssetId ?? "").trim();
  if (!viColorAssetId || !viStyleAssetId) {
    return NextResponse.json({ error: "请先上传品牌色彩 VI 和 Icon 设计 VI。" }, { status: 400 });
  }

  const userId = await requireUserId();
  const imageStore = createUserWorkspace(userId).imageStore;
  const assets = await imageStore.readAssetManifest();
  const viColorAsset = findTypedAsset(assets, viColorAssetId, "icon-vi-color");
  const viStyleAsset = findTypedAsset(assets, viStyleAssetId, "icon-vi-style");
  if (!viColorAsset || !viStyleAsset) {
    return NextResponse.json({ error: "VI 素材不存在、类型不正确或已被删除。" }, { status: 400 });
  }

  const viColorImage = await imageStore.readAssetBytes(viColorAsset.id);
  const viStyleImage = await imageStore.readAssetBytes(viStyleAsset.id);
  if (
    !viColorImage ||
    !viStyleImage ||
    !SUPPORTED_IMAGE_TYPES.has(viColorImage.contentType) ||
    !SUPPORTED_IMAGE_TYPES.has(viStyleImage.contentType)
  ) {
    return NextResponse.json(
      { error: "VI 参考必须是 PNG、JPEG 或 WebP 图片。" },
      { status: 400 }
    );
  }

  try {
    const result = await extractIconViPromptTemplate({
      brandColorImage: viColorImage,
      iconGuidelineImage: viStyleImage
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "VI 规范解析失败。" },
      { status: 502 }
    );
  }
}

function findTypedAsset(assets: Asset[], id: string, type: AssetType): Asset | undefined {
  return assets.find((asset) => asset.id === id && asset.type === type);
}