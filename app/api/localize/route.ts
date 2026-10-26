import { writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { NextResponse } from "next/server";
import { requireUserId } from "@/src/platform/auth";
import { createUserWorkspace, type UserWorkspace } from "@/src/platform/workspace";
import { toErrorResponse } from "@/src/platform/http";
import { parseImageModelChoice } from "@/src/domain/generation-models";
import { localizeGeneratedImage } from "@/src/services/demo-api";
import {
  chooseImageProviderSize,
  readImageDimensions,
  resizeImageToExactDimensions,
  type PixelDimensions
} from "@/src/services/image-dimensions";
import { createProxyDispatcher, fetchOpenAi } from "@/src/services/image-provider";
import type { LocalAssetStore } from "@/src/services/local-asset-store";
import { readRuntimeFile } from "@/src/services/runtime-files";

const GENERATED_ROOT = join(process.cwd(), "public", "generated");
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const SUPPORTED_UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const imageEntry = form?.get("image");

  if (!form || !isUploadedFile(imageEntry)) {
    return NextResponse.json(
      { error: "请上传一张需要转换文字语言的图片。" },
      { status: 400 }
    );
  }

  const contentType = imageEntry.type.toLowerCase();
  if (!SUPPORTED_UPLOAD_TYPES.has(contentType)) {
    return NextResponse.json(
      { error: "仅支持 PNG、JPEG 或 WebP 图片。SVG 请先在浏览器中转换为 PNG。" },
      { status: 415 }
    );
  }

  const bytes = Buffer.from(await imageEntry.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "图片为空或超过 30 MB 上传限制。" },
      { status: 400 }
    );
  }

  let dimensions: PixelDimensions;
  try {
    dimensions = await readImageDimensions(bytes);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法读取原图尺寸。" },
      { status: 400 }
    );
  }

  let baseImageBytes: Buffer | undefined;
  let baseImageContentType: string | undefined;
  const baseEntry = form.get("baseImage");
  if (baseEntry !== null) {
    if (!isUploadedFile(baseEntry)) {
      return NextResponse.json({ error: "底图必须是对应素材的图片文件。" }, { status: 400 });
    }
    baseImageContentType = baseEntry.type.toLowerCase();
    if (!SUPPORTED_UPLOAD_TYPES.has(baseImageContentType)) {
      return NextResponse.json({ error: "底图仅支持 PNG、JPEG 或 WebP 图片。" }, { status: 415 });
    }
    baseImageBytes = Buffer.from(await baseEntry.arrayBuffer());
    if (!baseImageBytes.length || baseImageBytes.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "底图为空或超过 30 MB 上传限制。" }, { status: 400 });
    }
    try {
      const baseDimensions = await readImageDimensions(baseImageBytes);
      if (baseDimensions.width !== dimensions.width || baseDimensions.height !== dimensions.height) {
        return NextResponse.json({ error: `底图尺寸必须与对应原图完全一致（${dimensions.width} × ${dimensions.height}），请检查配对。` }, { status: 400 });
      }
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "无法读取底图尺寸。" }, { status: 400 });
    }
  }

  let workspace: UserWorkspace;
  try {
    const userId = await requireUserId();
    workspace = createUserWorkspace(userId);
  } catch (error) {
    return toErrorResponse(error);
  }
  const taskId = `localize-${crypto.randomUUID()}`;
  const imageStore = workspace.imageStore;
  const sourceName = safeSourceName(imageEntry.name);

  try {
    const result = await localizeGeneratedImage({
      taskId,
      sourceUrl: `upload:${sourceName}`,
      imageBytes: bytes,
      contentType,
      ...(baseImageBytes ? { baseImageBytes, baseImageContentType } : {}),
      country: String(form.get("country") ?? "Mexico"),
      language: String(form.get("language") ?? "Spanish"),
      size: chooseImageProviderSize(dimensions),
      sourceWidth: dimensions.width,
      sourceHeight: dimensions.height,
      imageModel: parseImageModelChoice(form.get("imageModel")),
      imageStore,
      costLedger: workspace.costLedger
    });
    const exactUrl = await conformOutputDimensions(
      result.url,
      dimensions,
      taskId,
      imageStore
    );

    return NextResponse.json({
      ...result,
      sourceUrl: `upload:${sourceName}`,
      url: exactUrl,
      width: dimensions.width,
      height: dimensions.height
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "本地化图片生成失败。" },
      { status: 502 }
    );
  }
}

function isUploadedFile(value: FormDataEntryValue | null | undefined): value is File {
  return (
    value !== null &&
    value !== undefined &&
    typeof value !== "string" &&
    typeof value.arrayBuffer === "function" &&
    typeof value.type === "string"
  );
}

function safeSourceName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 120) || "uploaded-image";
}

async function conformOutputDimensions(
  outputUrl: string,
  dimensions: PixelDimensions,
  taskId: string,
  imageStore: LocalAssetStore
): Promise<string> {
  const generatedBytes = await readGeneratedOutputBytes(outputUrl);
  const resized = await resizeImageToExactDimensions(generatedBytes, dimensions);

  if (outputUrl.startsWith("/generated/") && extname(outputUrl).toLowerCase() === ".png") {
    const target = resolveGeneratedPath(outputUrl);
    await writeFile(target, resized);
    return outputUrl;
  }

  const saved = await imageStore.saveGeneratedImage({
    taskId,
    filename: "localized-original-size.png",
    contentType: "image/png",
    bytes: resized
  });
  return saved.url;
}

async function readGeneratedOutputBytes(outputUrl: string): Promise<Buffer> {
  if (outputUrl.startsWith("/generated/")) {
    const file = await readRuntimeFile(
      GENERATED_ROOT,
      outputUrl.replace("/generated/", "").split("/")
    );
    if (!file) {
      throw new Error("无法读取本地化模型输出。");
    }
    return file.bytes;
  }

  const dataMatch = outputUrl.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (dataMatch) {
    return Buffer.from(dataMatch[1], "base64");
  }

  if (!/^https?:\/\//i.test(outputUrl)) {
    throw new Error("本地化模型返回了不支持的图片地址。");
  }
  const response = await fetchOpenAi(
    outputUrl,
    { method: "GET" },
    createProxyDispatcher(process.env.ARK_PROXY_URL ?? process.env.OPENAI_PROXY_URL)
  );
  if (!response.ok) {
    throw new Error(`本地化结果下载失败：HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function resolveGeneratedPath(outputUrl: string): string {
  const root = resolve(GENERATED_ROOT);
  const target = resolve(root, ...outputUrl.replace("/generated/", "").split("/"));
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error("本地化输出路径不安全。");
  }
  return target;
}
