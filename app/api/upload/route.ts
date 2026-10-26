import { NextResponse } from "next/server";
import type { Asset, AssetType } from "@/src/domain/types";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { ValidationError } from "@/src/platform/errors";
import { assertSupportedUploadContent } from "@/src/platform/storage/magic-bytes";
import {
  assertUploadByteSize,
  assertUploadFileCount,
  assertUserStorageQuota
} from "@/src/platform/storage/quota";
import { createUserWorkspace } from "@/src/platform/workspace";

const allowedAssetTypes = new Set<AssetType>([
  "product-photo",
  "phone-shot",
  "brand-guide",
  "template-reference",
  "feature-icon",
  "background",
  "pop-input",
  "pdp-input",
  "white-background-closed",
  "white-background-open",
  "sku-product",
  "sku-reference-part",
  "sku-mask",
  "icon-vi-color",
  "icon-vi-style",
  "icon-source",
  "document"
]);

const MAX_PROJECT_ID_LENGTH = 200;
const MAX_FILENAME_LENGTH = 255;

export const dynamic = "force-dynamic";

/**
 * `instanceof File` breaks when the request comes from a different FormData
 * implementation (Node/undici vs. the test DOM). Duck-typing is equivalent and
 * also keeps non-file form values from being treated as uploads.
 */
function isUploadedFile(value: unknown): value is File {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<File>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.size === "number" &&
    typeof candidate.arrayBuffer === "function"
  );
}

function readFormString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

type PreparedUpload = {
  filename: string;
  /** Canonical type decided by magic bytes. */
  contentType: string;
  bytes: Buffer;
};

export async function GET(request: Request) {
  return handleApi(request, { auth: "user", rateLimit: false }, async (ctx) => {
    const store = createUserWorkspace(ctx.userId as string).imageStore;
    return NextResponse.json({ assets: await store.readAssetManifest() });
  });
}

export async function POST(request: Request) {
  return handleApi(request, { auth: "user", rateLimit: { name: "upload" } }, async (ctx) => {
    let form: FormData;
    try {
      form = await ctx.form();
    } catch {
      throw new ValidationError("请求体必须是 multipart/form-data。");
    }

    const projectId = readFormString(form.get("projectId")).trim() || "project-user-workspace";
    if (projectId.length > MAX_PROJECT_ID_LENGTH) {
      throw new ValidationError("projectId 过长。");
    }
    const rawProductId = readFormString(form.get("productId")).trim();
    if (rawProductId.length > MAX_PROJECT_ID_LENGTH) {
      throw new ValidationError("productId 过长。");
    }
    const productId = rawProductId || undefined;
    const requestedType = readFormString(form.get("type")) as AssetType;
    const type = allowedAssetTypes.has(requestedType) ? requestedType : "product-photo";

    const files = form.getAll("files").filter(isUploadedFile);
    if (files.length === 0) {
      throw new ValidationError("No files uploaded.");
    }
    assertUploadFileCount(files.length);

    // Phase 1: validate every file while it is still in memory. Nothing is
    // written until the whole batch has passed, so a rejected request leaves no
    // partial files behind (design §7).
    const prepared: PreparedUpload[] = [];
    for (const file of files) {
      // Cheap pre-check before buffering the whole file.
      assertUploadByteSize(file.size, { filename: file.name });
      const bytes = Buffer.from(await file.arrayBuffer());
      assertUploadByteSize(bytes.byteLength, { filename: file.name });
      const { contentType } = assertSupportedUploadContent(bytes, file.type);
      prepared.push({
        filename: (file.name || "upload").slice(0, MAX_FILENAME_LENGTH),
        contentType,
        bytes
      });
    }

    // Phase 2: user quota is checked against the batch total.
    const totalBytes = prepared.reduce((sum, upload) => sum + upload.bytes.byteLength, 0);
    const usage = await assertUserStorageQuota(ctx.userId as string, totalBytes);

    // Phase 3: persist files, then their DB rows.
    const store = createUserWorkspace(ctx.userId as string).imageStore;
    const assets: Asset[] = [];
    for (const upload of prepared) {
      assets.push(
        await store.saveUploadedAsset({
          projectId,
          productId,
          type,
          filename: upload.filename,
          contentType: upload.contentType,
          bytes: upload.bytes
        })
      );
    }

    void recordAudit({
      userId: ctx.userId,
      actorRole: ctx.role,
      action: "asset.upload",
      targetType: "asset",
      targetId: assets.length === 1 ? assets[0]?.id : undefined,
      metadata: {
        count: assets.length,
        totalBytes,
        usedBytesAfter: usage.usedBytes + totalBytes
      },
      ip: ctx.ip,
      requestId: ctx.requestId
    });

    return NextResponse.json({ assets });
  });
}
