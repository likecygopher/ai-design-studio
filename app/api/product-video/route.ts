import { NextResponse } from "next/server";
import { requireUserId } from "@/src/platform/auth";
import { ensureAiConfigHydrated } from "@/src/platform/ai-config";
import { createUserWorkspace } from "@/src/platform/workspace";
import { toErrorResponse } from "@/src/platform/http";
import { PRODUCT_VIDEO_OUTPUT } from "@/src/domain/product-video";
import type { Asset } from "@/src/domain/types";
import {
  createSeedanceVideoProvider,
  DEFAULT_SEEDANCE_FALLBACK_MODELS,
  DEFAULT_SEEDANCE_VIDEO_MODEL,
  type SeedanceVideoProvider
} from "@/src/services/video-provider";

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const savedVideoUrls = new Map<string, string>();

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await ensureAiConfigHydrated();
  const body = await request.json().catch(() => null);
  const productId = String(body?.productId ?? "").trim();
  const prompt = String(body?.prompt ?? "").trim();
  const requestedAssetId = String(body?.productAssetId ?? "").trim();

  if (!productId || !prompt) {
    return NextResponse.json({ error: "请选择产品并填写视频提示词。" }, { status: 400 });
  }

  const userId = await requireUserId();
  const workspace = createUserWorkspace(userId);
  const imageStore = workspace.imageStore;
  const product = await workspace.productRegistry.getProduct(productId);
  if (!product) {
    return NextResponse.json({ error: "产品不存在，请先在产品档案中创建产品。" }, { status: 400 });
  }

  const asset = resolveProductImage(product.assets, requestedAssetId);
  if (!asset) {
    return NextResponse.json(
      { error: "该产品没有可用的产品图片，请先在素材库上传产品照片。" },
      { status: 400 }
    );
  }

  const referenceImage = await imageStore.readAssetBytes(asset.id);
  if (!referenceImage) {
    return NextResponse.json({ error: "产品图片读取失败，请重新上传。" }, { status: 400 });
  }
  if (!isSupportedImageType(referenceImage.contentType)) {
    return NextResponse.json(
      { error: "Seedance 产品参考图仅支持 PNG、JPEG 或 WebP。" },
      { status: 400 }
    );
  }
  if (referenceImage.bytes.byteLength > MAX_REFERENCE_BYTES) {
    return NextResponse.json({ error: "产品参考图不能超过 20 MB。" }, { status: 400 });
  }

  try {
    const provider = createProvider();
    const task = await provider.createTask({ prompt, referenceImage });
    const settings = await workspace.settingsStore.read();
    await workspace.costLedger.appendRecord({
      taskId: task.taskId,
      task: "产品视频 / Hero Product Film",
      model: task.model,
      mode: "seedance-video",
      country: settings.country,
      language: settings.language,
      estimatedUnits: 1,
      isFallback: false,
      sourceAssetIds: [asset.id]
    });

    return NextResponse.json({
      ...task,
      sourceAssetId: asset.id,
      output: PRODUCT_VIDEO_OUTPUT
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "产品视频任务创建失败。" },
      { status: 502 }
    );
  }
}

export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get("taskId")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(taskId)) {
    return NextResponse.json({ error: "无效的视频任务 ID。" }, { status: 400 });
  }

  try {
    const provider = createProvider();
    const task = await provider.getTask(taskId);
    if (task.status !== "succeeded" || !task.videoUrl) {
      return NextResponse.json(task);
    }

    const cachedUrl = savedVideoUrls.get(taskId);
    if (cachedUrl) {
      return NextResponse.json({ ...task, remoteVideoUrl: task.videoUrl, videoUrl: cachedUrl });
    }

    try {
      const downloaded = await provider.downloadVideo(task.videoUrl);
      if (downloaded.bytes.byteLength > MAX_VIDEO_BYTES) {
        throw new Error("生成视频超过 250 MB，未缓存到本机。");
      }
      const saved = await createUserWorkspace(await requireUserId()).imageStore.saveGeneratedImage({
        taskId: `product-video-${taskId}`,
        filename: "hero-film.mp4",
        contentType: "video/mp4",
        bytes: downloaded.bytes
      });
      savedVideoUrls.set(taskId, saved.url);
      return NextResponse.json({ ...task, remoteVideoUrl: task.videoUrl, videoUrl: saved.url });
    } catch (error) {
      return NextResponse.json({
        ...task,
        warning: error instanceof Error ? error.message : "视频本地缓存失败。"
      });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "视频任务查询失败。" },
      { status: 502 }
    );
  }
}

function createProvider(): SeedanceVideoProvider {
  return createSeedanceVideoProvider({
    apiKey: process.env.ARK_API_KEY,
    endpointId: process.env.DOUBAO_VIDEO_ENDPOINT_ID,
    model: process.env.DOUBAO_VIDEO_MODEL ?? DEFAULT_SEEDANCE_VIDEO_MODEL,
    fallbackModels: parseFallbackModels(process.env.DOUBAO_VIDEO_FALLBACK_MODELS),
    referenceImageRole:
      process.env.DOUBAO_VIDEO_IMAGE_ROLE === "reference_image"
        ? "reference_image"
        : "first_frame",
    baseUrl: process.env.ARK_BASE_URL,
    proxyUrl: process.env.ARK_PROXY_URL
  });
}

function parseFallbackModels(value: string | undefined): string[] {
  if (!value?.trim()) {
    return DEFAULT_SEEDANCE_FALLBACK_MODELS;
  }
  return value
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
}

function resolveProductImage(assets: Asset[], requestedAssetId: string): Asset | undefined {
  const productImages = assets.filter(
    (asset) => asset.type === "product-photo" || asset.type === "phone-shot"
  );
  if (requestedAssetId) {
    return productImages.find((asset) => asset.id === requestedAssetId);
  }
  return productImages[0];
}

function isSupportedImageType(contentType: string): boolean {
  return contentType === "image/png" || contentType === "image/jpeg" || contentType === "image/webp";
}
