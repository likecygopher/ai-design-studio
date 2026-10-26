import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StorageUsageReader } from "./storage/quota";

const prismaMock = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  delete: vi.fn(),
  aggregate: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: {
    asset: {
      create: prismaMock.create,
      findFirst: prismaMock.findFirst,
      findMany: prismaMock.findMany,
      delete: prismaMock.delete,
      aggregate: prismaMock.aggregate
    }
  }
}));

import { createUserAssetStore, type UserAssetStoreOptions } from "./user-asset-store";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngBytes(payloadLength = 16): Buffer {
  const buffer = Buffer.alloc(PNG_SIGNATURE.length + payloadLength, 0x42);
  Buffer.from(PNG_SIGNATURE).copy(buffer, 0);
  return buffer;
}

function svgBytes(): Buffer {
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "utf8");
}

function usageReader(usedBytes: number): StorageUsageReader & { readUsedBytes: ReturnType<typeof vi.fn> } {
  return { readUsedBytes: vi.fn(async () => usedBytes) };
}

let publicDir: string;

function createStore(overrides: UserAssetStoreOptions = {}) {
  return createUserAssetStore("user-1", {
    publicDir,
    maxUploadBytes: 1024,
    userStorageQuotaBytes: 10_000,
    usageReader: usageReader(0),
    ...overrides
  });
}

beforeEach(async () => {
  publicDir = await mkdtemp(join(tmpdir(), "dsh-asset-store-"));
  prismaMock.create.mockReset().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...data,
    createdAt: new Date(),
    metadata: data.metadata ?? null
  }));
  prismaMock.findFirst.mockReset().mockResolvedValue(null);
  prismaMock.findMany.mockReset().mockResolvedValue([]);
  prismaMock.delete.mockReset().mockResolvedValue({});
  prismaMock.aggregate.mockReset().mockResolvedValue({ _sum: { sizeBytes: 0 } });
});

afterEach(async () => {
  await rm(publicDir, { recursive: true, force: true });
});

