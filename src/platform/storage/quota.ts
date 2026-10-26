/**
 * Upload / storage quota primitives (spec R5.2, design §7).
 *
 * Two independent limits:
 * - per-request shape: file count and single-file size;
 * - per-user storage: `sum(Asset.sizeBytes) + incoming <= USER_STORAGE_QUOTA_BYTES`.
 *
 * The DB aggregate is isolated behind `StorageUsageReader` so the pure math can
 * be unit tested (and so a future object-storage backend can plug its own
 * accounting without touching call sites).
 */
import { PLATFORM_CONFIG } from "@/src/platform/config";
import { prisma } from "@/src/platform/db";
import { PayloadTooLargeError, StorageQuotaError } from "@/src/platform/errors";

export type StorageUsageSnapshot = {
  userId: string;
  /** Bytes already stored by the user (sum of Asset.sizeBytes). */
  usedBytes: number;
  /** Bytes about to be stored by this request. */
  incomingBytes: number;
  quotaBytes: number;
  /** Bytes left after the incoming payload; never negative. */
  remainingBytes: number;
};

export type StorageUsageReader = {
  readUsedBytes(userId: string): Promise<number>;
};

export const prismaStorageUsageReader: StorageUsageReader = {
  async readUsedBytes(userId: string): Promise<number> {
    const aggregate = await prisma.asset.aggregate({
      where: { userId },
      _sum: { sizeBytes: true }
    });
    return aggregate._sum.sizeBytes ?? 0;
  }
};

export type QuotaOptions = {
  reader?: StorageUsageReader;
  quotaBytes?: number;
};

function normalizeByteCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

export function snapshotStorageUsage(input: {
  userId: string;
  usedBytes: number;
  incomingBytes: number;
  quotaBytes: number;
}): StorageUsageSnapshot {
  const usedBytes = normalizeByteCount(input.usedBytes);
  const incomingBytes = normalizeByteCount(input.incomingBytes);
  const quotaBytes = normalizeByteCount(input.quotaBytes);
  return {
    userId: input.userId,
    usedBytes,
    incomingBytes,
    quotaBytes,
    remainingBytes: Math.max(0, quotaBytes - usedBytes - incomingBytes)
  };
}

export function isStorageQuotaExceeded(snapshot: StorageUsageSnapshot): boolean {
  return snapshot.usedBytes + snapshot.incomingBytes > snapshot.quotaBytes;
}

/** Pure guard: throws `StorageQuotaError` (413 STORAGE_QUOTA_EXCEEDED) when over. */
export function assertStorageQuota(snapshot: StorageUsageSnapshot): StorageUsageSnapshot {
  if (isStorageQuotaExceeded(snapshot)) {
    throw new StorageQuotaError(
      `存储空间不足：配额 ${formatByteLimit(snapshot.quotaBytes)}，已用 ${formatByteLimit(
        snapshot.usedBytes
      )}，本次需要 ${formatByteLimit(snapshot.incomingBytes)}。请先清理素材。`
    );
  }
  return snapshot;
}

/** Reads current usage and asserts `used + incoming <= quota`. */
export async function assertUserStorageQuota(
  userId: string,
  incomingBytes: number,
  options: QuotaOptions = {}
): Promise<StorageUsageSnapshot> {
  const reader = options.reader ?? prismaStorageUsageReader;
  const quotaBytes = options.quotaBytes ?? PLATFORM_CONFIG.userStorageQuotaBytes;
  const usedBytes = await reader.readUsedBytes(userId);
  return assertStorageQuota(snapshotStorageUsage({ userId, usedBytes, incomingBytes, quotaBytes }));
}

export type UploadByteSizeOptions = {
  maxBytes?: number;
  /** Used to build a precise, actionable message. */
  filename?: string;
};

/** Single-file limit: > MAX_UPLOAD_BYTES → 413 PAYLOAD_TOO_LARGE. */
export function assertUploadByteSize(
  byteLength: number,
  options: UploadByteSizeOptions = {}
): void {
  const maxBytes = options.maxBytes ?? PLATFORM_CONFIG.maxUploadBytes;
  if (normalizeByteCount(byteLength) > maxBytes) {
    const target = options.filename ? `文件 ${options.filename} ` : "上传文件";
    throw new PayloadTooLargeError(
      `${target}超过单文件大小上限（${formatByteLimit(maxBytes)}）。`
    );
  }
}

/** Batch shape limit: > MAX_FILES_PER_REQUEST → 413 PAYLOAD_TOO_LARGE. */
export function assertUploadFileCount(
  fileCount: number,
  options: { maxFiles?: number } = {}
): void {
  const maxFiles = options.maxFiles ?? PLATFORM_CONFIG.maxFilesPerRequest;
  if (normalizeByteCount(fileCount) > maxFiles) {
    throw new PayloadTooLargeError(`单次最多上传 ${maxFiles} 个文件。`);
  }
}

/** Human readable byte limit used in error messages ("30 MB" / "512 B"). */
export function formatByteLimit(bytes: number): string {
  const normalized = normalizeByteCount(bytes);
  if (normalized >= 1024 * 1024) {
    const megabytes = normalized / (1024 * 1024);
    return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
  }
  if (normalized >= 1024) {
    const kilobytes = normalized / 1024;
    return `${Number.isInteger(kilobytes) ? kilobytes : kilobytes.toFixed(1)} KB`;
  }
  return `${normalized} B`;
}
