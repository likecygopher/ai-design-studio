import { PLATFORM_CONFIG } from "@/src/platform/config";
import { prisma } from "@/src/platform/db";
import { logger } from "@/src/platform/logger";
import { incrementCounter } from "@/src/platform/metrics";
import { getWorkerHealth } from "@/src/platform/worker-heartbeat";

/**
 * Central health snapshot + alert delivery.
 *
 * `/api/admin/health` and the worker-driven alert check share this module so
 * thresholds cannot drift between the dashboard and notifications.
 */

export type PlatformAlert = {
  id: string;
  severity: "critical" | "warning";
  message: string;
};

export type PlatformHealthSnapshot = {
  databaseOk: boolean;
  databaseError?: string;
  queued: number;
  running: number;
  failed: number;
  failureRate24h: number;
  workers: Awaited<ReturnType<typeof getWorkerHealth>>;
  alerts: PlatformAlert[];
};

export async function collectPlatformHealth(): Promise<PlatformHealthSnapshot> {
  let databaseOk = true;
  let databaseError: string | undefined;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    databaseOk = false;
    databaseError = error instanceof Error ? error.message : "database check failed";
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [queued, running, failed, workers, failingProviders, recentByStatus] =
    await Promise.all([
      prisma.generationJob.count({ where: { status: "queued" } }),
      prisma.generationJob.count({ where: { status: "running" } }),
      prisma.generationJob.count({ where: { status: "failed" } }),
      getWorkerHealth(),
      prisma.aiProvider.findMany({
        where: { enabled: true, consecutiveFailures: { gte: 2 } },
        select: { id: true, name: true, consecutiveFailures: true }
      }),
      prisma.generationJob.groupBy({
        by: ["status"],
        where: { updatedAt: { gte: since24h } },
        _count: { _all: true }
      })
    ]);

  const recent: Record<string, number> = {};
  for (const row of recentByStatus) {
    recent[row.status] = row._count._all;
  }
  const recentTotal = Object.values(recent).reduce((sum, value) => sum + value, 0);
  const failureRate24h = recentTotal > 0 ? (recent.failed ?? 0) / recentTotal : 0;

  const alerts: PlatformAlert[] = [];
  if (!databaseOk) {
    alerts.push({ id: "database", severity: "critical", message: "数据库连接不可用。" });
  }
  if (workers.alive === 0) {
    alerts.push({
      id: "workers",
      severity: "critical",
      message: "没有在线 Worker，任务不会被消费。"
    });
  }
  if (queued > PLATFORM_CONFIG.alertQueueDepth) {
    alerts.push({
      id: "queue-depth",
      severity: "warning",
      message: `排队任务 ${queued} 个，超过阈值 ${PLATFORM_CONFIG.alertQueueDepth}。`
    });
  }
  if (failureRate24h > PLATFORM_CONFIG.alertFailureRate) {
    alerts.push({
      id: "failure-rate",
      severity: "warning",
      message: `24 小时任务失败率 ${(failureRate24h * 100).toFixed(1)}%，超过阈值 ${(PLATFORM_CONFIG.alertFailureRate * 100).toFixed(0)}%。`
    });
  }
  for (const provider of failingProviders) {
    alerts.push({
      id: `provider-${provider.id}`,
      severity: "warning",
      message: `供应商「${provider.name}」连续失败 ${provider.consecutiveFailures} 次，已触发或即将触发自动切换。`
    });
  }

  return {
    databaseOk,
    databaseError,
    queued,
    running,
    failed,
    failureRate24h,
    workers,
    alerts
  };
}

type AlertState = {
  lastSignature: string;
  lastSentAt: number;
  hadAlerts: boolean;
};

const state: AlertState = { lastSignature: "", lastSentAt: 0, hadAlerts: false };

function signature(alerts: PlatformAlert[]): string {
  return alerts
    .map((alert) => `${alert.severity}:${alert.id}`)
    .sort()
    .join("|");
}

export type DispatchOptions = {
  webhookUrl?: string;
  cooldownMs?: number;
  nowMs?: number;
};

/**
 * Deliver alerts to a Slack-compatible webhook. Deduplicates by alert
 * signature + cooldown and emits a one-shot recovery message when clear.
 */
export async function dispatchAlertWebhook(
  alerts: PlatformAlert[],
  options: DispatchOptions = {}
): Promise<{ sent: boolean; reason?: string }> {
  const webhookUrl = options.webhookUrl ?? PLATFORM_CONFIG.alertWebhookUrl;
  if (!webhookUrl) {
    return { sent: false, reason: "not_configured" };
  }

  const nowMs = options.nowMs ?? Date.now();
  const cooldownMs = options.cooldownMs ?? PLATFORM_CONFIG.alertCooldownMs;
  const nextSignature = signature(alerts);

  if (alerts.length === 0) {
    if (!state.hadAlerts) {
      return { sent: false, reason: "no_active_alerts" };
    }
    state.hadAlerts = false;
    state.lastSignature = "";
    await postWebhook(webhookUrl, {
      text: "✅ Midea AI Content Studio: all platform alerts recovered."
    });
    incrementCounter("studio_alerts_dispatched_total", "Alert webhook deliveries.", {
      severity: "recovery"
    });
    return { sent: true };
  }

  state.hadAlerts = true;
  if (
    nextSignature === state.lastSignature &&
    nowMs - state.lastSentAt < cooldownMs
  ) {
    return { sent: false, reason: "cooldown" };
  }

  const lines = alerts.map(
    (alert) => `${alert.severity === "critical" ? "🚨" : "⚠️"} ${alert.message}`
  );
  const result = await postWebhook(webhookUrl, {
    text: `Midea AI Content Studio alerts (${alerts.length})\n${lines.join("\n")}`
  });
  if (!result.ok) {
    incrementCounter("studio_alert_dispatch_failures_total", "Failed alert webhook deliveries.");
    logger.warn("alerting.webhook_failed", { error: result.error });
    return { sent: false, reason: "delivery_failed" };
  }

  state.lastSignature = nextSignature;
  state.lastSentAt = nowMs;
  incrementCounter("studio_alerts_dispatched_total", "Alert webhook deliveries.", {
    severity: "alert"
  });
  logger.info("alerting.webhook_sent", { alerts: alerts.length });
  return { sent: true };
}

async function postWebhook(
  url: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    return response.ok ? { ok: true } : { ok: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "delivery failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** Worker-driven periodic check: collect → dispatch (never throws). */
export async function runAlertCheck(): Promise<void> {
  if (!PLATFORM_CONFIG.alertWebhookUrl) {
    return;
  }
  try {
    const snapshot = await collectPlatformHealth();
    await dispatchAlertWebhook(snapshot.alerts);
  } catch (error) {
    logger.warn("alerting.check_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/** Tests only: reset dedupe state. */
export function __resetAlertStateForTests(): void {
  state.lastSignature = "";
  state.lastSentAt = 0;
  state.hadAlerts = false;
}
