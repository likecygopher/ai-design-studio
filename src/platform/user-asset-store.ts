import { randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";
import type { Asset, AssetType } from "@/src/domain/types";
import type {
  LocalAssetStore,
  ResolvedAssetFile,
  SaveGeneratedImageInput,
  SaveUploadedAssetInput,
  SavedGeneratedImage
} from "@/src/services/local-asset-store";
import { PLATFORM_CONFIG } from "@/src/platform/config";
import { getActiveOrganizationId } from "@/src/platform/organizations";
import { prisma } from "@/src/platform/db";
import {
  createObjectStorage,
  type ObjectStorage
} from "@/src/platform/object-storage";
import { assertSupportedUploadContent } from "@/src/platform/storage/magic-bytes";
import {
  assertUploadByteSize,
  assertUserStorageQuota,
  type QuotaOptions
} from "@/src/platform/storage/quota";

export type UserAssetStoreOptions = {
  /**
   * Absolute directory that mirrors URL paths (`<publicDir>/uploads/...`).
   * Defaults to `<cwd>/<STORAGE_ROOT>` — the public directory used by the
   * static file routes, kept for backwards compatibility.
   */
  publicDir?: string;
  /** Single-file upload limit override (tests/embedding). */
  maxUploadBytes?: number;
  /** Per-user storage quota override (tests/embedding). */
  userStorageQuotaBytes?: number;
  /** Storage usage reader override (tests/embedding). */
  usageReader?: QuotaOptions["reader"];
  /** Object storage driver override (tests/embedding); defaults to env config. */
  storage?: ObjectStorage;
  /** Organization scope override (worker uses the job's organization). */
  organizationId?: string;
};

function sanitizePathSegment(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
  return sanitized || "default";
}

function contentTypeFromFilename(filename: string): string {
  const extension = extname(filename).toLowerCase();
  const byExtension: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4"
  };
  return byExtension[extension] ?? "application/octet-stream";
}

function getExtension(filename: string, contentType?: string): string {
  const existing = extname(filename).toLowerCase();
  if (existing && existing.length <= 8) {
    return existing;
  }
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/png") return ".png";
  if (contentType === "video/mp4") return ".mp4";
  return ".bin";
}

function toDomainAsset(row: {
  id: string;
  projectId: string;
  productId: string | null;
  type: string;
  filename: string;
  url: string;
  source: string;
  contentType: string | null;
  metadata: unknown;
}): Asset {
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? Object.fromEntries(
          Object.entries(row.metadata as Record<string, unknown>).map(([key, value]) => [
            key,
            String(value)
          ])
        )
      : undefined;

  return {
    id: row.id,
    projectId: row.projectId,
    productId: row.productId ?? undefined,
    type: row.type as AssetType,
    filename: row.filename,
    url: row.url,
    source: row.source as Asset["source"],
    metadata: {
      ...(metadata ?? {}),
      ...(row.contentType ? { contentType: row.contentType } : {})
    }
  };
}

