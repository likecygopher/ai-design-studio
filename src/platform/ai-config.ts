import type { AiProvider } from "@prisma/client";
import { prisma } from "@/src/platform/db";
import { logger } from "@/src/platform/logger";
import { decryptSecret, encryptSecret, maskSecret } from "@/src/platform/secrets";
import {
  AI_CHANNELS,
  AI_MODEL_KEYS,
  channelMeta,
  type AiChannelId,
  type AiModelKey,
  type AiProviderModels
} from "@/src/platform/ai-provider-meta";
import type { AiProviderInputValues } from "@/src/platform/ai-provider-schema";

/**
 * Extensible AI provider registry.
 *
 * Providers are rows instead of hardcoded presets. Each row belongs to an
 * implementation *channel* (`openai-compatible` or `ark`). Runtime code still
 * reads `process.env`, so the first enabled provider of each channel (lowest
 * `priority`, then oldest) is projected onto that channel's env keys. Additional
 * rows stay stored for quick switching without changing application code.
 *
 * Precedence: active DB provider > `.env` baseline. Secrets are encrypted at rest
 * and only ever returned masked.
 */

export type AiProviderView = {
  id: string;
  name: string;
  channel: AiChannelId;
  channelLabel: string;
  baseUrl: string;
  proxyUrl: string | null;
  models: AiProviderModels;
  enabled: boolean;
  priority: number;
  hasApiKey: boolean;
  apiKeyMasked: string;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestNote: string | null;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AiProvidersView = {
  providers: AiProviderView[];
  channels: Array<{ id: AiChannelId; label: string; hint: string }>;
};

function parseModels(value: unknown): AiProviderModels {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const source = value as Record<string, unknown>;
  const models: AiProviderModels = {};
  for (const key of AI_MODEL_KEYS) {
    const raw = source[key];
    if (typeof raw === "string" && raw.trim()) {
      models[key] = raw.trim();
    }
  }
  return models;
}

function maskedKey(row: AiProvider): string {
  if (!row.apiKeyCipher) {
    return "";
  }
  try {
    return maskSecret(decryptSecret(row.apiKeyCipher));
  } catch {
    return "••••••";
  }
}

function toView(row: AiProvider, activeId: string | null): AiProviderView {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel as AiChannelId,
    channelLabel: channelMeta(row.channel).label,
    baseUrl: row.baseUrl,
    proxyUrl: row.proxyUrl,
    models: parseModels(row.models),
    enabled: row.enabled,
    priority: row.priority,
    hasApiKey: Boolean(row.apiKeyCipher),
    apiKeyMasked: maskedKey(row),
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
    lastTestOk: row.lastTestOk,
    lastTestNote: row.lastTestNote,
    successCount: row.successCount,
    failureCount: row.failureCount,
    consecutiveFailures: row.consecutiveFailures,
    lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
    lastFailureReason: row.lastFailureReason,
    active: row.id === activeId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function orderRows(rows: AiProvider[]): AiProvider[] {
  return [...rows].sort((left, right) => {
    if (left.channel !== right.channel) {
      return left.channel.localeCompare(right.channel);
    }
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.createdAt.getTime() - right.createdAt.getTime();
  });
}

export async function listProviders(): Promise<AiProvidersView> {
  const rows = orderRows(
    await prisma.aiProvider.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "asc" }] })
  );
  const activeByChannel = new Map<string, string>();
  for (const row of rows) {
    if (row.enabled && !activeByChannel.has(row.channel)) {
      activeByChannel.set(row.channel, row.id);
    }
  }
  return {
    providers: rows.map((row) => toView(row, activeByChannel.get(row.channel) ?? null)),
    channels: AI_CHANNELS.map((channel) => ({
      id: channel.id,
      label: channel.label,
      hint: channel.hint
    }))
  };
}

function normalizeInput(input: AiProviderInputValues, current?: AiProvider) {
  const models = { ...parseModels(current?.models) };
  if (input.models) {
    for (const key of AI_MODEL_KEYS) {
      const value = input.models[key as AiModelKey];
      if (value === undefined) {
        continue;
      }
      if (value.trim()) {
        models[key] = value.trim();
      } else {
        delete models[key];
      }
    }
  }

  const data: {
    name: string;
    channel: string;
    baseUrl: string;
    proxyUrl: string | null;
    models: AiProviderModels;
    enabled: boolean;
    apiKeyCipher?: string | null;
  } = {
    name: input.name.trim(),
    channel: input.channel,
    baseUrl: input.baseUrl?.trim() ?? current?.baseUrl ?? "",
    proxyUrl: input.proxyUrl === undefined ? current?.proxyUrl ?? null : input.proxyUrl.trim() || null,
    models,
    enabled: input.enabled ?? current?.enabled ?? true
  };

  if (input.clearApiKey) {
    data.apiKeyCipher = null;
  } else if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    data.apiKeyCipher = encryptSecret(input.apiKey.trim());
  }

  return data;
}

export async function createProvider(input: AiProviderInputValues): Promise<AiProvidersView> {
  await prisma.aiProvider.create({ data: normalizeInput(input) });
  await hydrateAiConfigFromDb();
  logger.info("ai_provider.created", { channel: input.channel });
  return listProviders();
}

export async function updateProvider(
  id: string,
  input: AiProviderInputValues
): Promise<AiProvidersView> {
  const current = await prisma.aiProvider.findUnique({ where: { id } });
  if (!current) {
    throw new Error("AI provider not found");
  }
  await prisma.aiProvider.update({ where: { id }, data: normalizeInput(input, current) });
  await hydrateAiConfigFromDb();
  logger.info("ai_provider.updated", { id });
  return listProviders();
}

