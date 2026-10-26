// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAssetFile } from "@/src/services/local-asset-store";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  readAssetBytes: vi.fn(),
  createUserWorkspace: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/src/platform/workspace", () => ({
  createUserWorkspace: mocks.createUserWorkspace
}));

import { buildContentDisposition, sanitizeDownloadFilename } from "@/src/platform/storage/download-headers";
import { GET } from "./route";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x42]);

function fileOf(overrides: Partial<ResolvedAssetFile> = {}): ResolvedAssetFile {
  return {
    bytes: PNG_BYTES,
    contentType: "image/png",
    filename: "product photo.png",
    ...overrides
  };
}

function routeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function request(): Request {
  return new Request("http://localhost/api/assets/asset-1/file");
}

beforeEach(() => {
  mocks.getSessionUser.mockReset().mockResolvedValue({
    id: "user-1",
    email: "user@example.com",
    role: "user"
  });
  mocks.readAssetBytes.mockReset().mockResolvedValue(fileOf());
  mocks.createUserWorkspace.mockReset().mockReturnValue({
    userId: "user-1",
    imageStore: { readAssetBytes: mocks.readAssetBytes }
  });
});

describe("GET /api/assets/[id]/file", () => {
  it("streams the owning user's asset with private, non-sniffable headers", async () => {
    const response = await GET(request(), routeContext("asset-1"));

    expect(response.status).toBe(200);
    expect(mocks.createUserWorkspace).toHaveBeenCalledWith("user-1");
    expect(mocks.readAssetBytes).toHaveBeenCalledWith("asset-1");

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(PNG_BYTES.byteLength));
    expect(response.headers.get("cache-control")).toBe("private, max-age=60");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(response.headers.get("content-disposition")).toContain(
      `filename*=UTF-8''${encodeURIComponent("product photo.png")}`
    );
    expect(response.headers.get("x-request-id")).toMatch(/^req_/);

    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(PNG_BYTES)).toBe(true);
  });

  it("returns 404 for another user's asset (no existence disclosure)", async () => {
    mocks.readAssetBytes.mockResolvedValue(null);

    const response = await GET(request(), routeContext("asset-of-someone-else"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns 401 for unauthenticated callers", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(request(), routeContext("asset-1"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(mocks.readAssetBytes).not.toHaveBeenCalled();
  });

  it("rejects path-traversal and malformed ids without touching the store", async () => {
    for (const id of ["", "../../etc/passwd", "asset-1/../../x", "a".repeat(200), "asset 1"]) {
      const response = await GET(request(), routeContext(id));
      expect(response.status).toBe(404);
    }
    expect(mocks.readAssetBytes).not.toHaveBeenCalled();
  });

  it("serves generated SVG assets as attachments with a sandboxing CSP", async () => {
    mocks.readAssetBytes.mockResolvedValue(
      fileOf({ contentType: "image/svg+xml", filename: "pdp.svg", bytes: Buffer.from("<svg/>") })
    );

    const response = await GET(request(), routeContext("asset-svg"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("serves PDFs inline", async () => {
    mocks.readAssetBytes.mockResolvedValue(
      fileOf({ contentType: "application/pdf", filename: "spec.pdf" })
    );

    const response = await GET(request(), routeContext("asset-pdf"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("inline");
  });
});

describe("sanitizeDownloadFilename", () => {
  it("keeps normal names and strips path components", () => {
    expect(sanitizeDownloadFilename("product.png")).toBe("product.png");
    expect(sanitizeDownloadFilename("../../etc/passwd.png")).toBe("passwd.png");
    expect(sanitizeDownloadFilename("dir\\nested\\photo.png")).toBe("photo.png");
  });

  it("removes control characters and quotes to prevent header injection", () => {
    const sanitized = sanitizeDownloadFilename('evil"\r\nX-Injected: 1.png');
    expect(sanitized).not.toMatch(/[\r\n"]/);
    expect(sanitizeDownloadFilename("\r\n")).toBe("asset");
    expect(sanitizeDownloadFilename("")).toBe("asset");
  });

  it("caps very long filenames", () => {
    expect(sanitizeDownloadFilename(`${"a".repeat(500)}.png`).length).toBeLessThanOrEqual(180);
  });
});

describe("buildContentDisposition", () => {
  it("uses inline for renderable media and attachment otherwise", () => {
    expect(buildContentDisposition("image/png", "a.png")).toMatch(/^inline;/);
    expect(buildContentDisposition("video/mp4", "a.mp4")).toMatch(/^inline;/);
    expect(buildContentDisposition("application/pdf", "a.pdf")).toMatch(/^inline;/);
    expect(buildContentDisposition("image/svg+xml", "a.svg")).toMatch(/^attachment;/);
    expect(buildContentDisposition("application/zip", "a.zip")).toMatch(/^attachment;/);
  });

  it("encodes non-ASCII names in both legacy and RFC 5987 forms", () => {
    const header = buildContentDisposition("image/png", "产品图.png");
    expect(header).toContain('filename="');
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent("产品图.png")}`);
  });
});
