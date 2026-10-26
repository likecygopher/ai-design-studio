// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProvider } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  aggregate: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: {
    aiProvider: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      create: mocks.create,
      update: mocks.update,
      delete: mocks.delete,
      aggregate: mocks.aggregate
    }
  }
}));

vi.mock("@/src/platform/logger", () => {
  const noop = () => undefined;
  const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  return { logger, createLogger: () => logger };
});

import {
  __resetAiConfigRuntimeForTests,
  createProvider,
  deleteProvider,
  getProviderTestTarget,
  hydrateAiConfigFromDb,
  listProviders,
  recordProviderTest,
  setActiveProvider,
  updateProvider
} from "./ai-config";
import { encryptSecret } from "./secrets";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_PROXY_URL",
  "OPENAI_IMAGE_MODEL",
  "OPENAI_TEXT_MODEL",
  "OPENAI_VISION_MODEL",
  "ARK_API_KEY",
  "ARK_BASE_URL",
  "ARK_PROXY_URL",
  "DOUBAO_IMAGE_MODEL",
  "DOUBAO_VIDEO_MODEL",
  "DOUBAO_VIDEO_ENDPOINT_ID"
];

function clearEnv() {
  for (const key of ENV_KEYS) vi.stubEnv(key, "");
}

function row(overrides: Partial<AiProvider> = {}): AiProvider {
  return {
    id: "provider-1",
    name: "OpenAI",
    channel: "openai-compatible",
    baseUrl: "https://api.example/v1",
    proxyUrl: null,
    apiKeyCipher: encryptSecret("sk-test-1234"),
    models: { image: "gpt-image-1", text: "gpt-4o-mini" },
    enabled: true,
    priority: 100,
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

function stubRows(rows: AiProvider[]) {
  mocks.findMany.mockResolvedValue(rows);
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.findMany.mockResolvedValue([]);
  mocks.aggregate.mockResolvedValue({ _min: { priority: 10 } });
  __resetAiConfigRuntimeForTests();
  vi.unstubAllEnvs();
  clearEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("listProviders", () => {
  it("marks the first enabled provider per channel as active and masks keys", async () => {
    stubRows([
      row({ id: "p2", name: "OpenAI B", priority: 20 }),
      row({ id: "p1", name: "OpenAI A", priority: 10 }),
      row({
        id: "p3",
        name: "ARK",
        channel: "ark",
        priority: 100,
        apiKeyCipher: encryptSecret("ark-key-9999"),
        models: { image: "doubao-seedream" }
      })
    ]);

    const view = await listProviders();

    expect(view.providers.find((item) => item.id === "p1")?.active).toBe(true);
    expect(view.providers.find((item) => item.id === "p2")?.active).toBe(false);
    expect(view.providers.find((item) => item.id === "p3")?.active).toBe(true);
    const openai = view.providers.find((item) => item.id === "p1")!;
    expect(openai.apiKeyMasked).toBe("••••••1234");
    expect(openai.hasApiKey).toBe(true);
    expect(JSON.stringify(view)).not.toContain("sk-test-1234");
  });
});

describe("createProvider / updateProvider / deleteProvider", () => {
  it("encrypts the API key on create and projects it into env", async () => {
    mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      const created = row({
        id: "created",
        name: String(data.name),
        channel: String(data.channel),
        baseUrl: String(data.baseUrl),
        apiKeyCipher: data.apiKeyCipher as string,
        models: data.models as Record<string, string>
      });
      stubRows([created]);
      return created;
    });

    await createProvider({
      name: "DeepSeek",
      channel: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-deepseek-5678",
      models: { text: "deepseek-chat" }
    });

    const data = mocks.create.mock.calls[0][0].data;
    expect(data.apiKeyCipher.startsWith("enc:v1:")).toBe(true);
    expect(data.apiKeyCipher).not.toContain("sk-deepseek-5678");
    expect(process.env.OPENAI_API_KEY).toBe("sk-deepseek-5678");
    expect(process.env.OPENAI_BASE_URL).toBe("https://api.deepseek.com/v1");
    expect(process.env.OPENAI_TEXT_MODEL).toBe("deepseek-chat");
  });

  it("keeps the existing key unless clearApiKey is set", async () => {
    stubRows([row()]);
    mocks.findUnique.mockResolvedValue(row());
    mocks.update.mockResolvedValue(row());

    await updateProvider("provider-1", {
      name: "OpenAI",
      channel: "openai-compatible",
      baseUrl: "https://new.example/v1"
    });
    expect(mocks.update.mock.calls[0][0].data.apiKeyCipher).toBeUndefined();

    __resetAiConfigRuntimeForTests();
    await updateProvider("provider-1", {
      name: "OpenAI",
      channel: "openai-compatible",
      clearApiKey: true
    });
    expect(mocks.update.mock.calls[1][0].data.apiKeyCipher).toBeNull();
  });

  it("deletes a provider and refreshes env", async () => {
    mocks.delete.mockResolvedValue(row());
    await deleteProvider("provider-1");
    expect(mocks.delete).toHaveBeenCalledWith({ where: { id: "provider-1" } });
  });
});

describe("setActiveProvider", () => {
  it("raises the provider above the current minimum priority", async () => {
    mocks.findUnique.mockResolvedValue(row({ id: "p2", priority: 100 }));
    mocks.update.mockResolvedValue(row({ id: "p2", priority: 9 }));

    await setActiveProvider("p2");

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p2" },
        data: expect.objectContaining({ enabled: true, priority: 9 })
      })
    );
  });
});

describe("hydrateAiConfigFromDb", () => {
  it("applies the active provider to env and restores env fallbacks otherwise", async () => {
    vi.stubEnv("OPENAI_API_KEY", "env-key");
    __resetAiConfigRuntimeForTests();
    stubRows([row()]);

    await hydrateAiConfigFromDb();
    expect(process.env.OPENAI_API_KEY).toBe("sk-test-1234");
    expect(process.env.OPENAI_IMAGE_MODEL).toBe("gpt-image-1");

    stubRows([]);
    await hydrateAiConfigFromDb();
    expect(process.env.OPENAI_API_KEY).toBe("env-key");
    expect(process.env.OPENAI_IMAGE_MODEL).toBeUndefined();
  });
});

describe("test helpers", () => {
  it("returns decrypted provider target and records test results", async () => {
    mocks.findUnique.mockResolvedValue(row());
    mocks.update.mockResolvedValue(row());

    const target = await getProviderTestTarget("provider-1");
    expect(target).toMatchObject({
      name: "OpenAI",
      channel: "openai-compatible",
      baseUrl: "https://api.example/v1",
      apiKey: "sk-test-1234"
    });

    await recordProviderTest("provider-1", { ok: true, note: "OK · 200 · 120ms" });
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({
      lastTestOk: true,
      lastTestNote: "OK · 200 · 120ms"
    });
  });

  it("returns null for an unknown provider", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(await getProviderTestTarget("missing")).toBeNull();
  });
});
