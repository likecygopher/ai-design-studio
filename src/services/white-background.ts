import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { buildMultiAngleWhitePrompt, type WhiteBackgroundRequest, type WhiteBackgroundOutput } from "@/src/domain/white-background";
import { inferImageModelChoice } from "@/src/domain/generation-models";
import { chooseImageProviderSize } from "./image-dimensions";
import { createDemoImageProvider } from "./demo-api";
import { createProxyDispatcher, fetchOpenAi, type ImageProvider, type SourceImage } from "./image-provider";
import type { LocalAssetStore } from "./local-asset-store";
import type { CostLedger } from "./cost-ledger";
import { ensureAiConfigHydrated } from "@/src/platform/ai-config";

export async function padWhiteBackgroundImage(bytes: Buffer, dimensions: { width: number; height: number }, whiteBackground: boolean): Promise<Buffer> {
  if (![dimensions.width, dimensions.height].every((value) => Number.isInteger(value) && value >= 1 && value <= 4096)) throw new Error("输出尺寸超出范围。");
  const image = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate();
  if (whiteBackground) image.flatten({ background: "#FFFFFF" });
  return image.resize(dimensions.width, dimensions.height, {
    fit: "contain", position: "centre", background: whiteBackground ? "#FFFFFF" : { r: 255, g: 255, b: 255, alpha: 0 }
  }).png().toBuffer();
}

export async function renderWhiteBackgroundOutput(input: WhiteBackgroundRequest, dependencies: { imageStore: LocalAssetStore; provider?: ImageProvider; costLedger?: CostLedger }): Promise<WhiteBackgroundOutput> {
  await ensureAiConfigHydrated();
  const sourceImages: SourceImage[] = [];
  for (const id of input.referenceAssetIds) {
    const file = await dependencies.imageStore.readAssetBytes(id);
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.contentType)) throw new Error("参考图无法读取，请重新选择PNG、JPG或WebP图片。");
    sourceImages.push(file);
  }
  const taskId = `white-background-${input.angle}-${randomUUID()}`;
  const prompt = buildMultiAngleWhitePrompt(input);
  // Do not persist an intermediate provider-sized image; only save the final PNG.
  const provider = dependencies.provider ?? createDemoImageProvider({ imageModel: input.imageModel });
  const result = await provider.editImage({ taskId, prompt, sourceAssetIds: input.referenceAssetIds, sourceImages, size: chooseImageProviderSize(input) });
  await dependencies.costLedger?.appendRecord({ taskId, task: "白底图多角度", model: result.model, mode: inferImageModelChoice(result.model), country: "", language: "", estimatedUnits: 1, isFallback: result.isFallback, sourceAssetIds: input.referenceAssetIds });
  if (result.isFallback) throw new Error(result.failureReason ?? "图像模型未返回有效生成结果。");
  const bytes = await readGeneratedImage(result.url);
  const finalBytes = await padWhiteBackgroundImage(bytes, input, input.whiteBackground);
  const saved = await dependencies.imageStore.saveGeneratedImage({ taskId, filename: `${input.angle}-${input.width}x${input.height}.png`, contentType: "image/png", bytes: finalBytes });
  return { angle: input.angle, url: saved.url, model: result.model, width: input.width, height: input.height, sourceAssetIds: [...input.referenceAssetIds], prompt, generatedAt: result.generatedAt };
}

async function readGeneratedImage(url: string): Promise<Buffer> {
  const data = /^data:image\/(?:png|jpeg|webp);base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(url);
  if (data) return Buffer.from(data[1], "base64");
  if (url.startsWith("/generated/") || url.startsWith("/uploads/")) {
    const root = path.resolve(process.cwd(), "public");
    const target = path.resolve(root, url.slice(1));
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("生成图片路径无效。");
    return readFile(target);
  }
  if (!/^https?:\/\//.test(url)) throw new Error("生成图片地址无效。");
  const response = await fetchOpenAi(url, { signal: AbortSignal.timeout(60_000) }, createProxyDispatcher());
  if (!response.ok) throw new Error(`生成图片下载失败（${response.status}）。`);
  return Buffer.from(await response.arrayBuffer());
}
