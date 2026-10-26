// @vitest-environment node
/**
 * Cancellation checkpoints for the async job handlers (SDD T43).
 *
 * The worker relies on these checkpoints to stop mid-flight work as soon as a
 * user cancels: partial/finished results must never be returned after the
 * cancellation marker was written.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobStatus } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  updateJobProgress: vi.fn(),
  assertJobNotCancelled: vi.fn(),
  createUserWorkspace: vi.fn(),
  generatePopTemplateScene: vi.fn(),
  generateDemoImage: vi.fn(),
  loadStyleTransferReferences: vi.fn()
}));

vi.mock("@/src/platform/jobs", () => ({
  updateJobProgress: mocks.updateJobProgress,
  assertJobNotCancelled: mocks.assertJobNotCancelled
}));

vi.mock("@/src/platform/workspace", () => ({
  createUserWorkspace: mocks.createUserWorkspace
}));

vi.mock("@/src/services/demo-api", () => ({
  generatePopTemplateScene: mocks.generatePopTemplateScene,
  generateDemoImage: mocks.generateDemoImage
}));

vi.mock("@/src/services/style-transfer", () => ({
  loadStyleTransferReferences: mocks.loadStyleTransferReferences
}));

import { JobCancelledError } from "@/src/platform/errors";
import { executeJob } from "./job-handlers";
import { buildJob } from "./jobs.test-utils";

function popJob() {
  return buildJob({
    id: "job_handler_pop",
    userId: "user-1",
    type: "pop-scene",
    status: JobStatus.running,
    payload: { templateId: "template-1" }
  });
}

function styleTransferJob() {
  return buildJob({
    id: "job_handler_style",
    userId: "user-1",
    type: "style-transfer",
    status: JobStatus.running,
    payload: {
      productId: "product-1",
      productAssetId: "asset-1",
      styleId: "lab",
      variantId: "hero-scene",
      keywords: "clean studio"
    }
  });
}

function skuJob() {
  return buildJob({
    id: "job_handler_sku",
    userId: "user-1",
    type: "sku-replacement",
    status: JobStatus.running,
    payload: {
      productId: "product-1",
      mode: "color",
      baseAssetId: "asset-1",
      maskAssetId: "mask-1",
      instruction: "make the trim black"
    }
  });
}

beforeEach(() => {
  mocks.updateJobProgress.mockReset().mockResolvedValue(undefined);
  mocks.assertJobNotCancelled.mockReset().mockResolvedValue(undefined);
  mocks.generatePopTemplateScene.mockReset().mockResolvedValue({ url: "/generated/pop.png" });
  mocks.generateDemoImage.mockReset().mockResolvedValue({
    url: "/generated/image.png",
    model: "demo",
    prompt: "prompt",
    sourceAssetIds: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
    isFallback: false
  });
  mocks.loadStyleTransferReferences.mockReset().mockResolvedValue([]);
  mocks.createUserWorkspace.mockReset().mockReturnValue({
    productRegistry: {
      getProduct: vi.fn(async () => ({
        id: "product-1",
        displayName: "Product One",
        modelName: "P1",
        assets: [
          { id: "asset-1", type: "product-photo" },
          { id: "mask-1", type: "sku-mask" }
        ]
      }))
    },
    settingsStore: {
      read: vi.fn(async () => ({ country: "Mexico", language: "Spanish" }))
    },
    imageStore: {},
    costLedger: {}
  });
});

describe("job handler cancellation checkpoints", () => {
  it("runs the pop scene handler with checkpoints around the AI call", async () => {
    const result = await executeJob(popJob());

    expect(result).toEqual({ url: "/generated/pop.png" });
    expect(mocks.generatePopTemplateScene).toHaveBeenCalledTimes(1);
    // At least one checkpoint before and one after the expensive AI call.
    expect(mocks.assertJobNotCancelled.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.updateJobProgress).toHaveBeenCalledWith("job_handler_pop", 90);
  });

  it("aborts before calling the AI provider when the job was already cancelled", async () => {
    mocks.assertJobNotCancelled.mockRejectedValueOnce(new JobCancelledError());

    await expect(executeJob(popJob())).rejects.toBeInstanceOf(JobCancelledError);
    expect(mocks.generatePopTemplateScene).not.toHaveBeenCalled();
  });

  it("discards the generated result when cancellation lands during the AI call", async () => {
    let calls = 0;
    mocks.assertJobNotCancelled.mockImplementation(async () => {
      calls += 1;
      if (calls === 3) {
        throw new JobCancelledError();
      }
    });

    await expect(executeJob(popJob())).rejects.toBeInstanceOf(JobCancelledError);
    expect(mocks.generatePopTemplateScene).toHaveBeenCalledTimes(1);
  });

  it("checkpoints style transfer before any workspace or AI work happens", async () => {
    mocks.assertJobNotCancelled.mockRejectedValueOnce(new JobCancelledError());

    await expect(executeJob(styleTransferJob())).rejects.toBeInstanceOf(JobCancelledError);
    expect(mocks.createUserWorkspace).not.toHaveBeenCalled();
    expect(mocks.generateDemoImage).not.toHaveBeenCalled();
  });

  it("checkpoints SKU replacement before the AI call", async () => {
    let calls = 0;
    mocks.assertJobNotCancelled.mockImplementation(async () => {
      calls += 1;
      if (calls === 2) {
        throw new JobCancelledError();
      }
    });

    await expect(executeJob(skuJob())).rejects.toBeInstanceOf(JobCancelledError);
    expect(mocks.generateDemoImage).not.toHaveBeenCalled();
  });
});
