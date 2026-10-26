import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { collectPlatformHealth } from "@/src/platform/alerting";
import { recordAudit } from "@/src/platform/audit";
import { defaultRateLimiter } from "@/src/platform/rate-limit";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleApi(request, { auth: "admin", rateLimit: { name: "admin:health" } }, async (ctx) => {
    const snapshot = await collectPlatformHealth();
    const memory = process.memoryUsage();

    await recordAudit({
      userId: ctx.userId,
      actorRole: ctx.role,
      action: "admin.health.read",
      targetType: "platform",
      ip: ctx.ip,
      requestId: ctx.requestId
    });

    const healthy =
      snapshot.databaseOk && snapshot.workers.alive > 0 && snapshot.alerts.length === 0;

    return NextResponse.json({
      status: healthy
        ? "ok"
        : snapshot.databaseOk && snapshot.workers.alive > 0
          ? "degraded"
          : "unhealthy",
      database: { ok: snapshot.databaseOk, error: snapshot.databaseError },
      queue: {
        queued: snapshot.queued,
        running: snapshot.running,
        failed: snapshot.failed,
        failureRate24h: snapshot.failureRate24h
      },
      alerts: snapshot.alerts,
      workers: snapshot.workers,
      rateLimiter: { trackedKeys: defaultRateLimiter.size() },
      process: {
        uptimeSec: Math.round(process.uptime()),
        nodeVersion: process.version,
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed
      },
      generatedAt: new Date().toISOString()
    });
  });
}
