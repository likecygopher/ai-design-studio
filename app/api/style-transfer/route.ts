import { NextResponse } from "next/server";
import {
  isStyleTransferStyleId,
  isStyleTransferVariantId
} from "@/src/domain/style-transfer";
import { requireUserId } from "@/src/platform/auth";
import { toErrorResponse } from "@/src/platform/http";
import { enqueueJob, serializeJob } from "@/src/platform/jobs";
import { createUserWorkspace } from "@/src/platform/workspace";
import type { Asset } from "@/src/domain/types";

const SUPPORTED_PRODUCT_TYPES = new Set<Asset["type"]>([
  "product-photo",
  "phone-shot",
  "white-background-closed",
  "white-background-open",
  "sku-product"
]);
const MAX_KEYWORDS_LENGTH = 600;

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json().catch(() => null);
    const productId = String(body?.productId ?? "").trim();
    const productAssetId = String(body?.productAssetId ?? "").trim();
    const keywords = String(body?.keywords ?? "").trim();
    const styleId = body?.styleId;
    const variantId = body?.variantId;

    if (
      !productId ||
      !productAssetId ||
      !isStyleTransferStyleId(styleId) ||
      !isStyleTransferVariantId(variantId)
    ) {
      return NextResponse.json(
        { error: "请选择产品、产品图、风格和输出构图。" },
        { status: 400 }
      );
    }
    if (keywords.length > MAX_KEYWORDS_LENGTH) {
      return NextResponse.json(
        { error: `Keywords 不能超过 ${MAX_KEYWORDS_LENGTH} 个字符。` },
        { status: 400 }
      );
    }

    const workspace = createUserWorkspace(userId);
    const product = await workspace.productRegistry.getProduct(productId);
    if (!product) {
      return NextResponse.json(
        { error: "产品不存在，请先在素材库创建产品。" },
        { status: 400 }
      );
    }

    const productAsset = product.assets.find((asset) => asset.id === productAssetId);
    if (!productAsset || !SUPPORTED_PRODUCT_TYPES.has(productAsset.type)) {
      return NextResponse.json(
        { error: "所选产品图不属于当前产品，或不是可用于风格迁移的产品图片。" },
        { status: 400 }
      );
    }

    const job = await enqueueJob({
      userId,
      type: "style-transfer",
      payload: body
    });

    return NextResponse.json({ job: serializeJob(job), async: true }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
