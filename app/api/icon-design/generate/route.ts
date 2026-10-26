import { NextResponse } from "next/server";
import { requireUserId } from "@/src/platform/auth";
import { createUserWorkspace } from "@/src/platform/workspace";
import { toErrorResponse } from "@/src/platform/http";
import {
  buildIconDesignPrompt,
  DEFAULT_ICON_VI_PROMPT_TEMPLATE,
  getIconDesignVariant,
  isIconDesignVariantId
} from "@/src/domain/icon-design";
import { parseImageModelChoice } from "@/src/domain/generation-models";
import type { Asset, AssetType } from "@/src/domain/types";
import { generateDemoImage } from "@/src/services/demo-api";
import type { LocalAssetStore } from "@/src/services/local-asset-store";

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const BRAND_REFERENCE_TYPES = new Set<AssetType>([
  "brand-guide",
  "icon-vi-color",
  "icon-vi-style"
]);
const MAX_BRAND_REFERENCES = 4;

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const variantId = body?.variantId;
  const sourceIconAssetId = String(body?.sourceIconAssetId ?? "").trim();
  const featureTitle = String(body?.featureTitle ?? "").trim();
  const imageModel = parseImageModelChoice(body?.imageModel);

  if (!isIconDesignVariantId(variantId)) {
    return NextResponse.json({ error: "Icon Design 输出规格不正确。" }, { status: 400 });
  }
  if (!sourceIconAssetId) {
    return NextResponse.json({ error: "请上传待规范化 Icon。" }, { status: 400 });
  }
  if (!featureTitle) {
    return NextResponse.json({ error: "请填写卖点标题。" }, { status: 400 });
  }

  const userId = await requireUserId();
  const workspace = createUserWorkspace(userId);
  const imageStore = workspace.imageStore;
  const assets = await imageStore.readAssetManifest();
  const sourceIcon = assets.find(
    (asset) => asset.id === sourceIconAssetId && asset.type === "icon-source"
  );
  if (!sourceIcon) {
    return NextResponse.json(
      { error: "待规范化 Icon 不存在、类型不正确或已被删除。" },
      { status: 400 }
    );
  }

  const sourceFile = await imageStore.readAssetBytes(sourceIcon.id);
  if (!sourceFile || !SUPPORTED_IMAGE_TYPES.has(sourceFile.contentType)) {
    return NextResponse.json(
      { error: `${sourceIcon.filename} 不是受支持的 PNG、JPEG 或 WebP 图片。` },
      { status: 400 }
    );
  }

  const brandReferenceIds = await findBrandReferenceIds(assets, imageStore);

  try {
    const variant = getIconDesignVariant(variantId);
    const settings = await workspace.settingsStore.read();
    const taskId = `icon-design-${variant.id}-${Date.now()}`;
    const prompt = buildIconDesignPrompt({
      template: DEFAULT_ICON_VI_PROMPT_TEMPLATE,
      featureTitle,
      variantId
    });
    const sourceAssetIds = [sourceIconAssetId, ...brandReferenceIds];
    const result = await generateDemoImage({
      taskId,
      taskLabel: `Icon Design / ${variant.label}`,
      prompt,
      sourceAssetIds,
      country: settings.country,
      language: settings.language,
      imageModel,
      size: variant.size,
      imageStore,
      costLedger: workspace.costLedger
    });

    return NextResponse.json({
      output: {
        id: taskId,
        variantId: variant.id,
        label: variant.label,
        group: variant.group,
        size: variant.size,
        url: result.url,
        model: result.model,
        prompt: result.prompt,
        sourceAssetIds: result.sourceAssetIds,
        generatedAt: result.generatedAt
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Icon Design 生成失败。" },
      { status: 502 }
    );
  }
}

async function findBrandReferenceIds(
  assets: Asset[],
  imageStore: LocalAssetStore
): Promise<string[]> {
  const ids: string[] = [];
  for (const asset of [...assets].reverse()) {
    if (!BRAND_REFERENCE_TYPES.has(asset.type)) {
      continue;
    }
    const file = await imageStore.readAssetBytes(asset.id);
    if (!file || !SUPPORTED_IMAGE_TYPES.has(file.contentType)) {
      continue;
    }
    ids.push(asset.id);
    if (ids.length === MAX_BRAND_REFERENCES) {
      break;
    }
  }
  return ids;
}