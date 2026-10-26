import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildPopScenePrompt, getPopTemplate, renderPopFlatSvg } from "@/src/domain/pop";
import { buildPdpDocument, getMissingPdpImageSlots, type PdpDocument } from "@/src/domain/pdp";
import type { PdpCanvasLayout } from "@/src/domain/pdp-canvas-layout";
import {
  DEFAULT_IMAGE_MODEL_CHOICE,
  inferImageModelChoice,
  type ImageModelChoice
} from "@/src/domain/generation-models";
import { renderPdpSvg } from "@/src/domain/pdp-export";
import type { ProductWithProfile, SellingPoint } from "@/src/domain/types";
import {
  createImageProvider,
  DEFAULT_IMAGE_MODEL,
  type ImageProvider,
  type ImageProviderInput,
  type ImageProviderResult,
  type SourceImage
} from "@/src/services/image-provider";
import type { CostLedger, CostLedgerRecord } from "@/src/services/cost-ledger";
import { createDoubaoImageProvider, DEFAULT_DOUBAO_IMAGE_MODEL } from "@/src/services/doubao-image-provider";
import { createDefaultCostLedger } from "@/src/services/cost-ledger";
import type { LocalAssetStore } from "@/src/services/local-asset-store";
import { createDefaultLocalAssetStore } from "@/src/services/local-asset-store";
import { ensureAiConfigHydrated } from "@/src/platform/ai-config";

export type GenerateDemoImageInput = {
  taskId: string;
  taskLabel?: string;
  prompt: string;
  sourceAssetIds: string[];
  additionalSourceImages?: Array<SourceImage & { sourceId: string }>;
  maskAssetId?: string;
  country?: string;
  language?: string;
  imageModel?: ImageModelChoice;
  size?: ImageProviderInput["size"];
  imageStore?: LocalAssetStore;
  costLedger?: CostLedger;
  provider?: ImageProvider;
};

export type DemoCostRecord = {
  taskId?: string;
  task: string;
  model: string;
  mode: string;
  country: string;
  language: string;
  estimatedUnits: number;
  isFallback?: boolean;
  sourceAssetIds?: string[];
  createdAt?: string;
};

const RASTER_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function createDemoAssetStore(): LocalAssetStore {
  return createDefaultLocalAssetStore();
}

export async function resolveSourceImages(
  imageStore: LocalAssetStore | undefined,
  sourceAssetIds: string[]
): Promise<SourceImage[]> {
  if (!imageStore) {
    return [];
  }

  const resolved: SourceImage[] = [];
  for (const assetId of sourceAssetIds) {
    const file = await imageStore.readAssetBytes(assetId);
    if (file && RASTER_IMAGE_TYPES.has(file.contentType)) {
      resolved.push({
        bytes: file.bytes,
        contentType: file.contentType,
        filename: file.filename
      });
    }
  }
  return resolved;
}

export function createDemoImageProvider(options: {
  imageStore?: LocalAssetStore;
  imageModel?: ImageModelChoice;
}): ImageProvider {
  const imageModel = options.imageModel ?? DEFAULT_IMAGE_MODEL_CHOICE;
  if (imageModel === "doubao") {
    return createDoubaoImageProvider({
      apiKey: process.env.ARK_API_KEY,
      model: process.env.DOUBAO_IMAGE_MODEL ?? DEFAULT_DOUBAO_IMAGE_MODEL,
      baseUrl: process.env.ARK_BASE_URL,
      imageStore: options.imageStore
    });
  }

  return createImageProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL,
    baseUrl: process.env.OPENAI_BASE_URL,
    imageStore: options.imageStore
  });
}

