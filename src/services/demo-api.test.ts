import { describe, expect, it, vi } from "vitest";
import {
  aggregateCostRecords,
  exportDemoPdp,
  generateDemoImage,
  generatePopTemplateScene,
  localizeGeneratedImage,
  resolveSourceImages
} from "./demo-api";
import type { ImageProvider } from "./image-provider";
import type { LocalAssetStore } from "./local-asset-store";

function createStubStore(files: Record<string, { bytes: Buffer; contentType: string }>): LocalAssetStore {
  return {
    saveUploadedAsset: vi.fn(),
    saveGeneratedImage: vi.fn().mockResolvedValue({ id: "asset-x", url: "/generated/x.svg", filePath: "x" }),
    readAssetManifest: vi.fn().mockResolvedValue([]),
    readAssetBytes: vi.fn(async (assetId: string) => {
      const file = files[assetId];
      return file ? { ...file, filename: `${assetId}.png` } : null;
    }),
    removeAsset: vi.fn(async () => false)
  };
}

describe("demo API helpers", () => {
  it("aggregates cost records by task, country, language, and mode", () => {
    const summary = aggregateCostRecords([
      { task: "POP scene", model: "gpt-image-1", mode: "openai", country: "Mexico", language: "Spanish", estimatedUnits: 1 },
      { task: "POP scene", model: "gpt-image-1", mode: "mock fallback", country: "Mexico", language: "Spanish", estimatedUnits: 1 },
      { task: "PDP render", model: "template-engine", mode: "deterministic", country: "Brazil", language: "Portuguese", estimatedUnits: 0 }
    ]);

    expect(summary.byTask).toEqual([
      { key: "POP scene", records: 2, units: 2 },
      { key: "PDP render", records: 1, units: 0 }
    ]);
    expect(summary.byCountry).toEqual([
      { key: "Mexico", records: 2, units: 2 },
      { key: "Brazil", records: 1, units: 0 }
    ]);
    expect(summary.byLanguage).toEqual([
      { key: "Spanish", records: 2, units: 2 },
      { key: "Portuguese", records: 1, units: 0 }
    ]);
    expect(summary.byMode).toEqual([
      { key: "openai", records: 1, units: 1 },
      { key: "mock fallback", records: 1, units: 1 },
      { key: "deterministic", records: 1, units: 0 }
    ]);
  });

  it("exports an edited PDP with reordered points, custom points, and embedded images", async () => {
    let savedSvg = "";
    const store: LocalAssetStore = {
      saveUploadedAsset: vi.fn(),
      saveGeneratedImage: vi.fn(async (input: { bytes: Buffer }) => {
        savedSvg = input.bytes.toString("utf8");
        return { id: "asset-pdp", url: "/generated/task-pdp/pdp.svg", filePath: "x" };
      }),
      readAssetManifest: vi.fn().mockResolvedValue([]),
      readAssetBytes: vi.fn(async (assetId: string) =>
        assetId === "asset-space-master-front"
          ? { bytes: Buffer.from("front"), contentType: "image/png", filename: "front.png" }
          : null
      ),
      removeAsset: vi.fn(async () => false)
    };
    const appendRecord = vi.fn().mockResolvedValue(undefined);

    const result = await exportDemoPdp({
      taskId: "task-pdp",
      country: "Mexico",
      language: "Spanish",
      product: {
        id: "product-space-master",
        projectId: "project-user-workspace",
        category: "Refrigerator",
        displayName: "SPACE Master BCD-640",
        profile: {
          id: "profile-x",
          productId: "product-space-master",
          category: "Refrigerator",
          detectedFeatures: [],
          localizationHints: [],
          confidence: 0.9
        },
        assets: [
          {
            id: "asset-space-master-front",
            projectId: "p",
            productId: "product-space-master",
            type: "product-photo",
            filename: "front.png",
            url: "/uploads/p/front.png",
            source: "uploaded"
          }
        ],
        acceptsUserUploads: true
      },
      sellingPoints: [
        {
          id: "feature-energy",
          title: "Quattro Energy Saving",
          shortLabel: "Energy Saving",
          benefit: "Lower bills",
          technicalProof: "10% better than standard",
          priority: 1
        },
        {
          id: "feature-custom-warranty",
          title: "Local Warranty",
          shortLabel: "10-Year Warranty",
          benefit: "Local service confidence",
          priority: 2
        }
      ],
      sectionImages: { "feature-energy": "asset-space-master-front" },
      coverAssetId: "asset-space-master-front",
      imageStore: store,
      costLedger: { appendRecord, readRecords: vi.fn() }
    });

    expect(result.url).toBe("/generated/task-pdp/pdp.svg");
    expect(result.sectionCount).toBe(2);
    expect(savedSvg).toContain("Energy Saving");
    // PDP copy is driven by the authored selling-point title, not the padded
    // shortLabel (which is reserved for other surfaces). `10-Year Warranty` is
    // the shortLabel of the `Local Warranty` point, so the exported SVG must
    // carry the title and never the shortLabel.
    expect(savedSvg).toContain("Local Warranty");
    expect(savedSvg).not.toContain("10-Year Warranty");
    expect(savedSvg).toContain("data:image/png;base64");
    expect(savedSvg).toContain("Specification");
    expect(appendRecord).toHaveBeenCalled();
  });

  it("localizes a generated image by feeding it back as a reference with a text-replacement prompt", async () => {
    const editImage = vi.fn().mockResolvedValue({
      url: "/generated/localize-1/asset-es.png",
      model: "gpt-image-1",
      prompt: "p",
      sourceAssetIds: [],
      isFallback: false,
      generatedAt: new Date().toISOString()
    });
    const appendRecord = vi.fn().mockResolvedValue(undefined);

    const result = await localizeGeneratedImage({
      taskId: "localize-1",
      sourceUrl: "/generated/task-style/asset-abc.png",
      imageBytes: Buffer.from("existing output"),
      contentType: "image/png",
      country: "Brazil",
      language: "Portuguese",
      costLedger: { appendRecord, readRecords: vi.fn() },
      provider: { generateImage: vi.fn(), editImage }
    });

    expect(result.url).toBe("/generated/localize-1/asset-es.png");
    expect(result.sourceUrl).toBe("/generated/task-style/asset-abc.png");
    expect(editImage).toHaveBeenCalledTimes(1);
    const providerInput = editImage.mock.calls[0][0];
    expect(providerInput.sourceImages).toHaveLength(1);
    expect(providerInput.prompt).toContain("Portuguese");
    expect(providerInput.prompt).toContain("Brazil");
    expect(providerInput.prompt.toLowerCase()).toContain("text");
    expect(appendRecord).toHaveBeenCalledWith(
      expect.objectContaining({ country: "Brazil", language: "Portuguese", estimatedUnits: 1 })
    );
  });

  it("does not feed svg sources to the image model when localizing", async () => {
    const editImage = vi.fn().mockResolvedValue({
      url: "/mock/generated/localize-2.png",
      model: "mock-image-provider",
      prompt: "p",
      sourceAssetIds: [],
      isFallback: true,
      generatedAt: new Date().toISOString()
    });

    await localizeGeneratedImage({
      taskId: "localize-2",
      sourceUrl: "/generated/task-mock/asset-mock.svg",
      imageBytes: Buffer.from("<svg/>"),
      contentType: "image/svg+xml",
      country: "Mexico",
      language: "Spanish",
      provider: { generateImage: vi.fn(), editImage }
    });

    const providerInput = editImage.mock.calls[0][0];
    expect(providerInput.sourceImages).toBeUndefined();
  });

  it("resolves image assets and skips documents and missing ids", async () => {
    const store = createStubStore({
      "asset-photo": { bytes: Buffer.from("photo"), contentType: "image/png" },
      "asset-guide": { bytes: Buffer.from("pdf"), contentType: "application/pdf" }
    });

    const images = await resolveSourceImages(store, ["asset-photo", "asset-guide", "asset-nope"]);

    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe("asset-photo.png");
  });

  it("renders the flat POP, saves it, and feeds product plus POP images to the provider", async () => {
    const saveGeneratedImage = vi
      .fn()
      .mockImplementation(async (input: { filename?: string }) => ({
        id: `asset-${input.filename}`,
        url: `/generated/task-pop-tpl/${input.filename}`,
        filePath: `public/generated/task-pop-tpl/${input.filename}`
      }));
    const store: LocalAssetStore = {
      saveUploadedAsset: vi.fn(),
      saveGeneratedImage,
      readAssetManifest: vi.fn().mockResolvedValue([]),
      readAssetBytes: vi.fn(async (assetId: string) =>
        assetId === "asset-space-master-front"
          ? { bytes: Buffer.from("product photo"), contentType: "image/png", filename: "front.png" }
          : null
      ),
      removeAsset: vi.fn(async () => false)
    };
    const editImage = vi.fn().mockResolvedValue({
      url: "/generated/task-pop-tpl/scene.png",
      model: "gpt-image-1",
      prompt: "p",
      sourceAssetIds: [],
      isFallback: false,
      generatedAt: new Date().toISOString()
    });
    const appendRecord = vi.fn().mockResolvedValue(undefined);

    const result = await generatePopTemplateScene({
      taskId: "task-pop-tpl",
      templateId: "main-sticker-feature",
      product: {
        id: "product-space-master",
        projectId: "project-user-workspace",
        category: "Refrigerator",
        displayName: "SPACE Master BCD-640",
        profile: {
          id: "profile-x",
          productId: "product-space-master",
          category: "Refrigerator",
          detectedFeatures: [],
          localizationHints: [],
          confidence: 0.9
        },
        assets: [
          {
            id: "asset-space-master-front",
            projectId: "p",
            productId: "product-space-master",
            type: "product-photo",
            filename: "front.png",
            url: "/uploads/p/front.png",
            source: "uploaded"
          }
        ],
        acceptsUserUploads: true
      },
      placement: "front panel",
      country: "Mexico",
      language: "Spanish",
      textValues: { headline: "640L capacity" },
      imageAssetIds: {},
      popImageBase64: Buffer.from("rasterized pop png").toString("base64"),
      imageStore: store,
      costLedger: { appendRecord, readRecords: vi.fn() },
      provider: { generateImage: vi.fn(), editImage }
    });

    expect(result.flatUrl).toContain("/generated/task-pop-tpl/");
    expect(result.scene.url).toBe("/generated/task-pop-tpl/scene.png");
    expect(result.templateVersion).toBe("2.0");

    const savedFilenames = saveGeneratedImage.mock.calls.map((call) => call[0].filename);
    expect(savedFilenames.some((name: string) => name.endsWith(".svg"))).toBe(true);
    expect(savedFilenames.some((name: string) => name.endsWith(".png"))).toBe(true);

    expect(editImage).toHaveBeenCalledTimes(1);
    const providerInput = editImage.mock.calls[0][0];
    expect(providerInput.sourceImages).toHaveLength(2);
    expect(providerInput.prompt).toContain("front panel");
    expect(appendRecord).toHaveBeenCalled();
  });

  it("passes resolved reference images to the provider", async () => {
    const store = createStubStore({
      "asset-photo": { bytes: Buffer.from("photo"), contentType: "image/png" }
    });
    const editImage = vi.fn().mockResolvedValue({
      url: "/generated/task-ref/asset-1.png",
      model: "gpt-image-1",
      prompt: "p",
      sourceAssetIds: ["asset-photo"],
      size: "1536x1024",
      isFallback: false,
      generatedAt: new Date().toISOString()
    });
    const provider: ImageProvider = { generateImage: vi.fn(), editImage };

    await generateDemoImage({
      taskId: "task-ref",
      prompt: "Standardize the phone shot",
      sourceAssetIds: ["asset-photo"],
      size: "1536x1024",
      imageStore: store,
      provider
    });

    expect(editImage).toHaveBeenCalledTimes(1);
    const input = editImage.mock.calls[0][0];
    expect(input.sourceImages).toHaveLength(1);
    expect(input.sourceImages[0].contentType).toBe("image/png");
    expect(input.size).toBe("1536x1024");
  });
  it("resolves and passes a dedicated mask image to the provider", async () => {
    const store = createStubStore({
      "asset-photo": { bytes: Buffer.from("photo"), contentType: "image/png" },
      "asset-mask": { bytes: Buffer.from("mask"), contentType: "image/png" }
    });
    const editImage = vi.fn().mockResolvedValue({
      url: "/generated/task-mask/output.png",
      model: "gpt-image-1",
      prompt: "p",
      sourceAssetIds: ["asset-photo", "asset-mask"],
      isFallback: false,
      generatedAt: new Date().toISOString()
    });

    await generateDemoImage({
      taskId: "task-mask",
      prompt: "Change only the masked handle",
      sourceAssetIds: ["asset-photo"],
      size: "1536x1024",
      maskAssetId: "asset-mask",
      imageStore: store,
      provider: { generateImage: vi.fn(), editImage }
    });

    const providerInput = editImage.mock.calls[0][0];
    expect(providerInput.sourceImages).toHaveLength(1);
    expect(providerInput.maskImage.filename).toBe("asset-mask.png");
    expect(providerInput.sourceAssetIds).toEqual(["asset-photo", "asset-mask"]);
  });
});
