import { NextResponse } from "next/server";
import { isSkuReplacementMode } from "@/src/domain/sku-replacement";
import type { Asset, ProductWithProfile } from "@/src/domain/types";
import { requireUserId } from "@/src/platform/auth";
import { toErrorResponse } from "@/src/platform/http";
import { enqueueJob, serializeJob } from "@/src/platform/jobs";
import { createUserWorkspace } from "@/src/platform/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json().catch(() => null);
    const productId = String(body?.productId ?? "").trim();
    const baseAssetId = String(body?.baseAssetId ?? "").trim();
    const referenceAssetId = String(body?.referenceAssetId ?? "").trim();
    const maskAssetId = String(body?.maskAssetId ?? "").trim();
    const instruction = String(body?.instruction ?? "").trim();
    const mode = body?.mode;

    if (!productId || !baseAssetId || !isSkuReplacementMode(mode)) {
      return NextResponse.json({ error: "请选择产品、产品图和局部替换方式。" }, { status: 400 });
    }
    if (!instruction) {
      return NextResponse.json({ error: "请填写局部替换要求。" }, { status: 400 });
    }
    if (mode === "reference-part" && !referenceAssetId) {
      return NextResponse.json({ error: "参考图部件替换必须同时上传产品图和新部件图。" }, { status: 400 });
    }
    if (mode !== "reference-part" && !maskAssetId) {
      return NextResponse.json({ error: "颜色或样式替换必须先在画布中选择部件区域。" }, { status: 400 });
    }

    const workspace = createUserWorkspace(userId);
    const product = await workspace.productRegistry.getProduct(productId);
    if (!product) {
      return NextResponse.json({ error: "产品不存在，请先在产品档案中创建产品。" }, { status: 400 });
    }

    const baseAsset = findProductAsset(product, baseAssetId);
    const referenceAsset = referenceAssetId
      ? findProductAsset(product, referenceAssetId)
      : undefined;
    const maskAsset = maskAssetId ? findProductAsset(product, maskAssetId) : undefined;
    if (!baseAsset || !isBaseProductImage(baseAsset)) {
      return NextResponse.json({ error: "产品图不属于当前产品、类型不正确或已被删除。" }, { status: 400 });
    }
    if (
      mode === "reference-part" &&
      (!referenceAsset || referenceAsset.type !== "sku-reference-part")
    ) {
      return NextResponse.json({ error: "新部件图不属于当前产品、类型不正确或已被删除。" }, { status: 400 });
    }
    if (mode !== "reference-part" && (!maskAsset || maskAsset.type !== "sku-mask")) {
      return NextResponse.json({ error: "选区蒙版不属于当前产品、类型不正确或已被删除。" }, { status: 400 });
    }

    const job = await enqueueJob({
      userId,
      type: "sku-replacement",
      payload: body
    });

    return NextResponse.json({ job: serializeJob(job), async: true }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

function findProductAsset(product: ProductWithProfile, assetId: string): Asset | undefined {
  return product.assets.find((asset) => asset.id === assetId);
}

function isBaseProductImage(asset: Asset): boolean {
  return (
    asset.type === "product-photo" ||
    asset.type === "phone-shot" ||
    asset.type === "white-background-closed" ||
    asset.type === "white-background-open" ||
    asset.type === "sku-product"
  );
}
