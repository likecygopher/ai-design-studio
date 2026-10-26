import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  localizeGeneratedImage: vi.fn(),
  readImageDimensions: vi.fn(),
  resizeImageToExactDimensions: vi.fn(),
  saveGeneratedImage: vi.fn()
}));

vi.mock("@/src/services/demo-api", () => ({
  localizeGeneratedImage: mocks.localizeGeneratedImage
}));

vi.mock("@/src/platform/auth", () => ({
  requireUserId: async () => "test-user-id"
}));

vi.mock("@/src/platform/workspace", () => ({
  createUserWorkspace: () => ({
    userId: "test-user-id",
    imageStore: { saveGeneratedImage: mocks.saveGeneratedImage },
    costLedger: { appendRecord: vi.fn() }
  })
}));

vi.mock("@/src/platform/http", () => ({
  toErrorResponse: (error: unknown) =>
    new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "服务器错误"
      }),
      { status: 500 }
    )
}));

vi.mock("@/src/services/image-dimensions", () => ({
  chooseImageProviderSize: () => "1536x1024",
  readImageDimensions: mocks.readImageDimensions,
  resizeImageToExactDimensions: mocks.resizeImageToExactDimensions
}));

import { POST } from "./route";

beforeEach(() => {
  mocks.localizeGeneratedImage.mockReset().mockResolvedValue({
    model: "gpt-image-1",
    sourceUrl: "upload:creative.png",
    url: "data:image/png;base64,b3V0cHV0"
  });
  mocks.readImageDimensions.mockReset().mockResolvedValue({ width: 1600, height: 900 });
  mocks.resizeImageToExactDimensions.mockReset().mockResolvedValue(Buffer.from("resized"));
  mocks.saveGeneratedImage.mockReset().mockResolvedValue({
    id: "localized-output",
    url: "/generated/localized-output.png",
    filePath: "localized-output.png"
  });
});

function createUploadedFile(name: string, type: string, content: string): File {
  const bytes = new TextEncoder().encode(content);
  return {
    arrayBuffer: async () => bytes.buffer,
    name,
    type
  } as File;
}

function createUploadRequest(
  image: File,
  fields: Record<string, string | File> = {}
): Request {
  const values = new Map<string, FormDataEntryValue>([["image", image]]);
  for (const [key, value] of Object.entries(fields)) {
    values.set(key, value);
  }
  return {
    formData: async () => ({
      get: (key: string) => values.get(key) ?? null
    })
  } as unknown as Request;
}

describe("localize route", () => {
  it("passes a matching clean base with the original image", async () => {
    const response = await POST(createUploadRequest(createUploadedFile("original.png", "image/png", "original"), { baseImage: createUploadedFile("clean.png", "image/png", "clean") }));
    expect(response.status).toBe(200);
    expect(mocks.localizeGeneratedImage).toHaveBeenCalledWith(expect.objectContaining({ baseImageBytes: Buffer.from("clean"), baseImageContentType: "image/png" }));
  });

  it("rejects misaligned clean bases before generation", async () => {
    mocks.readImageDimensions.mockResolvedValueOnce({ width: 1600, height: 900 }).mockResolvedValueOnce({ width: 800, height: 450 });
    const response = await POST(createUploadRequest(createUploadedFile("original.png", "image/png", "original"), { baseImage: createUploadedFile("clean.png", "image/png", "clean") }));
    expect(response.status).toBe(400);
    expect(mocks.localizeGeneratedImage).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("尺寸") });
  });

  it("rejects unsupported or malformed optional bases", async () => {
    const response = await POST(createUploadRequest(createUploadedFile("original.png", "image/png", "original"), { baseImage: createUploadedFile("clean.svg", "image/svg+xml", "<svg/>") }));
    expect(response.status).toBe(415);
    expect(mocks.localizeGeneratedImage).not.toHaveBeenCalled();
    const malformed = await POST(createUploadRequest(createUploadedFile("original.png", "image/png", "original"), { baseImage: "not-a-file" }));
    expect(malformed.status).toBe(400);
  });

  it.each([{ label: "empty", content: "" }, { label: "oversized", content: "x".repeat(30 * 1024 * 1024 + 1) }])("rejects a $label clean base before generation", async ({ content }) => {
    const response = await POST(createUploadRequest(createUploadedFile("original.png", "image/png", "original"), { baseImage: createUploadedFile("clean.png", "image/png", content) }));
    expect(response.status).toBe(400);
    expect(mocks.localizeGeneratedImage).not.toHaveBeenCalled();
  });
  it("accepts a user upload and preserves its source dimensions", async () => {
    const response = await POST(
      createUploadRequest(
        createUploadedFile("creative.png", "image/png", "pixels"),
        {
          country: "Saudi Arabia",
          imageModel: "doubao",
          language: "Arabic"
        }
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.localizeGeneratedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "image/png",
        country: "Saudi Arabia",
        imageModel: "doubao",
        language: "Arabic",
        size: "1536x1024",
        sourceHeight: 900,
        sourceUrl: "upload:creative.png",
        sourceWidth: 1600
      })
    );
    expect(mocks.resizeImageToExactDimensions).toHaveBeenCalledWith(
      Buffer.from("output"),
      { width: 1600, height: 900 }
    );
    await expect(response.json()).resolves.toMatchObject({
      height: 900,
      sourceUrl: "upload:creative.png",
      url: "/generated/localized-output.png",
      width: 1600
    });
  });

  it("rejects server-side SVG parsing before image metadata is read", async () => {
    const response = await POST(
      createUploadRequest(
        createUploadedFile("oversized.svg", "image/svg+xml", "<svg/>")
      )
    );

    expect(response.status).toBe(415);
    expect(mocks.readImageDimensions).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("SVG")
    });
  });
});
