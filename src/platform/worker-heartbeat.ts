/**
 * Worker liveness heartbeats, used by `/api/ready` and admin health.
 */
import { prisma } from "@/src/platform/db";
import { PLATFORM_CONFIG } from "@/src/platform/config";

export type WorkerHealth = {
  total: number;
  alive: number;
  stale: number;
  staleAfterMs: number;
  workers: Array<{
    id: string;
    lastSeenAt: string;
    concurrency: number;
    activeJobs: number;
    alive: boolean;
  }>;
};

export async function upsertWorkerHeartbeat(input: {
  workerId: string;
  concurrency: number;
  activeJobs: number;
}): Promise<void> {
  await prisma.workerHeartbeat.upsert({
    where: { id: input.workerId },
    create: {
      id: input.workerId,
      concurrency: input.concurrency,
      activeJobs: input.activeJobs
    },
    update: {
      concurrency: input.concurrency,
      activeJobs: input.activeJobs
    }
  });
}

export async function removeWorkerHeartbeat(workerId: string): Promise<void> {
  await prisma.workerHeartbeat.deleteMany({ where: { id: workerId } });
}

export async function getWorkerHealth(
  staleAfterMs = PLATFORM_CONFIG.workerHeartbeatStaleMs
): Promise<WorkerHealth> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const rows = await prisma.workerHeartbeat.findMany({
    orderBy: { lastSeenAt: "desc" },
    take: 50
  });

  const workers = rows.map((row) => ({
    id: row.id,
    lastSeenAt: row.lastSeenAt.toISOString(),
    concurrency: row.concurrency,
    activeJobs: row.activeJobs,
    alive: row.lastSeenAt >= cutoff
  }));

  const alive = workers.filter((worker) => worker.alive).length;

  return {
    total: workers.length,
    alive,
    stale: workers.length - alive,
    staleAfterMs,
    workers
  };
}

export async function isWorkerAlive(
  staleAfterMs = PLATFORM_CONFIG.workerHeartbeatStaleMs
): Promise<boolean> {
  const health = await getWorkerHealth(staleAfterMs);
  return health.alive > 0;
}