describe("remote storage integration", () => {
  it("stores bytes through an S3 driver and exposes the authorised proxy URL", async () => {
    const puts: Array<{ key: string; contentType: string }> = [];
    const storage = {
      kind: "s3" as const,
      put: vi.fn(async (key: string, _bytes: Uint8Array, contentType: string) => {
        puts.push({ key, contentType });
      }),
      get: vi.fn(async () => Buffer.from(pngBytes())),
      delete: vi.fn(async () => undefined),
      localPath: () => null
    };
    const store = createStore({ storage });
    const asset = await store.saveUploadedAsset({
      projectId: "project-user-workspace",
      productId: "product-1",
      type: "product-photo",
      filename: "photo.png",
      bytes: pngBytes(),
      contentType: "image/png"
    });
    expect(asset.url).toBe(`/api/assets/${asset.id}/file`);
    expect(puts[0].key).toMatch(/^uploads\/user-1\//);
    expect(prismaMock.create.mock.calls[0][0].data.storageKey).toBe(puts[0].key);
  });
});

describe("saveUploadedAsset", () => {
  it("writes the file, decides the content type from magic bytes and records sizeBytes", async () => {
    const store = createStore();
    const bytes = pngBytes(32);

    const asset = await store.saveUploadedAsset({
      projectId: "project-x",
      type: "product-photo",
      filename: "product.png",
      contentType: "",
      bytes
    });

    expect(asset.url).toMatch(/^\/uploads\/user-1\/project-x\/asset-[a-f0-9-]+\.png$/);
    expect(asset.metadata?.contentType).toBe("image/png");

    const createData = prismaMock.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(createData.sizeBytes).toBe(bytes.byteLength);
    expect(createData.contentType).toBe("image/png");
    expect(createData.storageKey).toBe(asset.url.replace(/^\//, ""));

    const stored = await readFile(join(publicDir, asset.url.replace(/^\//, "")));
    expect(stored.equals(bytes)).toBe(true);
  });

  it("stores the detected type even when the client sends a supported but different type", async () => {
    const store = createStore();
    // Declared JPEG, real PNG -> rejected instead of silently stored.
    await expect(
      store.saveUploadedAsset({
        projectId: "project-x",
        type: "product-photo",
        filename: "fake.jpg",
        contentType: "image/jpeg",
        bytes: pngBytes(8)
      })
    ).rejects.toMatchObject({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
    expect(prismaMock.create).not.toHaveBeenCalled();
  });

  it("rejects SVG uploads before writing anything", async () => {
    const store = createStore();

    await expect(
      store.saveUploadedAsset({
        projectId: "project-x",
        type: "product-photo",
        filename: "logo.svg",
        contentType: "image/svg+xml",
        bytes: svgBytes()
      })
    ).rejects.toMatchObject({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
    expect(prismaMock.create).not.toHaveBeenCalled();
    await expect(readdir(join(publicDir, "uploads"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a file over the single-file limit", async () => {
    const store = createStore({ maxUploadBytes: 10, usageReader: usageReader(0) });

    await expect(
      store.saveUploadedAsset({
        projectId: "project-x",
        type: "product-photo",
        filename: "big.png",
        contentType: "image/png",
        bytes: pngBytes(64)
      })
    ).rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    expect(prismaMock.create).not.toHaveBeenCalled();
  });

  it("rejects an upload that would exceed the user storage quota", async () => {
    const reader = usageReader(9_950);
    const store = createStore({ userStorageQuotaBytes: 10_000, usageReader: reader });

    await expect(
      store.saveUploadedAsset({
        projectId: "project-x",
        type: "product-photo",
        filename: "quota.png",
        contentType: "image/png",
        bytes: pngBytes(100)
      })
    ).rejects.toMatchObject({ status: 413, code: "STORAGE_QUOTA_EXCEEDED" });
    expect(reader.readUsedBytes).toHaveBeenCalledWith("user-1");
    expect(prismaMock.create).not.toHaveBeenCalled();
  });

  it("accepts an upload that exactly fills the quota", async () => {
    const store = createStore({ userStorageQuotaBytes: 100, usageReader: usageReader(84) });
    const bytes = pngBytes(8); // 16 bytes
    const asset = await store.saveUploadedAsset({
      projectId: "project-x",
      type: "product-photo",
      filename: "exact.png",
      contentType: "image/png",
      bytes
    });
    expect(asset.id).toMatch(/^asset-/);
  });
});

describe("saveGeneratedImage", () => {
  it("persists generated SVG output with sizeBytes (server-generated SVG is allowed)", async () => {
    const store = createStore();
    const bytes = svgBytes();

    const saved = await store.saveGeneratedImage({
      taskId: "task-1",
      filename: "pdp.svg",
      contentType: "image/svg+xml",
      bytes
    });

    expect(saved.url).toMatch(/^\/generated\/user-1\/task-1\/asset-[a-f0-9-]+\.svg$/);
    const stored = await readFile(saved.filePath);
    expect(stored.equals(bytes)).toBe(true);

    const createData = prismaMock.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(createData.sizeBytes).toBe(bytes.byteLength);
    expect(createData.source).toBe("generated");
  });

  it("is not constrained by the upload single-file limit", async () => {
    const store = createStore({ maxUploadBytes: 10 });
    const saved = await store.saveGeneratedImage({
      taskId: "task-1",
      contentType: "image/png",
      bytes: pngBytes(100)
    });
    expect(saved.id).toMatch(/^asset-/);
  });

  it("enforces the user storage quota", async () => {
    const store = createStore({ userStorageQuotaBytes: 100, usageReader: usageReader(99) });
    await expect(
      store.saveGeneratedImage({ taskId: "task-1", contentType: "image/png", bytes: pngBytes(8) })
    ).rejects.toMatchObject({ status: 413, code: "STORAGE_QUOTA_EXCEEDED" });
    expect(prismaMock.create).not.toHaveBeenCalled();
  });
});

describe("readAssetBytes", () => {
  it("streams the file of the requesting user", async () => {
    const store = createStore();
    const url = "/generated/user-1/task-1/asset-1.png";
    const filePath = join(publicDir, url.replace(/^\//, ""));
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(publicDir, "generated/user-1/task-1"), { recursive: true });
    await writeFile(filePath, pngBytes(4));

    prismaMock.findFirst.mockResolvedValue({
      id: "asset-1",
      userId: "user-1",
      projectId: "project-user-workspace",
      productId: null,
      type: "product-photo",
      filename: "generated.png",
      url,
      storageKey: url.replace(/^\//, ""),
      source: "generated",
      contentType: "image/png",
      metadata: null
    });

    const file = await store.readAssetBytes("asset-1");
    expect(file?.contentType).toBe("image/png");
    expect(file?.filename).toBe("generated.png");
    expect(file?.bytes.byteLength).toBe(pngBytes(4).byteLength);
    expect(prismaMock.findFirst).toHaveBeenCalledWith({
      where: {
        id: "asset-1",
        OR: [{ organizationId: "org_user-1" }, { userId: "user-1" }]
      }
    });
  });

  it("returns null for another user's asset (scoped query)", async () => {
    const store = createStore();
    prismaMock.findFirst.mockResolvedValue(null);
    await expect(store.readAssetBytes("asset-of-someone-else")).resolves.toBeNull();
  });

  it("returns null when the DB row exists but the file is gone", async () => {
    const store = createStore();
    prismaMock.findFirst.mockResolvedValue({
      id: "asset-2",
      userId: "user-1",
      projectId: "project-user-workspace",
      productId: null,
      type: "product-photo",
      filename: "missing.png",
      url: "/uploads/user-1/project-x/missing.png",
      storageKey: "uploads/user-1/project-x/missing.png",
      source: "uploaded",
      contentType: "image/png",
      metadata: null
    });
    await expect(store.readAssetBytes("asset-2")).resolves.toBeNull();
  });
});

describe("removeAsset", () => {
  it("deletes both the DB row and the file (existing behaviour preserved)", async () => {
    const store = createStore();
    const storageKey = "uploads/user-1/project-x/asset-3.png";
    const filePath = join(publicDir, storageKey);
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(publicDir, "uploads/user-1/project-x"), { recursive: true });
    await writeFile(filePath, pngBytes(2));

    prismaMock.findFirst.mockResolvedValue({
      id: "asset-3",
      userId: "user-1",
      projectId: "project-x",
      productId: null,
      type: "product-photo",
      filename: "a.png",
      url: `/${storageKey}`,
      storageKey,
      source: "uploaded",
      contentType: "image/png",
      metadata: null
    });

    await expect(store.removeAsset("asset-3")).resolves.toBe(true);
    expect(prismaMock.delete).toHaveBeenCalledWith({ where: { id: "asset-3" } });
    await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns false for unknown assets", async () => {
    const store = createStore();
    prismaMock.findFirst.mockResolvedValue(null);
    await expect(store.removeAsset("nope")).resolves.toBe(false);
    expect(prismaMock.delete).not.toHaveBeenCalled();
  });
});

describe("readAssetManifest", () => {
  it("maps DB rows to domain assets scoped to the user", async () => {
    const store = createStore();
    prismaMock.findMany.mockResolvedValue([
      {
        id: "asset-1",
        projectId: "project-x",
        productId: null,
        type: "product-photo",
        filename: "a.png",
        url: "/uploads/user-1/project-x/a.png",
        source: "uploaded",
        contentType: "image/png",
        metadata: { sizeBytes: "16" }
      }
    ]);

    const assets = await store.readAssetManifest();
    expect(prismaMock.findMany).toHaveBeenCalledWith({
      where: { OR: [{ organizationId: "org_user-1" }, { userId: "user-1" }] },
      orderBy: { createdAt: "asc" }
    });
    expect(assets[0]?.metadata).toMatchObject({ sizeBytes: "16", contentType: "image/png" });
  });
});