export async function generateDemoImage(
  input: GenerateDemoImageInput
): Promise<ImageProviderResult> {
  await ensureAiConfigHydrated();
  const provider =
    input.provider ??
    createDemoImageProvider({ imageStore: input.imageStore, imageModel: input.imageModel });

  const storedSourceImages = await resolveSourceImages(input.imageStore, input.sourceAssetIds);
  const additionalSourceImages = input.additionalSourceImages ?? [];
  const sourceImages: SourceImage[] = [
    ...storedSourceImages,
    ...additionalSourceImages.map(({ sourceId: _sourceId, ...image }) => image)
  ];
  const maskImage = input.maskAssetId
    ? (await resolveSourceImages(input.imageStore, [input.maskAssetId]))[0]
    : undefined;
  if (input.maskAssetId && !maskImage) {
    throw new Error("选区蒙版不存在或不是受支持的 PNG、JPEG、WebP 图片。");
  }
  const sourceAssetIds = [
    ...input.sourceAssetIds,
    ...additionalSourceImages.map((image) => image.sourceId),
    ...(input.maskAssetId ? [input.maskAssetId] : [])
  ];
  const providerInput = {
    taskId: input.taskId,
    prompt: input.prompt,
    sourceAssetIds,
    ...(sourceImages.length ? { sourceImages } : {}),
    ...(maskImage ? { maskImage } : {}),
    ...(input.size ? { size: input.size } : {})
  };

  const result = sourceImages.length || maskImage
    ? await provider.editImage(providerInput)
    : await provider.generateImage(providerInput);

  await recordGenerationCost(
    { ...input, sourceAssetIds },
    result,
    input.taskLabel ?? "Image generation"
  );

  return result;
}

export type GeneratePopTemplateSceneInput = {
  taskId: string;
  templateId: string;
  productId?: string;
  /** Full product object (e.g. from the product registry); wins over productId lookup. */
  product?: ProductWithProfile;
  productAssetId?: string;
  placement: string;
  country: string;
  language: string;
  textValues: Record<string, string>;
  imageAssetIds: Record<string, string>;
  popImageBase64?: string;
  imageModel?: ImageModelChoice;
  size?: ImageProviderInput["size"];
  imageStore?: LocalAssetStore;
  costLedger?: CostLedger;
  provider?: ImageProvider;
};

export type PopTemplateSceneResult = {
  flatUrl: string;
  flatPngUrl?: string;
  scene: ImageProviderResult;
  templateId: string;
  templateVersion: string;
};

