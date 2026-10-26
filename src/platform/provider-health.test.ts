// @vitest-environment node
import type { AiProvider } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  hydrate: vi.fn(),
  recordAudit: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: {
    aiProvider: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      update: mocks.update
    }
  }
}));

vi.mock("@/src/platform/ai-config", () => ({
  hydrateAiConfigFromDb: mocks.hydrate
}));

vi.mock("@/src/platform/audit", () => ({ recordAudit: mocks.recordAudit }));

vi.mock("@/src/platform/logger", () => {
  const noop = () => undefined;
  const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  return { logger, createLogger: () => logger };
});

import { inferJobChannel, recordJobProviderOutcome } from "./provider-health";
import type { AiChannelId } from "./ai-provider-meta";

function provider(overrides: Partial<AiProvider> = {}): AiProvider {
  return {
    id: "provider-1",
    name: "OpenAI",
    channel: "openai-compatible",
    baseUrl: "https://api.example/v1",
    proxyUrl: null,
    apiKeyCipher: null,
    models: {},
    enabled: true,
    priority: 10,
    lastTestAt: null,
    lastTestOk: null,
    lastTestNote: null,
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    lastFailureAt: null,
    lastFailureReason: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides
  };
}

function jobFor(type: string, payload: Record<string, unknown> = {}) {
  return { type, payload } as never;
}

function applyIncrement(row: AiProvider, data: Record<string, unknown>): AiProvider {
  const next = { ...row };
  if (data.successCount) {
    next.successCount += 1;
    next.consecutiveFailures = 0;
  }
  if (data.failureCount) {
    next.failureCount += 1;
    next.consecutiveFailures += 1;
    next.lastFailureAt = new Date("2026-03-01T00:00:00.000Z");
    next.lastFailureReason = (data.lastFailureReason as string) ?? null;
  }
  return next;
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.findFirst.mockResolvedValue(null);
  mocks.findMany.mockResolvedValue([]);
  mocks.hydrate.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
});

describe("inferJobChannel", () => {
  it("routes video jobs to ARK and doubao images to ARK", () => {
    expect(inferJobChannel(jobFor("product-video"))).toBe("ark");
    expect(inferJobChannel(jobFor("pop-scene", { imageModel: "doubao" }))).toBe("ark");
  });

  it("defaults other jobs to the OpenAI-compatible channel", () => {
    expect(inferJobChannel(jobFor("pop-scene", { imageModel: "openai" }))).toBe(
      "openai-compatible"
    );
    expect(inferJobChannel(jobFor("style-transfer", {}))).toBe("openai-compatible");
  });
});

describe("recordJobProviderOutcome", () => {
  it("records a success and resets consecutive failures", async () => {
    const active = provider({ consecutiveFailures: 3 });
    mocks.findFirst.mockResolvedValue(active);
    mocks.update.mockImplementation(async ({ data }) =>
      applyIncrement(active, data as Record<string, unknown>)
    );

    const result = await recordJobProviderOutcome({
      job: jobFor("pop-scene", { imageModel: "openai" }),
      ok: true,
      latencyMs: 120
    });

    expect(result).toBeNull();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "provider-1" },
        data: { successCount: { increment: 1 }, consecutiveFailures: 0 }
      })
    );
  });

  it("keeps the active provider after the first failure", async () => {
    const active = provider();
    mocks.findFirst.mockResolvedValue(active);
    mocks.update.mockImplementation(async ({ data }) =>
      applyIncrement(active, data as Record<string, unknown>)
    );

    const result = await recordJobProviderOutcome({
      job: jobFor("pop-scene", { imageModel: "openai" }),
      ok: false,
      latencyMs: 200,
      error: new Error("upstream 503")
    });

    expect(result).toBeNull();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("promotes the next provider after two consecutive failures", async () => {
    const active = provider({ id: "provider-1", priority: 10 });
    const fallback = provider({
      id: "provider-2",
      channel: "openai-compatible",
      priority: 20,
      name: "DeepSeek"
    });
    const rows = new Map<string, AiProvider>([
      ["provider-1", active],
      ["provider-2", fallback]
    ]);
    mocks.findFirst.mockImplementation(async () => rows.get("provider-1") ?? null);
    mocks.update.mockImplementation(async ({ where, data }) => {
      const row = rows.get(where.id as string) ?? active;
      const next = applyIncrement(row, data as Record<string, unknown>);
      if (typeof data.priority === "number") next.priority = data.priority;
      rows.set(where.id as string, next);
      return next;
    });
    mocks.findMany.mockResolvedValue([active, fallback]);

    const first = await recordJobProviderOutcome({
      job: jobFor("style-transfer", {}),
      ok: false,
      latencyMs: 50,
      error: new Error("network failed")
    });
    expect(first).toBeNull();

    const second = await recordJobProviderOutcome({
      job: jobFor("style-transfer", {}),
      ok: false,
      latencyMs: 50,
      error: new Error("network failed")
    });

    expect(second).toEqual({ channel: "openai-compatible", fromId: "provider-1", toId: "provider-2" });
    expect(mocks.hydrate).toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "provider-2" },
      data: { priority: 9 }
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.ai_config.failover",
        actorRole: "system",
        targetId: "provider-2"
      })
    );
  });

  it("does nothing when no provider is configured for the channel", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const result = await recordJobProviderOutcome({
      job: jobFor("product-video"),
      ok: false,
      latencyMs: 10
    });
    expect(result).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not fail over when the channel has a single provider", async () => {
    const only = provider();
    mocks.findFirst.mockResolvedValue(only);
    mocks.update.mockImplementation(async ({ data }) =>
      applyIncrement(only, data as Record<string, unknown>)
    );
    mocks.findMany.mockResolvedValue([only]);

    await recordJobProviderOutcome({
      job: jobFor("pop-scene", {}),
      ok: false,
      latencyMs: 10,
      error: new Error("network failed")
    });
    const result = await recordJobProviderOutcome({
      job: jobFor("pop-scene", {}),
      ok: false,
      latencyMs: 10,
      error: new Error("network failed")
    });
    expect(result).toBeNull();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});
