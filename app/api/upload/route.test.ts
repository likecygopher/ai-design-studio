// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "@/src/domain/types";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  saveUploadedAsset: vi.fn(),
  readAssetManifest: vi.fn(),
  recordAudit: vi.fn(),
  aggregate: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/src/platform/workspace", () => ({
  createUserWorkspace: (userId: string) => ({
    userId,
    imageStore: {
      saveUploadedAsset: mocks.saveUploadedAsset,
      readAssetManifest: mocks.readAssetManifest
    }
  })
}));

vi.mock("@/src/platform/audit", () => ({
  recordAudit: mocks.recordAudit
}));

vi.mock("@/src/platform/db", () => ({
  prisma: { asset: { aggregate: mocks.aggregate } }
}));

vi.mock("@/src/platform/config", () => ({
  PLATFORM_CONFIG: {
    storageRoot: "public",
    maxUploadBytes: 64,
    maxFilesPerRequest: 2,
    userStorageQuotaBytes: 1024,
    rateLimitLimit: 1000,
    rateLimitWindowMs: 60_000
  },
  isProduction: () => false
}));

import { GET, POST } from "./route";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngBytes(payloadLength = 8): Uint8Array {
  return Uint8Array.from([...PNG_SIGNATURE, ...new Array<number>(payloadLength).fill(0x42)]);
}

function svgBytes(): Uint8Array {
  return Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "utf8"));
}

function buildMultipart(
  files: Array<{ name: string; type: string; content: Uint8Array }>,
  fields: Record<string, string> = {}
): { body: Buffer; contentType: string } {
  const boundary = "----dsh-upload-boundary";
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)
    );
  }
  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`
      )
    );
    parts.push(Buffer.from(file.content));
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

function uploadRequest(
  files: Array<{ name: string; type: string; content: Uint8Array }>,
  fields: Record<string, string> = {}
): Request {
  const { body, contentType } = buildMultipart(files, fields);
  return new Request("http://localhost/api/upload", {
    method: "POST",
    headers: { "content-type": contentType },
    body
  });
}

function savedAsset(name: string): Asset {
  return {
    id: `asset-${name.replace(/\W/g, "")}`,
    projectId: "project-user-workspace",
    type: "product-photo",
    filename: name,
    url: `/uploads/user-1/project-user-workspace/asset-${name}.png`,
    source: "uploaded",
    metadata: { contentType: "image/png" }
  };
}

beforeEach(() => {
  mocks.getSessionUser.mockReset().mockResolvedValue({
    id: "user-1",
    email: "user@example.com",
    role: "user"
  });
  mocks.saveUploadedAsset
    .mockReset()
    .mockImplementation(async (input: { filename: string }) => savedAsset(input.filename));
  mocks.readAssetManifest.mockReset().mockResolvedValue([]);
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
  mocks.aggregate.mockReset().mockResolvedValue({ _sum: { sizeBytes: 0 } });
});

describe("POST /api/upload", () => {
  it("accepts a valid uploaded image and returns the asset manifest", async () => {
    const response = await POST(
      uploadRequest([{ name: "product.png", type: "image/png", content: pngBytes() }], {
        projectId: "project-x",
        type: "product-photo"
      })
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { assets: Asset[] };
    expect(payload.assets).toHaveLength(1);
    expect(response.headers.get("x-request-id")).toMatch(/^req_/);
    expect(mocks.saveUploadedAsset).toHaveBeenCalledTimes(1);
    const input = mocks.saveUploadedAsset.mock.calls[0][0];
    expect(input.projectId).toBe("project-x");
    expect(input.contentType).toBe("image/png");
    expect(input.filename).toBe("product.png");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "asset.upload", userId: "user-1", requestId: expect.any(String) })
    );
  });

  it("rejects unauthenticated uploads with 401 AUTH_REQUIRED", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const response = await POST(
      uploadRequest([{ name: "product.png", type: "image/png", content: pngBytes() }])
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(mocks.saveUploadedAsset).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_ERROR when no files are sent", async () => {
    const response = await POST(uploadRequest([], { projectId: "project-x" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
      error: "No files uploaded."
    });
  });

  it("rejects HTML disguised as a PNG with 415 UNSUPPORTED_MEDIA_TYPE", async () => {
    const response = await POST(
      uploadRequest([
        {
          name: "evil.png",
          type: "image/png",
          content: Uint8Array.from(Buffer.from("<html><script>alert(1)</script></html>"))
        }
      ])
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
    expect(mocks.saveUploadedAsset).not.toHaveBeenCalled();
  });

  it("rejects SVG uploads with 415 even when declared as an image", async () => {
    const response = await POST(
      uploadRequest([{ name: "logo.svg", type: "image/png", content: svgBytes() }])
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
    expect(mocks.saveUploadedAsset).not.toHaveBeenCalled();
  });

  it("rejects a batch that exceeds the single-request file count", async () => {
    const response = await POST(
      uploadRequest([
        { name: "a.png", type: "image/png", content: pngBytes() },
        { name: "b.png", type: "image/png", content: pngBytes() },
        { name: "c.png", type: "image/png", content: pngBytes() }
      ])
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(mocks.saveUploadedAsset).not.toHaveBeenCalled();
  });

  it("rejects a single file over MAX_UPLOAD_BYTES with 413", async () => {
    const response = await POST(
      uploadRequest([{ name: "big.png", type: "image/png", content: pngBytes(100) }])
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(mocks.saveUploadedAsset).not.toHaveBeenCalled();
  });

  it("rejects the batch when the user storage quota would be exceeded", async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { sizeBytes: 1010 } });
    const response = await POST(
      uploadRequest([{ name: "quota.png", type: "image/png", content: pngBytes(8) }])
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: "STORAGE_QUOTA_EXCEEDED" });
    expect(mocks.saveUploadedAsset).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("writes nothing when the second file of a batch is invalid (no partial upload)", async () => {
    const response = await POST(
      uploadRequest([
        { name: "ok.png", type: "image/png", content: pngBytes() },
        { name: "bad.png", type: "image/png", content: Uint8Array.from(Buffer.from("not an image")) }
      ])
    );

    expect(response.status).toBe(415);
    expect(mocks.saveUploadedAsset).not.toHaveBeenCalled();
  });

  it("accepts files whose MIME could not be inferred by the client", async () => {
    const response = await POST(
      uploadRequest([{ name: "camera", type: "application/octet-stream", content: pngBytes() }])
    );

    expect(response.status).toBe(200);
    expect(mocks.saveUploadedAsset).toHaveBeenCalledTimes(1);
    expect(mocks.saveUploadedAsset.mock.calls[0][0].contentType).toBe("image/png");
  });

  it("falls back to the default project and asset type for unknown values", async () => {
    const response = await POST(
      uploadRequest([{ name: "photo.png", type: "image/png", content: pngBytes() }], {
        type: "not-a-real-type"
      })
    );

    expect(response.status).toBe(200);
    const input = mocks.saveUploadedAsset.mock.calls[0][0];
    expect(input.projectId).toBe("project-user-workspace");
    expect(input.type).toBe("product-photo");
  });
});

describe("GET /api/upload", () => {
  it("returns the authenticated user's asset manifest", async () => {
    mocks.readAssetManifest.mockResolvedValue([savedAsset("existing.png")]);

    const response = await GET(new Request("http://localhost/api/upload"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      assets: [expect.objectContaining({ filename: "existing.png" })]
    });
  });

  it("requires authentication", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/upload"));
    expect(response.status).toBe(401);
  });
});