export async function generatePopTemplateScene(
  input: GeneratePopTemplateSceneInput
): Promise<PopTemplateSceneResult> {
  await ensureAiConfigHydrated();
  const template = getPopTemplate(input.templateId);
  const product = input.product;
  if (!product) {
    throw new Error("请先在素材库创建产品并上传素材,再执行生成。");
  }
  const productName = product.displayName ?? "Uploaded product";
  const productAssetId =
    input.productAssetId ??
    product.assets.find((asset) => asset.type === "product-photo")?.id;

  // Resolve user-selected slot images into data URIs for the flat artwork.
  const imageDataUris: Record<string, string> = {};
  for (const [slotId, assetId] of Object.entries(input.imageAssetIds)) {
    const file = assetId ? await input.imageStore?.readAssetBytes(assetId) : null;
    if (file && file.contentType.startsWith("image/")) {
      imageDataUris[slotId] = `data:${file.contentType};base64,${file.bytes.toString("base64")}`;
    }
  }

  const flatSvg = renderPopFlatSvg({
    templateId: template.id,
    textValues: input.textValues,
    imageDataUris
  });

  const savedFlat = await input.imageStore?.saveGeneratedImage({
    taskId: input.taskId,
    filename: `${template.id}-flat.svg`,
    contentType: "image/svg+xml",
    bytes: Buffer.from(flatSvg, "utf8")
  });

  let flatPngUrl: string | undefined;
  let popPngBytes: Buffer | undefined;
  if (input.popImageBase64) {
    popPngBytes = Buffer.from(input.popImageBase64, "base64");
    const savedPng = await input.imageStore?.saveGeneratedImage({
      taskId: input.taskId,
      filename: `${template.id}-flat.png`,
      contentType: "image/png",
      bytes: popPngBytes
    });
    flatPngUrl = savedPng?.url;
  }

  await input.costLedger?.appendRecord({
    taskId: input.taskId,
    task: `POP flat render (${template.name})`,
    model: "template-engine",
    mode: "deterministic",
    country: input.country,
    language: input.language,
    estimatedUnits: 0,
    isFallback: false,
    sourceAssetIds: Object.values(input.imageAssetIds).filter(Boolean)
  });

  const provider =
    input.provider ??
    createDemoImageProvider({ imageStore: input.imageStore, imageModel: input.imageModel });

  const sourceAssetIds = [
    ...(productAssetId ? [productAssetId] : []),
    savedFlat?.id ?? "pop-flat-render"
  ];
  const sourceImages = await resolveSourceImages(
    input.imageStore,
    productAssetId ? [productAssetId] : []
  );
  if (popPngBytes) {
    sourceImages.push({
      bytes: popPngBytes,
      contentType: "image/png",
      filename: `${template.id}-flat.png`
    });
  }

  const prompt = buildPopScenePrompt({
    productName,
    placement: input.placement,
    flatPopAssetId: savedFlat?.id ?? "pop-flat-render"
  });

  const scene = await provider.editImage({
    taskId: `${input.taskId}-scene`,
    prompt,
    sourceAssetIds,
    ...(sourceImages.length ? { sourceImages } : {})
  });

  await input.costLedger?.appendRecord({
    taskId: `${input.taskId}-scene`,
    task: `POP product scene (${template.name})`,
    model: scene.model,
    mode: inferImageModelChoice(scene.model),
    country: input.country,
    language: input.language,
    estimatedUnits: 1,
    isFallback: false,
    sourceAssetIds
  });

  return {
    flatUrl: savedFlat?.url ?? "",
    flatPngUrl,
    scene,
    templateId: template.id,
    templateVersion: template.version
  };
}

export type ExportDemoPdpInput = {
  taskId: string;
  country: string;
  language: string;
  productId?: string;
  /** Full product object (e.g. from the product registry); wins over productId lookup. */
  product?: ProductWithProfile;
  templateVersion?: string;
  sellingPoints?: SellingPoint[];
  sectionImages?: Record<string, string>;
  coverAssetId?: string;
  coverTitle?: string;
  coverSubtitle?: string;
  brandMessage?: string;
  layout?: PdpCanvasLayout;
  imageStore?: LocalAssetStore;
  costLedger?: CostLedger;
};

export type ExportDemoPdpResult = {
  taskId: string;
  url: string;
  templateVersion: string;
  sectionCount: number;
  missingImageSlots: string[];
  isFallback: boolean;
};