export async function deleteProvider(id: string): Promise<AiProvidersView> {
  await prisma.aiProvider.delete({ where: { id } });
  await hydrateAiConfigFromDb();
  logger.info("ai_provider.deleted", { id });
  return listProviders();
}

/** Make a provider the first enabled one for its channel. */
export async function setActiveProvider(id: string): Promise<AiProvidersView> {
  const current = await prisma.aiProvider.findUnique({ where: { id } });
  if (!current) {
    throw new Error("AI provider not found");
  }
  const lowest = await prisma.aiProvider.aggregate({
    where: { channel: current.channel, enabled: true },
    _min: { priority: true }
  });
  const nextPriority = Math.min(current.priority, (lowest._min.priority ?? current.priority) - 1);
  await prisma.aiProvider.update({
    where: { id },
    data: { enabled: true, priority: nextPriority }
  });
  await hydrateAiConfigFromDb();
  logger.info("ai_provider.activated", { id });
  return listProviders();
}

export type ProviderTestTarget = {
  id: string;
  name: string;
  channel: AiChannelId;
  baseUrl: string;
  proxyUrl?: string;
  apiKey?: string;
};

export async function getProviderTestTarget(id: string): Promise<ProviderTestTarget | null> {
  const row = await prisma.aiProvider.findUnique({ where: { id } });
  if (!row) {
    return null;
  }
  let apiKey: string | undefined;
  if (row.apiKeyCipher) {
    try {
      apiKey = decryptSecret(row.apiKeyCipher);
    } catch (error) {
      logger.warn("ai_provider.decrypt_failed", {
        id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return {
    id: row.id,
    name: row.name,
    channel: row.channel as AiChannelId,
    baseUrl: row.baseUrl,
    proxyUrl: row.proxyUrl ?? undefined,
    apiKey
  };
}

export async function recordProviderTest(
  id: string,
  result: { ok: boolean; note: string }
): Promise<void> {
  await prisma.aiProvider.update({
    where: { id },
    data: {
      lastTestAt: new Date(),
      lastTestOk: result.ok,
      lastTestNote: result.note.slice(0, 200)
    }
  });
}

/* ------------------------------- runtime env ------------------------------- */

const CHANNEL_ENV_KEYS = AI_CHANNELS.flatMap((channel) => [
  channel.env.apiKey,
  channel.env.baseUrl,
  channel.env.proxyUrl,
  ...channel.modelFields.map((field) => field.envKey)
]);

let envBaseline: Record<string, string | undefined> | null = null;

function ensureBaseline(): Record<string, string | undefined> {
  if (!envBaseline) {
    envBaseline = {};
    for (const key of CHANNEL_ENV_KEYS) {
      envBaseline[key] = process.env[key];
    }
  }
  return envBaseline;
}

function restoreChannelEnv(channel: (typeof AI_CHANNELS)[number]): void {
  const baseline = ensureBaseline();
  for (const key of [
    channel.env.apiKey,
    channel.env.baseUrl,
    channel.env.proxyUrl,
    ...channel.modelFields.map((field) => field.envKey)
  ]) {
    const value = baseline[key];
    if (typeof value === "string" && value.trim()) {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

function applyProvidersToEnv(rows: AiProvider[]): void {
  for (const channel of AI_CHANNELS) {
    restoreChannelEnv(channel);
  }

  const activeByChannel = new Map<string, AiProvider>();
  for (const row of orderRows(rows)) {
    if (!row.enabled || activeByChannel.has(row.channel)) {
      continue;
    }
    activeByChannel.set(row.channel, row);
  }

  for (const [channelId, row] of activeByChannel) {
    const channel = channelMeta(channelId);
    const models = parseModels(row.models);

    if (row.apiKeyCipher) {
      try {
        process.env[channel.env.apiKey] = decryptSecret(row.apiKeyCipher);
      } catch (error) {
        logger.warn("ai_provider.env_decrypt_failed", {
          id: row.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (row.baseUrl.trim()) {
      process.env[channel.env.baseUrl] = row.baseUrl.trim();
    }
    if (row.proxyUrl?.trim()) {
      process.env[channel.env.proxyUrl] = row.proxyUrl.trim();
    }
    for (const field of channel.modelFields) {
      const value = models[field.key];
      if (value) {
        process.env[field.envKey] = value;
      }
    }
  }
}

/** Load provider rows and project the active provider of each channel into env. */
export async function hydrateAiConfigFromDb(): Promise<void> {
  try {
    const rows = await prisma.aiProvider.findMany({});
    applyProvidersToEnv(rows);
  } catch (error) {
    logger.warn("ai_provider.hydrate_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

let hydrationPromise: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Provider entry points call this before reading env (lazy, Edge-safe bootstrap).
 * Unit tests mock providers, so hydration is skipped in the test environment.
 */
export async function ensureAiConfigHydrated(): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  hydrationPromise ??= hydrateAiConfigFromDb();
  // Worker-side failover may change the active provider; refresh this web
  // process periodically so synchronous routes pick up the fallback too.
  if (!refreshTimer) {
    refreshTimer = setInterval(() => {
      void hydrateAiConfigFromDb();
    }, 60_000);
    refreshTimer.unref?.();
  }
  return hydrationPromise;
}

export function __resetAiConfigRuntimeForTests(): void {
  envBaseline = null;
  hydrationPromise = null;
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