export function createUserAssetStore(
  userId: string,
  options: UserAssetStoreOptions = {}
): LocalAssetStore {
  const publicDir = resolve(options.publicDir ?? resolve(process.cwd(), PLATFORM_CONFIG.storageRoot));
  const storage = options.storage ?? createObjectStorage({ publicDir });
  const organizationId = options.organizationId ?? getActiveOrganizationId(userId);
  const scope = { OR: [{ organizationId }, { userId }] };
  const maxUploadBytes = options.maxUploadBytes ?? PLATFORM_CONFIG.maxUploadBytes;
  const quotaOptions: QuotaOptions = {
    reader: options.usageReader,
    quotaBytes: options.userStorageQuotaBytes ?? PLATFORM_CONFIG.userStorageQuotaBytes
  };

  return {
    async saveUploadedAsset(input: SaveUploadedAssetInput): Promise<Asset> {
      const sizeBytes = input.bytes.byteLength;

      // Defense in depth: the upload route validates the same limits while the
      // batch is still in memory, but the store must not trust its callers
      // (jobs, scripts, future routes).
      assertUploadByteSize(sizeBytes, { maxBytes: maxUploadBytes, filename: input.filename });
      // The content type is decided by the magic bytes, never by the client.
      const { contentType, extension } = assertSupportedUploadContent(
        input.bytes,
        input.contentType
      );
      // Fail before writing anything so a rejected upload leaves no orphan file.
      await assertUserStorageQuota(userId, sizeBytes, quotaOptions);

      const id = `asset-${randomUUID()}`;
      const projectSegment = sanitizePathSegment(input.projectId);
      const storedFilename = `${id}${extension}`;
      const key = `uploads/${sanitizePathSegment(userId)}/${projectSegment}/${storedFilename}`;
      const url =
        storage.kind === "s3" ? `/api/assets/${id}/file` : `/${key}`;
      await storage.put(key, input.bytes, contentType);

      const metadata = {
        contentType,
        storedFilename,
        sizeBytes: String(sizeBytes)
      };

      const row = await prisma.asset.create({
        data: {
          id,
          userId,
          organizationId,
          productId: input.productId,
          projectId: input.projectId,
          type: input.type,
          filename: input.filename,
          url,
          storageKey: key,
          source: "uploaded",
          contentType,
          sizeBytes,
          metadata
        }
      });

      return toDomainAsset(row);
    },

    async saveGeneratedImage(input: SaveGeneratedImageInput): Promise<SavedGeneratedImage> {
      const sizeBytes = input.bytes.byteLength;
      // Generated bytes are produced server-side (image models / deterministic
      // template engines, including SVG) so they are not magic-byte sniffed.
      // They still consume the user's storage quota.
      await assertUserStorageQuota(userId, sizeBytes, quotaOptions);

      const id = `asset-${randomUUID()}`;
      const taskSegment = sanitizePathSegment(input.taskId);
      const extension = getExtension(
        input.filename ?? "generated.png",
        input.contentType ?? "image/png"
      );
      const key = `generated/${sanitizePathSegment(userId)}/${taskSegment}/${id}${extension}`;
      const url =
        storage.kind === "s3" ? `/api/assets/${id}/file` : `/${key}`;
      const contentType = input.contentType ?? "image/png";
      await storage.put(key, input.bytes, contentType);
      await prisma.asset.create({
        data: {
          id,
          userId,
          organizationId,
          projectId: "project-user-workspace",
          type: "product-photo",
          filename: input.filename ?? `${id}${extension}`,
          url,
          storageKey: key,
          source: "generated",
          contentType,
          sizeBytes,
          metadata: {
            contentType,
            taskId: input.taskId,
            sizeBytes: String(sizeBytes)
          }
        }
      });

      return { id, url, filePath: storage.localPath(key) ?? "" };
    },

    async readAssetManifest(): Promise<Asset[]> {
      const rows = await prisma.asset.findMany({
        where: scope,
        orderBy: { createdAt: "asc" }
      });
      return rows.map(toDomainAsset);
    },

    async readAssetBytes(assetId: string): Promise<ResolvedAssetFile | null> {
      const row = await prisma.asset.findFirst({
        where: { id: assetId, ...scope }
      });
      if (!row) {
        return null;
      }

      try {
        const bytes = await storage.get(row.storageKey);
        if (!bytes) {
          return null;
        }
        return {
          bytes: Buffer.from(bytes),
          contentType: row.contentType ?? contentTypeFromFilename(row.filename),
          filename: row.filename
        };
      } catch {
        return null;
      }
    },

    async removeAsset(assetId: string): Promise<boolean> {
      const row = await prisma.asset.findFirst({
        where: { id: assetId, ...scope }
      });
      if (!row) {
        return false;
      }

      await prisma.asset.delete({ where: { id: assetId } });
      await storage.delete(row.storageKey);
      return true;
    }
  };
}