export async function exportDemoPdp(input: ExportDemoPdpInput): Promise<ExportDemoPdpResult> {
  const product = input.product;
  if (!product) {
    throw new Error("请先在素材库创建产品并上传素材,再执行生成。");
  }
  const productName = product.displayName ?? "Uploaded product";
  const sellingPoints = input.sellingPoints?.length
    ? input.sellingPoints
    : product.profile.detectedFeatures;
  const sectionImages = input.sectionImages ?? {};
  const coverAssetId =
    input.coverAssetId ?? product.assets.find((asset) => asset.type === "product-photo")?.id ?? "asset-cover";
  const templateVersion = input.templateVersion ?? "pdp-tree-v3";

  const document = buildPdpDocument({
    id: `pdp-${input.country.toLowerCase()}-${input.language.toLowerCase()}-${Date.now()}`,
    productId: product.id,
    country: input.country,
    language: input.language,
    templateVersion,
    cover: {
      title: input.coverTitle || productName,
      subtitle: input.coverSubtitle || `${input.country} / ${input.language}`,
      imageAssetId: coverAssetId
    },
    brandMessage: input.brandMessage || product.profile.valueProposition,
    sellingPoints,
    sectionImageBySellingPointId: sectionImages
  });

  // Embed every referenced asset that resolves to a real raster image.
  const assetIds = [
    coverAssetId,
    ...document.sections.flatMap((section) =>
      section.largeImageAssetId ? [section.largeImageAssetId] : []
    )
  ];
  const imageDataUris: Record<string, string> = {};
  for (const assetId of new Set(assetIds)) {
    const file = await input.imageStore?.readAssetBytes(assetId);
    if (file && file.contentType.startsWith("image/")) {
      imageDataUris[assetId] = `data:${file.contentType};base64,${file.bytes.toString("base64")}`;
    }
  }

  const specification: Array<[string, string]> = sellingPoints
    .filter((point) => point.enabled !== false)
    .map((point) => [point.title, point.benefit]);

  let brandImageDataUri: string | undefined;
  try {
    const brandImage = await readFile(path.join(process.cwd(), "public", "pdp", "midea-brand-no1.png"));
    brandImageDataUri = `data:image/png;base64,${brandImage.toString("base64")}`;
  } catch {
    brandImageDataUri = undefined;
  }

  const svg = renderPdpSvg(document, productName, {
    imageDataUris,
    specification,
    layout: input.layout,
    brandImageDataUri
  });

  const saved = await input.imageStore?.saveGeneratedImage({
    taskId: input.taskId,
    filename: `${document.id}.svg`,
    contentType: "image/svg+xml",
    bytes: Buffer.from(svg, "utf8")
  });

  await input.costLedger?.appendRecord({
    taskId: input.taskId,
    task: "PDP long image export",
    model: "template-engine",
    mode: "deterministic",
    country: input.country,
    language: input.language,
    estimatedUnits: 0,
    isFallback: false,
    sourceAssetIds: assetIds
  });

  return {
    taskId: input.taskId,
    url: saved?.url ?? "",
    templateVersion,
    sectionCount: document.sections.length,
    missingImageSlots: getMissingPdpImageSlots(document),
    isFallback: false
  };
}

export type LocalizeImageInput = {
  taskId: string;
  sourceUrl: string;
  imageBytes: Buffer;
  contentType: string;
  /** Optional clean canvas paired with this source; always follows the original reference. */
  baseImageBytes?: Buffer;
  baseImageContentType?: string;
  country: string;
  language: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536";
  sourceWidth?: number;
  sourceHeight?: number;
  imageModel?: ImageModelChoice;
  imageStore?: LocalAssetStore;
  costLedger?: CostLedger;
  provider?: ImageProvider;
};

export type LocalizeImageResult = ImageProviderResult & { sourceUrl: string };

