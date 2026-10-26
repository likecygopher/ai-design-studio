import { JobStatus, type GenerationJob } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobCancelledError } from "@/src/platform/errors";
import { WorkerRuntime, type WorkerDeps } from "./worker-runtime";

function job(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job_1",
    organizationId: null,
    userId: "user_1",
    type: "pop-scene",
    status: JobStatus.running,
    priority: 0,
    progress: 0,
    payload: {},
    result: null,
    error: null,
    attempts: 1,
    maxAttempts: 3,
    idempotencyKey: null,
    nextAttemptAt: null,
    cancelledAt: null,
    lockedAt: new Date(),
    lockedBy: "worker-1",
    startedAt: new Date(),
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    requiresApproval: false,
    approvedAt: new Date("2026-01-01T00:00:00.000Z"),
    approvedBy: null,
    approvalNote: null,
    ...overrides
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createDeps(overrides: Partial<WorkerDeps> = {}) {
  const deps = {
    workerId: "worker-test",
    concurrency: 2,
    pollMs: 1,
    heartbeatMs: 1000,
    shutdownTimeoutMs: 50,
    claimJobs: vi.fn(async () => [] as GenerationJob[]),
    executeJob: vi.fn(async () => ({ ok: true })),
    completeJob: vi.fn(async () => undefined),
    failJob: vi.fn(async () => undefined),
    reclaimStaleJobs: vi.fn(async () => 0),
    heartbeat: vi.fn(async () => undefined),
    removeHeartbeat: vi.fn(async () => undefined),
    // Real timer so shutdown races behave like production.
    sleep: vi.fn((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    log: vi.fn(),
    ...overrides
  } satisfies WorkerDeps;
  return deps;
}

describe("WorkerRuntime.runOnce", () => {
  it("reclaims stale leases before claiming new work", async () => {
    const deps = createDeps();
    const runtime = new WorkerRuntime(deps);

    await runtime.runOnce();

    expect(deps.reclaimStaleJobs).toHaveBeenCalledTimes(1);
    expect(deps.claimJobs).toHaveBeenCalledWith("worker-test", 2);
  });

  it("executes claimed jobs and completes them", async () => {
    const deps = createDeps({ claimJobs: vi.fn(async () => [job()]) });
    const runtime = new WorkerRuntime(deps);

    const claimed = await runtime.runOnce();
    await Promise.allSettled([...Array(1)].map(() => Promise.resolve()));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(claimed).toBe(1);
    expect(deps.executeJob).toHaveBeenCalledTimes(1);
    expect(deps.completeJob).toHaveBeenCalledWith("job_1", { ok: true });
    expect(deps.failJob).not.toHaveBeenCalled();
  });

  it("finalises cancelled jobs without retrying them", async () => {
    const deps = createDeps({
      claimJobs: vi.fn(async () => [job()]),
      executeJob: vi.fn(async () => {
        throw new JobCancelledError();
      })
    });
    const runtime = new WorkerRuntime(deps);

    await runtime.runOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.failJob).toHaveBeenCalledWith("job_1", "任务已取消。", { cancelled: true });
    expect(deps.completeJob).not.toHaveBeenCalled();
  });

  it("requeues generic failures through failJob", async () => {
    const deps = createDeps({
      claimJobs: vi.fn(async () => [job()]),
      executeJob: vi.fn(async () => {
        throw new Error("provider timeout");
      })
    });
    const runtime = new WorkerRuntime(deps);

    await runtime.runOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.failJob).toHaveBeenCalledWith("job_1", "provider timeout");
  });

  it("respects concurrency capacity", async () => {
    const gate = deferred();
    const deps = createDeps({
      concurrency: 1,
      claimJobs: vi.fn(async () => [job()]),
      executeJob: vi.fn(async () => {
        await gate.promise;
        return {};
      })
    });
    const runtime = new WorkerRuntime(deps);

    expect(await runtime.runOnce()).toBe(1);
    expect(runtime.activeCount).toBe(1);

    expect(await runtime.runOnce()).toBe(0);
    expect(deps.claimJobs).toHaveBeenCalledTimes(1);

    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.activeCount).toBe(0);
  });

  it("does not claim work once stopping", async () => {
    const deps = createDeps();
    const runtime = new WorkerRuntime(deps);
    await runtime.stop();

    expect(await runtime.runOnce()).toBe(0);
    expect(deps.claimJobs).not.toHaveBeenCalled();
  });
});

describe("WorkerRuntime lifecycle", () => {
  it("sends an immediate heartbeat", async () => {
    const deps = createDeps();
    const runtime = new WorkerRuntime(deps);

    await runtime.sendHeartbeat();

    expect(deps.heartbeat).toHaveBeenCalledWith({
      workerId: "worker-test",
      concurrency: 2,
      activeJobs: 0
    });
  });

  it("waits for in-flight jobs and removes the heartbeat on stop", async () => {
    const gate = deferred();
    const order: string[] = [];
    const deps = createDeps({
      concurrency: 1,
      claimJobs: vi.fn(async () => [job()]),
      executeJob: vi.fn(async () => {
        await gate.promise;
        order.push("executed");
        return {};
      }),
      removeHeartbeat: vi.fn(async () => {
        order.push("heartbeat-removed");
      })
    });
    const runtime = new WorkerRuntime(deps);

    await runtime.runOnce();
    expect(runtime.activeCount).toBe(1);

    const stopping = runtime.stop();
    gate.resolve();
    await stopping;

    expect(order).toEqual(["executed", "heartbeat-removed"]);
    expect(runtime.isStopping).toBe(true);
    expect(runtime.activeCount).toBe(0);
  });

  it("bounds shutdown waiting by the timeout", async () => {
    const never = deferred();
    const deps = createDeps({
      concurrency: 1,
      shutdownTimeoutMs: 5,
      claimJobs: vi.fn(async () => [job()]),
      executeJob: vi.fn(async () => {
        await never.promise;
        return {};
      })
    });
    const runtime = new WorkerRuntime(deps);

    await runtime.runOnce();
    await runtime.stop();

    expect(deps.removeHeartbeat).toHaveBeenCalledTimes(1);
    never.resolve();
  });

  it("survives heartbeat failures without throwing", async () => {
    const deps = createDeps({
      heartbeat: vi.fn(async () => {
        throw new Error("db down");
      })
    });
    const runtime = new WorkerRuntime(deps);

    await expect(runtime.sendHeartbeat()).resolves.toBeUndefined();
    expect(deps.log).toHaveBeenCalledWith(
      "worker.heartbeat_failed",
      expect.objectContaining({ error: "db down" })
    );
  });
});
