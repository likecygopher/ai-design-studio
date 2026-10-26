import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { isProduction } from "@/src/platform/config";
import { prisma } from "@/src/platform/db";
import { logger } from "@/src/platform/logger";
import { getWorkerHealth } from "@/src/platform/worker-heartbeat";

export const dynamic = "force-dynamic";

function requiresWorker(): boolean {
  const explicit = process.env.READY_REQUIRE_WORKER;
  if (explicit === "true") {
    return true;
  }
  if (explicit === "false") {
    return false;
  }
  return isProduction();
}

/**
 * Readiness probe: database reachable (and, when required, at least one worker
 * heartbeat within the staleness window). Returns 503 so orchestrators stop
 * routing traffic to an unhealthy instance.
 */
export function GET(request: Request) {
  return handleApi(request, { auth: "public", rateLimit: false }, async (ctx) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { ok: true };
    } catch (error) {
      checks.database = {
        ok: false,
        detail: error instanceof Error ? error.message : "database check failed"
      };
      logger.error("ready.database_failed", error, { requestId: ctx.requestId });
    }

    if (requiresWorker()) {
      try {
        const workers = await getWorkerHealth();
        checks.worker = {
          ok: workers.alive > 0,
          detail: `${workers.alive}/${workers.total} alive (stale after ${workers.staleAfterMs}ms)`
        };
      } catch (error) {
        checks.worker = {
          ok: false,
          detail: error instanceof Error ? error.message : "worker heartbeat check failed"
        };
      }
    } else {
      checks.worker = { ok: true, detail: "not required outside production" };
    }

    const ok = Object.values(checks).every((check) => check.ok);

    return NextResponse.json(
      {
        status: ok ? "ready" : "degraded",
        checks,
        requestId: ctx.requestId,
        timestamp: new Date().toISOString()
      },
      { status: ok ? 200 : 503 }
    );
  });
}