/** Replaces the visible text of a previously generated image with the target market language. */
export async function localizeGeneratedImage(
  input: LocalizeImageInput
): Promise<LocalizeImageResult> {
  await ensureAiConfigHydrated();
  const provider =
    input.provider ??
    createDemoImageProvider({ imageStore: input.imageStore, imageModel: input.imageModel });

  const prompt = [
    `Take the provided marketing image and replace ALL visible text with ${input.language}`,
    `translations appropriate for the ${input.country} market.`,
    "Keep the product appearance, layout, composition, colors, logo, and branding exactly the same.",
    input.sourceWidth && input.sourceHeight
      ? `Preserve the original ${input.sourceWidth}x${input.sourceHeight} canvas ratio and keep every text block and key object inside the safe area.`
      : "Preserve the original canvas ratio and safe area.",
    "Only the text language changes; do not add or remove any graphic elements.",
    ...(input.baseImageBytes ? [
      "Image 1 is the original reference: read all source text, branding, and text positions from Image 1.",
      "Image 2 is the corresponding clean base: use its clean product, background and layout as the output canvas, then place translated text in the matching positions from Image 1.",
      "Do not copy the old text back onto the clean base. Keep the source product and layout unchanged."
    ] : [])
  ].join(" ");

  const sourceImages = RASTER_IMAGE_TYPES.has(input.contentType)
    ? [
        {
          bytes: input.imageBytes,
          contentType: input.contentType,
          filename: input.sourceUrl.split("/").pop() ?? "source.png"
        }
      ]
    : [];

  if (input.baseImageBytes) {
    if (!sourceImages.length || !input.baseImageContentType || !RASTER_IMAGE_TYPES.has(input.baseImageContentType)) {
      throw new Error("原图与底图必须为对应的 PNG、JPEG 或 WebP 图片。");
    }
    sourceImages.push({ bytes: input.baseImageBytes, contentType: input.baseImageContentType, filename: "paired-clean-base" + (input.baseImageContentType === "image/jpeg" ? ".jpg" : input.baseImageContentType === "image/webp" ? ".webp" : ".png") });
  }

  const result = await provider.editImage({
    taskId: input.taskId,
    prompt,
    sourceAssetIds: [input.sourceUrl],
    ...(sourceImages.length ? { sourceImages } : {}),
    ...(input.size ? { size: input.size } : {})
  });

  await input.costLedger?.appendRecord({
    taskId: input.taskId,
    task: "Localization text replacement",
    model: result.model,
    mode: inferImageModelChoice(result.model),
    country: input.country,
    language: input.language,
    estimatedUnits: 1,
    isFallback: false,
    sourceAssetIds: [input.sourceUrl]
  });

  return { ...result, sourceUrl: input.sourceUrl };
}

export type CostAggregateRow = { key: string; records: number; units: number };

export type CostAggregateSummary = {
  byTask: CostAggregateRow[];
  byCountry: CostAggregateRow[];
  byLanguage: CostAggregateRow[];
  byMode: CostAggregateRow[];
};

export function aggregateCostRecords(records: DemoCostRecord[]): CostAggregateSummary {
  function groupBy(selectKey: (record: DemoCostRecord) => string): CostAggregateRow[] {
    const rows = new Map<string, CostAggregateRow>();
    for (const record of records) {
      const key = selectKey(record);
      const row = rows.get(key) ?? { key, records: 0, units: 0 };
      row.records += 1;
      row.units += record.estimatedUnits;
      rows.set(key, row);
    }
    return Array.from(rows.values());
  }

  return {
    byTask: groupBy((record) => record.task),
    byCountry: groupBy((record) => record.country),
    byLanguage: groupBy((record) => record.language),
    byMode: groupBy((record) => record.mode)
  };
}

export async function readDemoCostRecords(
  ledger: CostLedger = createDefaultCostLedger()
): Promise<DemoCostRecord[]> {
  const liveRecords = await ledger.readRecords();
  return liveRecords.map(toDemoCostRecord);
}

async function recordGenerationCost(
  input: Pick<
    GenerateDemoImageInput,
    "taskId" | "taskLabel" | "sourceAssetIds" | "country" | "language" | "costLedger"
  >,
  result: ImageProviderResult,
  fallbackTaskLabel: string
): Promise<void> {
  if (!input.costLedger) {
    return;
  }

  await input.costLedger.appendRecord({
    taskId: input.taskId,
    task: input.taskLabel ?? fallbackTaskLabel,
    model: result.model,
    mode: inferImageModelChoice(result.model),
    country: input.country ?? "Demo market",
    language: input.language ?? "Demo language",
    estimatedUnits: 1,
    isFallback: false,
    sourceAssetIds: result.sourceAssetIds
  });
}

function toDemoCostRecord(record: CostLedgerRecord): DemoCostRecord {
  return {
    taskId: record.taskId,
    task: record.task,
    model: record.model,
    mode: record.mode,
    country: record.country,
    language: record.language,
    estimatedUnits: record.estimatedUnits,
    isFallback: record.isFallback,
    sourceAssetIds: record.sourceAssetIds,
    createdAt: record.createdAt
  };
}

