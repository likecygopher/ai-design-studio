import { describe, expect, it, vi } from "vitest";
import {
  assertStorageQuota,
  assertUploadByteSize,
  assertUploadFileCount,
  assertUserStorageQuota,
  formatByteLimit,
  isStorageQuotaExceeded,
  snapshotStorageUsage,
  type StorageUsageReader
} from "./quota";

function readerOf(usedBytes: number): StorageUsageReader & { readUsedBytes: ReturnType<typeof vi.fn> } {
  return { readUsedBytes: vi.fn(async () => usedBytes) };
}

describe("snapshotStorageUsage", () => {
  it("computes remaining bytes", () => {
    const snapshot = snapshotStorageUsage({
      userId: "u1",
      usedBytes: 400,
      incomingBytes: 100,
      quotaBytes: 1000
    });
    expect(snapshot.remainingBytes).toBe(500);
    expect(isStorageQuotaExceeded(snapshot)).toBe(false);
  });

  it("never reports negative remaining and allows exact boundary", () => {
    const exact = snapshotStorageUsage({
      userId: "u1",
      usedBytes: 900,
      incomingBytes: 100,
      quotaBytes: 1000
    });
    expect(exact.remainingBytes).toBe(0);
    expect(isStorageQuotaExceeded(exact)).toBe(false);

    const over = snapshotStorageUsage({
      userId: "u1",
      usedBytes: 901,
      incomingBytes: 100,
      quotaBytes: 1000
    });
    expect(over.remainingBytes).toBe(0);
    expect(isStorageQuotaExceeded(over)).toBe(true);
  });

  it("normalizes invalid byte counts", () => {
    const snapshot = snapshotStorageUsage({
      userId: "u1",
      usedBytes: Number.NaN,
      incomingBytes: -10,
      quotaBytes: 100
    });
    expect(snapshot.usedBytes).toBe(0);
    expect(snapshot.incomingBytes).toBe(0);
  });
});

describe("assertStorageQuota", () => {
  it("passes through a within-quota snapshot", () => {
    const snapshot = snapshotStorageUsage({
      userId: "u1",
      usedBytes: 1,
      incomingBytes: 1,
      quotaBytes: 10
    });
    expect(assertStorageQuota(snapshot)).toBe(snapshot);
  });

  it("throws StorageQuotaError with 413 STORAGE_QUOTA_EXCEEDED when over quota", () => {
    const snapshot = snapshotStorageUsage({
      userId: "u1",
      usedBytes: 10,
      incomingBytes: 5,
      quotaBytes: 10
    });
    expect(() => assertStorageQuota(snapshot)).toThrowError(/存储空间不足/);
    try {
      assertStorageQuota(snapshot);
      expect.unreachable();
    } catch (error) {
      expect((error as { status?: number }).status).toBe(413);
      expect((error as { code?: string }).code).toBe("STORAGE_QUOTA_EXCEEDED");
    }
  });
});

describe("assertUserStorageQuota", () => {
  it("sums persisted bytes via the injected reader", async () => {
    const reader = readerOf(400);
    const snapshot = await assertUserStorageQuota("u1", 100, { reader, quotaBytes: 1000 });
    expect(reader.readUsedBytes).toHaveBeenCalledWith("u1");
    expect(snapshot.usedBytes).toBe(400);
    expect(snapshot.incomingBytes).toBe(100);
    expect(snapshot.remainingBytes).toBe(500);
  });

  it("rejects a batch that would overflow the user quota", async () => {
    const reader = readerOf(950);
    await expect(
      assertUserStorageQuota("u1", 100, { reader, quotaBytes: 1000 })
    ).rejects.toMatchObject({ status: 413, code: "STORAGE_QUOTA_EXCEEDED" });
  });

  it("accepts a batch that exactly fills the quota", async () => {
    const reader = readerOf(900);
    await expect(
      assertUserStorageQuota("u1", 100, { reader, quotaBytes: 1000 })
    ).resolves.toMatchObject({ remainingBytes: 0 });
  });
});

describe("per-request limits", () => {
  it("rejects a single file over the size limit", () => {
    expect(() => assertUploadByteSize(101, { maxBytes: 100 })).toThrowError(/超过单文件大小上限/);
    try {
      assertUploadByteSize(101, { maxBytes: 100, filename: "big.png" });
      expect.unreachable();
    } catch (error) {
      expect((error as { status?: number }).status).toBe(413);
      expect((error as { code?: string }).code).toBe("PAYLOAD_TOO_LARGE");
      expect((error as Error).message).toContain("big.png");
    }
  });

  it("accepts a file exactly at the size limit", () => {
    expect(() => assertUploadByteSize(100, { maxBytes: 100 })).not.toThrow();
  });

  it("rejects too many files in one request", () => {
    expect(() => assertUploadFileCount(11, { maxFiles: 10 })).toThrowError(/最多上传 10 个文件/);
    try {
      assertUploadFileCount(11, { maxFiles: 10 });
      expect.unreachable();
    } catch (error) {
      expect((error as { status?: number }).status).toBe(413);
      expect((error as { code?: string }).code).toBe("PAYLOAD_TOO_LARGE");
    }
  });

  it("accepts exactly the maximum file count", () => {
    expect(() => assertUploadFileCount(10, { maxFiles: 10 })).not.toThrow();
  });
});

describe("formatByteLimit", () => {
  it("formats bytes, KB and MB", () => {
    expect(formatByteLimit(512)).toBe("512 B");
    expect(formatByteLimit(2048)).toBe("2 KB");
    expect(formatByteLimit(30 * 1024 * 1024)).toBe("30 MB");
    expect(formatByteLimit(1536 * 1024)).toBe("1.5 MB");
  });
});
