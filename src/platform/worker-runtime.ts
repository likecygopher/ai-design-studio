/**
 * Worker runtime (SDD R4.5): heartbeat, stale-lease reclamation, concurrency
 * accounting and graceful shutdown, decoupled from the process entry point so
 * it can be unit tested without PostgreSQL or a real AI provider.
 */
import { JobStatus, type GenerationJob } from "@prisma/client";
import { recordJobOutcome } from "@/src/platform/metrics";
import { JobCancelledError } from "@/src/platform/errors";

export type WorkerHeartbeatFn = (input: {
  workerId: string;
  concurrency: number;
  activeJobs: number;
}) => Promise<void>;

export type WorkerDeps = {
  workerId: string;
  concurrency: number;
  pollMs: number;
  heartbeatMs: number;
  shutdownTimeoutMs?: number;
  claimJobs(workerId: string, limit: number): Promise<GenerationJob[]>;
  executeJob(job: GenerationJob): Promise<unknown>;
  completeJob(jobId: string, result: object): Promise<unknown>;
  failJob(jobId: string, error: string, options?: { cancelled?: boolean }): Promise<unknown>;
  reclaimStaleJobs(): Promise<number>;
  heartbeat: WorkerHeartbeatFn;
  removeHeartbeat(workerId: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  log?: (message: string, fields?: Record<string, unknown>) => void;
};

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

export class WorkerRuntime {
  private readonly deps: WorkerDeps;
  private readonly inFlight = new Set<Promise<void>>();
  private stopping = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private loopPromise: Promise<void> | undefined;

  constructor(deps: WorkerDeps) {
    this.deps = deps;
  }

  get activeCount(): number {
    return this.inFlight.size;
  }

  get isStopping(): boolean {
    return this.stopping;
  }

  /** Start heartbeat + poll loop (non-blocking). */
  start(): void {
    if (this.loopPromise) {
      return;
    }
    // Fail fast / make readiness green immediately.
    void this.sendHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, this.deps.heartbeatMs);
    this.heartbeatTimer.unref?.();
    this.loopPromise = this.loop();
  }

  /**
   * One poll cycle: reclaim stale leases, claim up to free capacity and start
   * executing. Returns the number of claimed jobs.
   */
  async runOnce(): Promise<number> {
    if (this.stopping) {
      return 0;
    }

    try {
      const reclaimed = await this.deps.reclaimStaleJobs();
      if (reclaimed > 0) {
        this.log("worker.reclaimed", { count: reclaimed });
      }
    } catch (error) {
      this.log("worker.reclaim_failed", { error: errorMessage(error) });
    }

    const capacity = this.deps.concurrency - this.inFlight.size;
    if (capacity <= 0) {
      return 0;
    }

    let jobs: GenerationJob[];
    try {
      jobs = await this.deps.claimJobs(this.deps.workerId, capacity);
    } catch (error) {
      this.log("worker.claim_failed", { error: errorMessage(error) });
      return 0;
    }

    for (const job of jobs) {
      const task = this.runJob(job).finally(() => {
        this.inFlight.delete(task);
      });
      this.inFlight.add(task);
    }

    return jobs.length;
  }

  /**
   * Stop claiming new work, wait for in-flight jobs (bounded), then remove the
   * heartbeat. Idempotent.
   */
  async stop(): Promise<void> {
    if (this.stopping) {
      return;
    }
    this.stopping = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    const timeoutMs = this.deps.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    if (this.loopPromise) {
      await Promise.race([
        this.loopPromise.catch(() => undefined),
        this.deps.sleep(timeoutMs)
      ]);
    }

    if (this.inFlight.size > 0) {
      await Promise.race([
        Promise.allSettled([...this.inFlight]),
        this.deps.sleep(timeoutMs)
      ]);
    }

    try {
      await this.deps.removeHeartbeat(this.deps.workerId);
    } catch (error) {
      this.log("worker.heartbeat_remove_failed", { error: errorMessage(error) });
    }
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      let processed = 0;
      try {
        processed = await this.runOnce();
      } catch (error) {
        this.log("worker.loop_error", { error: errorMessage(error) });
      }
      if (processed === 0) {
        await this.deps.sleep(this.deps.pollMs);
      }
    }
  }

  /** Send one heartbeat immediately (also used by tests and readiness warm-up). */
  async sendHeartbeat(): Promise<void> {
    if (this.stopping) {
      return;
    }
    try {
      await this.deps.heartbeat({
        workerId: this.deps.workerId,
        concurrency: this.deps.concurrency,
        activeJobs: this.inFlight.size
      });
    } catch (error) {
      this.log("worker.heartbeat_failed", { error: errorMessage(error) });
    }
  }

  private async runJob(job: GenerationJob): Promise<void> {
    const startedAt = Date.now();
    this.log("worker.job_start", { jobId: job.id, type: job.type, userId: job.userId });
    try {
      const result = await this.deps.executeJob(job);
      // completeJob itself refuses to overwrite a cancellation that landed while
      // the last stage was running.
      await this.deps.completeJob(job.id, (result ?? {}) as object);
      recordJobOutcome({ ok: true, durationMs: Date.now() - startedAt, type: job.type });
      this.log("worker.job_done", { jobId: job.id, durationMs: Date.now() - startedAt });
    } catch (error) {
      if (error instanceof JobCancelledError) {
        this.log("worker.job_cancelled", { jobId: job.id });
        await this.deps
          .failJob(job.id, error.message || "任务已取消。", { cancelled: true })
          .catch((failure) =>
            this.log("worker.cancel_finalize_failed", {
              jobId: job.id,
              error: errorMessage(failure)
            })
          );
        return;
      }
      const message = errorMessage(error) || "任务执行失败";
      recordJobOutcome({ ok: false, durationMs: Date.now() - startedAt, type: job.type });
      this.log("worker.job_failed", { jobId: job.id, error: message });
      await this.deps
        .failJob(job.id, message)
        .catch((failure) =>
          this.log("worker.fail_persist_failed", {
            jobId: job.id,
            error: errorMessage(failure)
          })
        );
    }
  }

  private log(message: string, fields: Record<string, unknown> = {}): void {
    this.deps.log?.(message, fields);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

export type { GenerationJob, JobStatus };
