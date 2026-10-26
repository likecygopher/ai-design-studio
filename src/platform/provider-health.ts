import type { GenerationJob } from "@prisma/client";
import { recordAudit } from "@/src/platform/audit";
import { hydrateAiConfigFromDb } from "@/src/platform/ai-config";
import { channelMeta, type AiChannelId } from "@/src/platform/ai-provider-meta";
import { prisma } from "@/src/platform/db";
import { logger } from "@/src/platform/logger";
import { recordProviderOutcome } from "@/src/platform/metrics";

/**
 * AI provider health & failover.
 *
 * Golden path: every job attempt is attributed to the active provider of the
 * channel inferred from the job payload. Success resets consecutive failures;
 * two consecutive failures promote the next enabled provider of that channel so
 * the worker's automatic retry runs against a fallback.
 *
 * This is workload-level failover: it does not mutate provider code or env
 * mid-request, and it is safe across concurrent workers because activation is a
 * database priority update.
 */

type JobLike = Pick<GenerationJob, "type" | "payload">;

export function inferJobChannel(job: JobLike): AiChannelId {
  if (job.type === "product-video") {
    return "ark";
  }
  const payload =
    job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? (job.payload as Record<string, unknown>)
      : {};
  const imageModel = typeof payload.imageModel === "string" ? payload.imageModel : "";
  return imageModel === "doubao" ? "ark" : "openai-compatible";
}

export type ProviderOutcomeInput = {
  job: JobLike;
  ok: boolean;
  latencyMs: number;
  error?: unknown;
};

export type FailoverResult = {
  channel: AiChannelId;
  fromId: string;
  toId: string;
};

async function activeProvider(channel: AiChannelId) {
  return prisma.aiProvider.findFirst({
    where: { channel, enabled: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
  });
}

/** Promote the next enabled provider of the channel above the failing one. */
export async function failoverProvider(input: {
  channel: AiChannelId;
  fromId: string;
  reason?: string;
}): Promise<FailoverResult | null> {
  const rows = await prisma.aiProvider.findMany({
    where: { channel: input.channel, enabled: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
  });
  const current = rows.find((row) => row.id === input.fromId);
  if (!current) {
    return null;
  }
  const next = rows.find((row) => row.id !== input.fromId);
  if (!next) {
    return null;
  }

  const minPriority = Math.min(...rows.map((row) => row.priority));
  await prisma.aiProvider.update({
    where: { id: next.id },
    data: { priority: minPriority - 1 }
  });
  await hydrateAiConfigFromDb();

  void recordAudit({
    userId: null,
    actorRole: "system",
    action: "admin.ai_config.failover",
    targetType: "ai_provider",
    targetId: next.id,
    metadata: {
      channel: input.channel,
      from: current.id,
      to: next.id,
      reason: input.reason,
      consecutiveFailures: current.consecutiveFailures
    }
  });

  logger.warn("ai_provider.failover", {
    channel: input.channel,
    from: current.id,
    to: next.id,
    reason: input.reason
  });

  return { channel: input.channel, fromId: current.id, toId: next.id };
}

/**
 * Record one job attempt against the channel's active provider and trigger
 * failover after repeated failures. Safe to fire-and-forget; never throws into
 * the worker path.
 */
export async function recordJobProviderOutcome(
  input: ProviderOutcomeInput
): Promise<FailoverResult | null> {
  const channel = inferJobChannel(input.job);
  const active = await activeProvider(channel);
  if (!active) {
    return null;
  }

  const reason = input.error
    ? (input.error instanceof Error ? input.error.message : String(input.error)).slice(0, 200)
    : null;

  recordProviderOutcome({ ok: input.ok, channel });
  const updated = await prisma.aiProvider.update({
    where: { id: active.id },
    data: input.ok
      ? { successCount: { increment: 1 }, consecutiveFailures: 0 }
      : {
          failureCount: { increment: 1 },
          consecutiveFailures: { increment: 1 },
          lastFailureAt: new Date(),
          lastFailureReason: reason
        }
  });

  if (input.ok) {
    return null;
  }

  logger.info("ai_provider.job_failure", {
    channel,
    providerId: active.id,
    consecutiveFailures: updated.consecutiveFailures,
    latencyMs: input.latencyMs,
    reason
  });

  if (updated.consecutiveFailures < 2) {
    return null;
  }

  return failoverProvider({ channel, fromId: active.id, reason: reason ?? undefined });
}

/** Human-readable channel label (used by admin summaries/tests). */
export function channelLabel(channel: AiChannelId): string {
  return channelMeta(channel).label;
}
