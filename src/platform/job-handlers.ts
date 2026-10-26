import type { GenerationJob } from "@prisma/client";
import { parseImageModelChoice } from "@/src/domain/generation-models";
import {
  buildStyleTransferPrompt,
  getStyleTransferPreset,
  getStyleTransferVariant,
  isStyleTransferStyleId,
  isStyleTransferVariantId
} from "@/src/domain/style-transfer";
import {
  buildSkuReplacementPrompt,
  isSkuReplacementMode
} from "@/src/domain/sku-replacement";
import type { Asset } from "@/src/domain/types";
import { generateDemoImage, generatePopTemplateScene } from "@/src/services/demo-api";
import { loadStyleTransferReferences } from "@/src/services/style-transfer";
import { createUserWorkspace } from "@/src/platform/workspace";
import { assertJobNotCancelled, updateJobProgress } from "@/src/platform/jobs";

const SUPPORTED_PRODUCT_TYPES = new Set<Asset["type"]>([
  "product-photo",
  "phone-shot",
  "white-background-closed",
  "white-background-open",
  "sku-product"
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function executeJob(job: GenerationJob): Promise<unknown> {
  switch (job.type) {
    case "style-transfer":
      return executeStyleTransfer(job);
    case "sku-replacement":
      return executeSkuReplacement(job);
    case "pop-scene":
      return executePopScene(job);
    default:
      throw new Error(`暂未接入异步执行的任务类型: ${job.type}`);
  }
}

async function executeStyleTransfer(job: GenerationJob) {
  const body = asRecord(job.payload);
  const productId = String(body.productId ?? "").trim();
  const productAssetId = String(body.productAssetId ?? "").trim();
  const keywords = String(body.keywords ?? "").trim();
  const styleId = body.styleId;
  const variantId = body.variantId;
  const imageModel = parseImageModelChoice(body.imageModel);

  if (
    !productId ||
    !productAssetId ||
    !isStyleTransferStyleId(styleId) ||
    !isStyleTransferVariantId(variantId)
  ) {
    throw new Error("风格迁移参数不完整。");
  }

  // Cancellation checkpoint #1: never start expensive work for a cancelled job.
  await assertJobNotCancelled(job.id);

  const workspace = createUserWorkspace(job.userId, job.id, job.organizationId ?? undefined);
  await updateJobProgress(job.id, 15);

  const product = await workspace.productRegistry.getProduct(productId);
  if (!product) {
    throw new Error("产品不存在，请先在素材库创建产品。");
  }

  const productAsset = product.assets.find((asset) => asset.id === productAssetId);
  if (!productAsset || !SUPPORTED_PRODUCT_TYPES.has(productAsset.type)) {
    throw new Error("所选产品图不可用于风格迁移。");
  }

  const preset = getStyleTransferPreset(styleId);
  const variant = getStyleTransferVariant(variantId);
  const styleReferences = await loadStyleTransferReferences(styleId);
  const settings = await workspace.settingsStore.read();
  await updateJobProgress(job.id, 35);

  // Cancellation checkpoint #2: right before the expensive AI call.
  await assertJobNotCancelled(job.id);

  const taskId = `style-transfer-${styleId}-${variantId}-${Date.now()}`;
  const prompt = buildStyleTransferPrompt({
    preset,
    variantId,
    keywords,
    productName: product.displayName ?? product.modelName ?? "the uploaded product"
  });

  const result = await generateDemoImage({
    taskId,
    taskLabel: `风格迁移 / ${preset.label} / ${variant.label}`,
    prompt,
    sourceAssetIds: [productAsset.id],
    additionalSourceImages: styleReferences,
    country: settings.country,
    language: settings.language,
    imageModel,
    size: "1536x1024",
    imageStore: workspace.imageStore,
    costLedger: workspace.costLedger
  });

  // Cancellation checkpoint #3: discard a result produced after the request.
  await assertJobNotCancelled(job.id);
  await updateJobProgress(job.id, 90);

  return {
    style: { id: preset.id, label: preset.label },
    variant: { id: variant.id, label: variant.label },
    output: {
      id: taskId,
      url: result.url,
      model: result.model,
      prompt: result.prompt,
      sourceAssetIds: result.sourceAssetIds,
      generatedAt: result.generatedAt,
      isFallback: result.isFallback
    }
  };
}

async function executeSkuReplacement(job: GenerationJob) {
  const body = asRecord(job.payload);
  const productId = String(body.productId ?? "").trim();
  const mode = body.mode;
  const baseAssetId = String(body.baseAssetId ?? "").trim();
  const referenceAssetId = String(body.referenceAssetId ?? "").trim();
  const maskAssetId = String(body.maskAssetId ?? "").trim();
  const selectionDescription = String(body.selectionDescription ?? "").trim();
  const instruction = String(body.instruction ?? "").trim();
  const imageModel = parseImageModelChoice(body.imageModel);

  if (!productId || !baseAssetId || !isSkuReplacementMode(mode)) {
    throw new Error("SKU 替换参数不完整。");
  }

  // Cancellation checkpoint #1: never start expensive work for a cancelled job.
  await assertJobNotCancelled(job.id);

  const workspace = createUserWorkspace(job.userId, job.id, job.organizationId ?? undefined);
  await updateJobProgress(job.id, 15);

  const product = await workspace.productRegistry.getProduct(productId);
  if (!product) {
    throw new Error("产品不存在，请先在素材库创建产品。");
  }

  const settings = await workspace.settingsStore.read();
  if (!instruction) {
    throw new Error("请填写局部替换要求。");
  }
  if (mode === "reference-part" && !referenceAssetId) {
    throw new Error("参考图部件替换必须同时上传产品图和新部件图。");
  }
  if (mode !== "reference-part" && !maskAssetId) {
    throw new Error("颜色或样式替换必须先在画布中选择部件区域。");
  }

  const prompt = buildSkuReplacementPrompt({
    mode,
    instruction,
    selectionDescription: selectionDescription || undefined,
    maskAsReference: imageModel === "doubao"
  });

  await updateJobProgress(job.id, 35);

  const sourceAssetIds = [baseAssetId];
  if (mode === "reference-part" && referenceAssetId) {
    sourceAssetIds.push(referenceAssetId);
  }

  // Cancellation checkpoint #2: right before the expensive AI call.
  await assertJobNotCancelled(job.id);

  const taskId = `sku-${mode}-${Date.now()}`;
  const result = await generateDemoImage({
    taskId,
    taskLabel: `SKU 局部替换 / ${mode}`,
    prompt,
    sourceAssetIds,
    maskAssetId: maskAssetId || undefined,
    country: settings.country,
    language: settings.language,
    imageModel,
    imageStore: workspace.imageStore,
    costLedger: workspace.costLedger
  });

  // Cancellation checkpoint #3: discard a result produced after the request.
  await assertJobNotCancelled(job.id);
  await updateJobProgress(job.id, 90);

  return {
    output: {
      id: taskId,
      mode,
      url: result.url,
      model: result.model,
      prompt: result.prompt,
      sourceAssetIds: result.sourceAssetIds,
      generatedAt: result.generatedAt
    }
  };
}

async function executePopScene(job: GenerationJob) {
  const body = asRecord(job.payload);

  // Cancellation checkpoint #1: never start expensive work for a cancelled job.
  await assertJobNotCancelled(job.id);

  const workspace = createUserWorkspace(job.userId, job.id, job.organizationId ?? undefined);
  await updateJobProgress(job.id, 20);

  const product = body.productId
    ? await workspace.productRegistry.getProduct(String(body.productId))
    : null;
  const settings = await workspace.settingsStore.read();

  await updateJobProgress(job.id, 40);

  // Cancellation checkpoint #2: right before the expensive AI call.
  await assertJobNotCancelled(job.id);

  const result = await generatePopTemplateScene({
    taskId: String(body.taskId ?? `task-pop-${Date.now()}`),
    templateId: String(body.templateId ?? ""),
    product: product ?? undefined,
    productAssetId: body.productAssetId ? String(body.productAssetId) : undefined,
    placement: String(body.placement ?? "front"),
    textValues: (body.textValues as Record<string, string>) ?? {},
    imageAssetIds: (body.imageAssetIds as Record<string, string>) ?? {},
    imageModel: parseImageModelChoice(body.imageModel),
    popImageBase64: body.popImageBase64 ? String(body.popImageBase64) : undefined,
    country: settings.country,
    language: settings.language,
    imageStore: workspace.imageStore,
    costLedger: workspace.costLedger
  });

  // Cancellation checkpoint #3: discard a result produced after the request.
  await assertJobNotCancelled(job.id);
  await updateJobProgress(job.id, 90);
  return result;
}
