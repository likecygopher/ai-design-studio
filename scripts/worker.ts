import { randomUUID } from "node:crypto";
import { PLATFORM_CONFIG } from "../src/platform/config";
import { hydrateAiConfigFromDb } from "../src/platform/ai-config";
import {
  dispatchJobWebhooks,
  processWebhookRetries
} from "../src/platform/webhooks";
import { runAlertCheck } from "../src/platform/alerting";
import { logger } from "../src/platform/logger";
import { prisma } from "../src/platform/db";
import { executeJob } from "../src/platform/job-handlers";
import { recordJobProviderOutcome } from "../src/platform/provider-health";
import { claimJobs, completeJob, failJob, reclaimStaleJobs } from "../src/platform/jobs";
import {
  removeWorkerHeartbeat,
  upsertWorkerHeartbeat
} from "../src/platform/worker-heartbeat";
import { WorkerRuntime } from "../src/platform/worker-runtime";

const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
const pollMs = Number(process.env.WORKER_POLL_MS ?? 2000);

const runtime = new WorkerRuntime({
  workerId,
  concurrency: PLATFORM_CONFIG.jobConcurrency,
  pollMs,
  heartbeatMs: PLATFORM_CONFIG.workerHeartbeatMs,
  claimJobs,
  executeJob: async (job) => {
    const startedAt = Date.now();
    try {
      const result = await executeJob(job);
      // Fire-and-forget usage attribution; never affects job completion.
      await recordJobProviderOutcome({
        job,
        ok: true,
        latencyMs: Date.now() - startedAt
      }).catch(() => undefined);
      return result;
    } catch (error) {
      await recordJobProviderOutcome({
        job,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error
      }).catch(() => undefined);
      throw error;
    }
  },
  completeJob: async (jobId, result) => {
    const job = await completeJob(jobId, result as never);
    void dispatchJobWebhooks(job, "job.succeeded").catch(() => undefined);
    return job;
  },
  failJob: async (jobId, error, options) => {
    const job = await failJob(jobId, error, options);
    if (job?.status === "failed") {
      void dispatchJobWebhooks(job, "job.failed").catch(() => undefined);
    }
    return job;
  },
  reclaimStaleJobs: () => reclaimStaleJobs(),
  heartbeat: ({ workerId: id, concurrency, activeJobs }) =>
    upsertWorkerHeartbeat({ workerId: id, concurrency, activeJobs }),
  removeHeartbeat: removeWorkerHeartbeat,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (message, fields = {}) => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: message,
        workerId,
        ...fields
      })
    );
  }
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      msg: "worker.shutdown",
      workerId,
      signal
    })
  );
  try {
    await runtime.stop();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error("[worker] shutdown error", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("unhandledRejection", (reason) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      msg: "worker.unhandled_rejection",
      workerId,
      error: reason instanceof Error ? reason.message : String(reason)
    })
  );
});

console.log(
  JSON.stringify({
    ts: new Date().toISOString(),
    level: "info",
    msg: "worker.start",
    workerId,
    concurrency: PLATFORM_CONFIG.jobConcurrency,
    maxUserActiveJobs: PLATFORM_CONFIG.maxUserActiveJobs,
    pollMs
  })
);

runtime.start();

// Admin-managed AI configuration must also reach the worker process.
void hydrateAiConfigFromDb();
const aiConfigRefresh = setInterval(() => {
  void hydrateAiConfigFromDb();
}, 60_000);
aiConfigRefresh.unref?.();

// Platform alert checks (no-op unless ALERT_WEBHOOK_URL is configured).
void runAlertCheck();
const alertCheckTimer = setInterval(() => {
  void runAlertCheck();
}, 60_000);
alertCheckTimer.unref?.();

// Retry failed webhook deliveries with exponential backoff.
void processWebhookRetries();
const webhookRetryTimer = setInterval(() => {
  void processWebhookRetries().catch((error) => {
    logger.warn("webhook.retry_sweep_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  });
}, 60_000);
webhookRetryTimer.unref?.();
