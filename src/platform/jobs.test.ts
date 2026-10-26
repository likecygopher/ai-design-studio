// @vitest-environment node
/**
 * Unit tests for the job reliability layer (SDD T40-T45):
 * idempotent submit, exponential backoff, stale-lease reclaim, cancellation,
 * cursor pagination, audit trail and progress throttling.
 */
import { JobStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobCancelledError } from "@/src/platform/errors";
import { PLATFORM_CONFIG } from "@/src/platform/config";

const shared = vi.hoisted(() => ({
  prisma: null as unknown,
  assertWithinBudget: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn()
  }
}));

vi.mock("@/src/platform/db", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_target, property) =>
        (shared.prisma as Record<string | symbol, unknown>)[property]
    }
  )
}));

vi.mock("@/src/platform/logger", () => ({
  logger: shared.logger,
  createLogger: () => shared.logger
}));

vi.mock("@/src/platform/quotas", () => ({
  assertWithinBudget: shared.assertWithinBudget
}));

import {
  JOBS_DEFAULT_PAGE_SIZE,
  JOBS_MAX_PAGE_SIZE,
  JobQuotaError,
  assertJobNotCancelled,
  approveJob,
  cancelJob,
  cancelJobForAdmin,
  claimJobs,
  completeJob,
  computeBackoffDelayMs,
  enqueueJob,
  enqueueJobIdempotent,
  failJob,
  getJobForUser,
  listJobsForUser,
  normalizeJobLimit,
  reclaimStaleJobs,
  rejectJob,
  retryJobForActor,
  serializeJob,
  updateJobProgress
} from "./jobs";
import { buildJob, createFakePrisma, flushAsync, type FakePrisma } from "./jobs.test-utils";

function fake(): FakePrisma {
  return shared.prisma as FakePrisma;
}

function state() {
  return fake().state;
}

function jobById(id: string) {
  const job = state().jobs.find((candidate) => candidate.id === id);
  if (!job) {
    throw new Error(`fake job ${id} not found`);
  }
  return job;
}

beforeEach(() => {
  shared.prisma = createFakePrisma();
  shared.assertWithinBudget.mockReset().mockResolvedValue({
    monthStart: "2026-01-01T00:00:00.000Z",
    usedUnits: 0,
    budgetUnits: null,
    remainingUnits: null,
    percent: null,
    exceeded: false,
    inherited: false
  });
  shared.logger.warn.mockClear();
  shared.logger.info.mockClear();
  shared.logger.error.mockClear();
});

describe("T40 idempotent enqueue", () => {
  it("creates a queued job with nextAttemptAt and platform retry defaults", async () => {
    const result = await enqueueJobIdempotent({
      userId: "user-1",
      type: "pop-scene",
      payload: { templateId: "tpl-1" },
      idempotencyKey: "submit-key-0001",
      actorRole: "user",
      requestId: "req_test"
    });

    expect(result.created).toBe(true);
    expect(result.job.status).toBe(JobStatus.queued);
    expect(result.job.maxAttempts).toBe(PLATFORM_CONFIG.jobMaxAttempts);
    expect(result.job.idempotencyKey).toBe("submit-key-0001");
    expect(result.job.nextAttemptAt).toBeInstanceOf(Date);
    expect(state().jobs).toHaveLength(1);

    await flushAsync();
    expect(state().audits.map((audit) => audit.action)).toContain("job.enqueue");
    expect(state().audits[0]).toMatchObject({
      userId: "user-1",
      actorRole: "user",
      targetId: result.job.id,
      requestId: "req_test"
    });
  });

  it("returns the existing job for a repeated idempotency key without creating a second row", async () => {
    const first = await enqueueJobIdempotent({
      userId: "user-1",
      type: "pop-scene",
      payload: {},
      idempotencyKey: "submit-key-0002"
    });
    const second = await enqueueJobIdempotent({
      userId: "user-1",
      type: "pop-scene",
      payload: {},
      idempotencyKey: "submit-key-0002"
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(state().jobs).toHaveLength(1);
  });

  it("scopes idempotency keys per user", async () => {
    await enqueueJobIdempotent({
      userId: "user-1",
      type: "pop-scene",
      payload: {},
      idempotencyKey: "submit-key-0003"
    });
    const otherUser = await enqueueJobIdempotent({
      userId: "user-2",
      type: "pop-scene",
      payload: {},
      idempotencyKey: "submit-key-0003"
    });

    expect(otherUser.created).toBe(true);
    expect(state().jobs).toHaveLength(2);
  });

  it("returns the existing job even when the queue quota is already exhausted", async () => {
    const first = await enqueueJobIdempotent({
      userId: "user-1",
      type: "pop-scene",
      payload: {},
      idempotencyKey: "submit-key-0004"
    });
    for (let index = 0; index < PLATFORM_CONFIG.maxUserActiveJobs; index += 1) {
      state().jobs.push(buildJob({ userId: "user-1", status: JobStatus.queued }));
    }

    const repeated = await enqueueJobIdempotent({
      userId: "user-1",
      type: "pop-scene",
      payload: {},
      idempotencyKey: "submit-key-0004"
    });

    expect(repeated.created).toBe(false);
    expect(repeated.job.id).toBe(first.job.id);
  });

  it("rejects new submissions with 429 JOB_QUOTA_EXCEEDED when the user has too many active jobs", async () => {
    for (let index = 0; index < PLATFORM_CONFIG.maxUserActiveJobs; index += 1) {
      state().jobs.push(buildJob({ userId: "user-1", status: JobStatus.queued }));
    }

    await expect(
      enqueueJobIdempotent({ userId: "user-1", type: "pop-scene", payload: {} })
    ).rejects.toMatchObject({ status: 429, code: "JOB_QUOTA_EXCEEDED" });
    expect(state().jobs).toHaveLength(PLATFORM_CONFIG.maxUserActiveJobs);
  });

  it("recovers from a concurrent unique-constraint conflict by returning the original job", async () => {
    fake().hooks.beforeCreate = (data) => {
      state().jobs.push(
        buildJob({
          userId: data.userId as string,
          idempotencyKey: data.idempotencyKey as string
        })
      );
    };

    const result = await enqueueJobIdempotent({
      userId: "user-1",
      type: "pop-scene",
      payload: {},
      idempotencyKey: "submit-key-0005"
    });

    expect(result.created).toBe(false);
    expect(state().jobs).toHaveLength(1);
    expect(result.job.idempotencyKey).toBe("submit-key-0005");
  });

  it("keeps the legacy enqueueJob contract returning a bare job", async () => {
    const job = await enqueueJob({ userId: "user-1", type: "pop-scene", payload: {} });
    expect(job.id).toBeTypeOf("string");
    expect(job.status).toBe(JobStatus.queued);
  });

  it("keeps JobQuotaError compatible with the legacy http error mapper", () => {
    const error = new JobQuotaError("quota");
    expect(error.name).toBe("JobQuotaError");
    expect(error.status).toBe(429);
  });

  it("reads a job through the user-scoped accessor only", async () => {
    state().jobs.push(buildJob({ id: "job_100", userId: "user-2" }));
    await expect(getJobForUser("job_100", "user-1")).resolves.toBeNull();
    await expect(getJobForUser("job_100", "user-2")).resolves.toMatchObject({ id: "job_100" });
  });
});

describe("T41 exponential backoff", () => {
  it("computes capped exponential delays with jitter", () => {
    expect(computeBackoffDelayMs(1, () => 0)).toBe(PLATFORM_CONFIG.jobRetryBaseMs);
    expect(computeBackoffDelayMs(2, () => 0)).toBe(PLATFORM_CONFIG.jobRetryBaseMs * 2);
    expect(computeBackoffDelayMs(3, () => 0)).toBe(PLATFORM_CONFIG.jobRetryBaseMs * 4);
    expect(computeBackoffDelayMs(50, () => 0)).toBe(PLATFORM_CONFIG.jobRetryMaxMs);

    const jittered = computeBackoffDelayMs(1, () => 0.999);
    expect(jittered).toBeGreaterThanOrEqual(PLATFORM_CONFIG.jobRetryBaseMs);
    expect(jittered).toBeLessThanOrEqual(PLATFORM_CONFIG.jobRetryBaseMs + 1000);
  });

  it("requeues a failed job with nextAttemptAt in the future while attempts stay incremented", async () => {
    state().jobs.push(
      buildJob({
        id: "job_retry",
        userId: "user-1",
        status: JobStatus.running,
        attempts: 1,
        maxAttempts: 3,
        lockedAt: new Date(),
        lockedBy: "worker-1",
        startedAt: new Date(),
        progress: 40
      })
    );

    const before = Date.now();
    const job = await failJob("job_retry", "provider timeout");
    const after = Date.now();

    expect(job.status).toBe(JobStatus.queued);
    expect(job.attempts).toBe(1);
    expect(job.progress).toBe(0);
    expect(job.error).toBe("provider timeout");
    expect(job.lockedAt).toBeNull();
    expect(job.lockedBy).toBeNull();
    expect(job.startedAt).toBeNull();
    expect(job.nextAttemptAt).toBeInstanceOf(Date);
    const delay = (job.nextAttemptAt as Date).getTime();
    expect(delay).toBeGreaterThanOrEqual(before + PLATFORM_CONFIG.jobRetryBaseMs);
    expect(delay).toBeLessThanOrEqual(after + PLATFORM_CONFIG.jobRetryBaseMs + 1000);

    await flushAsync();
    const audit = state().audits.find((entry) => entry.action === "job.fail");
    expect(audit).toMatchObject({ targetId: "job_retry" });
    expect((audit?.metadata as { willRetry?: boolean })?.willRetry).toBe(true);
  });

  it("marks the job failed once attempts reach maxAttempts", async () => {
    state().jobs.push(
      buildJob({
        id: "job_exhausted",
        userId: "user-1",
        status: JobStatus.running,
        attempts: 3,
        maxAttempts: 3,
        lockedAt: new Date(),
        lockedBy: "worker-1"
      })
    );

    const job = await failJob("job_exhausted", "still broken");

    expect(job.status).toBe(JobStatus.failed);
    expect(job.finishedAt).toBeInstanceOf(Date);
    expect(job.nextAttemptAt).toBeNull();
    expect(job.lockedAt).toBeNull();

    await flushAsync();
    const audit = state().audits.find((entry) => entry.action === "job.fail");
    expect((audit?.metadata as { willRetry?: boolean })?.willRetry).toBe(false);
  });

  it("never requeues a job that was cancelled while running", async () => {
    state().jobs.push(
      buildJob({
        id: "job_cancelled_race",
        userId: "user-1",
        status: JobStatus.running,
        attempts: 1,
        cancelledAt: new Date(),
        lockedAt: new Date(),
        lockedBy: "worker-1"
      })
    );

    const job = await failJob("job_cancelled_race", "boom");
    expect(job.status).toBe(JobStatus.cancelled);
    expect(job.finishedAt).toBeInstanceOf(Date);
  });

  it("supports an explicit cancelled flag for worker checkpoints", async () => {
    state().jobs.push(
      buildJob({
        id: "job_checkpoint_cancel",
        userId: "user-1",
        status: JobStatus.running,
        attempts: 1,
        lockedAt: new Date(),
        lockedBy: "worker-1"
      })
    );

    const job = await failJob("job_checkpoint_cancel", "任务已取消。", { cancelled: true });
    expect(job.status).toBe(JobStatus.cancelled);
    expect(job.cancelledAt).toBeInstanceOf(Date);
    expect(job.nextAttemptAt).toBeNull();
  });

  it("does not clobber an already successful job", async () => {
    state().jobs.push(
      buildJob({ id: "job_done", userId: "user-1", status: JobStatus.succeeded, progress: 100 })
    );
    const job = await failJob("job_done", "late failure");
    expect(job.status).toBe(JobStatus.succeeded);
  });
});

describe("claimJobs", () => {
  it("claims queued candidates respecting nextAttemptAt and the lease columns", async () => {
    state().jobs.push(buildJob({ id: "job_claim", userId: "user-1", status: JobStatus.queued }));
    state().rawResults = [[{ id: "job_claim", userId: "user-1" }]];

    const claimed = await claimJobs("worker-1", 1);

    expect(claimed).toHaveLength(1);
    const job = jobById("job_claim");
    expect(job.status).toBe(JobStatus.running);
    expect(job.attempts).toBe(1);
    expect(job.lockedBy).toBe("worker-1");
    expect(job.lockedAt).toBeInstanceOf(Date);
    expect(job.startedAt).toBeInstanceOf(Date);
    expect(job.progress).toBe(5);
    expect(job.nextAttemptAt).toBeNull();

    const sql = state().rawQueries[0] ?? "";
    expect(sql).toContain("\"nextAttemptAt\"");
    expect(sql).toContain("SKIP LOCKED");
    expect(sql).toContain("status = 'queued'");
  });

  it("skips candidates whose user already has the maximum number of running jobs", async () => {
    for (let index = 0; index < PLATFORM_CONFIG.maxUserActiveJobs; index += 1) {
      state().jobs.push(buildJob({ userId: "user-1", status: JobStatus.running }));
    }
    state().jobs.push(buildJob({ id: "job_blocked", userId: "user-1", status: JobStatus.queued }));
    state().rawResults = [
      [{ id: "job_blocked", userId: "user-1" }],
      [{ id: "job_blocked", userId: "user-1" }]
    ];

    const claimed = await claimJobs("worker-1", 2);
    expect(claimed).toHaveLength(0);
    expect(jobById("job_blocked").status).toBe(JobStatus.queued);
  });

  it("reclaims stale leases before claiming new work", async () => {
    const stale = new Date(Date.now() - PLATFORM_CONFIG.jobLockMs - 5000);
    state().jobs.push(
      buildJob({
        id: "job_stale",
        userId: "user-1",
        status: JobStatus.running,
        attempts: 2,
        lockedAt: stale,
        lockedBy: "dead-worker"
      })
    );

    const claimed = await claimJobs("worker-1", 1);

    expect(claimed).toHaveLength(0);
    expect(jobById("job_stale").status).toBe(JobStatus.queued);
  });
});

describe("T42 stale lease reclaim", () => {
  it("requeues running jobs whose lease expired without touching attempts", async () => {
    const stale = new Date(Date.now() - PLATFORM_CONFIG.jobLockMs - 5000);
    state().jobs.push(
      buildJob({
        id: "job_lease_expired",
        userId: "user-1",
        status: JobStatus.running,
        attempts: 2,
        lockedAt: stale,
        lockedBy: "worker-dead",
        startedAt: new Date(Date.now() - 60_000)
      })
    );
    state().jobs.push(
      buildJob({
        id: "job_lease_fresh",
        userId: "user-2",
        status: JobStatus.running,
        attempts: 1,
        lockedAt: new Date(),
        lockedBy: "worker-live",
        startedAt: new Date()
      })
    );

    const reclaimed = await reclaimStaleJobs();

    expect(reclaimed).toBe(1);
    const job = jobById("job_lease_expired");
    expect(job.status).toBe(JobStatus.queued);
    expect(job.attempts).toBe(2);
    expect(job.lockedAt).toBeNull();
    expect(job.lockedBy).toBeNull();
    expect(job.startedAt).toBeNull();
    expect(jobById("job_lease_fresh").status).toBe(JobStatus.running);
    expect(shared.logger.warn).toHaveBeenCalledWith(
      "job.reclaim_stale",
      expect.objectContaining({ count: 1 })
    );
  });
});

describe("T43 cancellation", () => {
  it("cancels a queued job immediately", async () => {
    state().jobs.push(buildJob({ id: "job_queued", userId: "user-1", status: JobStatus.queued }));

    const { job, previousStatus } = await cancelJob("job_queued", "user-1");

    expect(previousStatus).toBe(JobStatus.queued);
    expect(job.status).toBe(JobStatus.cancelled);
    expect(job.cancelledAt).toBeInstanceOf(Date);
    expect(job.finishedAt).toBeInstanceOf(Date);
    expect(job.error).toBe("任务已取消。");
  });

  it("marks a running job as cancelled by timestamp and lets the worker finalise it", async () => {
    state().jobs.push(
      buildJob({
        id: "job_running",
        userId: "user-1",
        status: JobStatus.running,
        lockedAt: new Date(),
        lockedBy: "worker-1"
      })
    );

    const { job, previousStatus } = await cancelJob("job_running", "user-1");

    expect(previousStatus).toBe(JobStatus.running);
    expect(job.status).toBe(JobStatus.running);
    expect(job.cancelledAt).toBeInstanceOf(Date);
    expect(job.finishedAt).toBeNull();
  });

  it("rejects cancellation of terminal jobs with 409 JOB_NOT_CANCELLABLE", async () => {
    state().jobs.push(
      buildJob({ id: "job_succeeded", userId: "user-1", status: JobStatus.succeeded }),
      buildJob({ id: "job_failed", userId: "user-1", status: JobStatus.failed }),
      buildJob({ id: "job_already_cancelled", userId: "user-1", status: JobStatus.cancelled })
    );

    for (const id of ["job_succeeded", "job_failed", "job_already_cancelled"]) {
      await expect(cancelJob(id, "user-1")).rejects.toMatchObject({
        status: 409,
        code: "JOB_NOT_CANCELLABLE"
      });
    }
  });

  it("returns 404 for another user's job without leaking existence", async () => {
    state().jobs.push(buildJob({ id: "job_other", userId: "user-2", status: JobStatus.queued }));
    await expect(cancelJob("job_other", "user-1")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND"
    });
    expect(jobById("job_other").status).toBe(JobStatus.queued);

    await expect(cancelJob("missing", "user-1")).rejects.toMatchObject({ status: 404 });
  });
});

describe("assertJobNotCancelled checkpoints", () => {
  it("throws JobCancelledError for cancelled jobs and cancelledAt markers", async () => {
    state().jobs.push(
      buildJob({ id: "job_c1", userId: "user-1", status: JobStatus.cancelled }),
      buildJob({ id: "job_c2", userId: "user-1", status: JobStatus.running, cancelledAt: new Date() }),
      buildJob({ id: "job_ok", userId: "user-1", status: JobStatus.running })
    );

    await expect(assertJobNotCancelled("job_c1")).rejects.toBeInstanceOf(JobCancelledError);
    await expect(assertJobNotCancelled("job_c2")).rejects.toBeInstanceOf(JobCancelledError);
    await expect(assertJobNotCancelled("job_ok")).resolves.toBeUndefined();
    await expect(assertJobNotCancelled("job_missing")).rejects.toBeInstanceOf(JobCancelledError);
  });
});

describe("completeJob", () => {
  it("marks a running job succeeded, forces progress to 100 and writes audit", async () => {
    state().jobs.push(
      buildJob({
        id: "job_complete",
        userId: "user-1",
        status: JobStatus.running,
        progress: 90,
        lockedAt: new Date(),
        lockedBy: "worker-1"
      })
    );

    const job = await completeJob("job_complete", { url: "/generated/out.png" });

    expect(job.status).toBe(JobStatus.succeeded);
    expect(job.progress).toBe(100);
    expect(job.result).toEqual({ url: "/generated/out.png" });
    expect(job.finishedAt).toBeInstanceOf(Date);
    expect(job.lockedAt).toBeNull();

    await flushAsync();
    expect(state().audits.map((entry) => entry.action)).toContain("job.complete");
  });

  it("discards the result of a job cancelled while running", async () => {
    state().jobs.push(
      buildJob({
        id: "job_cancel_race",
        userId: "user-1",
        status: JobStatus.running,
        cancelledAt: new Date(),
        lockedAt: new Date(),
        lockedBy: "worker-1"
      })
    );

    const job = await completeJob("job_cancel_race", { url: "/generated/should-drop.png" });

    expect(job.status).toBe(JobStatus.cancelled);
    expect(job.result).toBeNull();
    expect(job.finishedAt).toBeInstanceOf(Date);
  });

  it("is idempotent for an already-succeeded job", async () => {
    state().jobs.push(
      buildJob({ id: "job_done2", userId: "user-1", status: JobStatus.succeeded, progress: 100 })
    );
    const job = await completeJob("job_done2", { ignored: true });
    expect(job.status).toBe(JobStatus.succeeded);
  });
});

describe("T45 list pagination / filtering", () => {
  it("normalises page sizes with a 20 default and 100 maximum", () => {
    expect(normalizeJobLimit(undefined)).toBe(JOBS_DEFAULT_PAGE_SIZE);
    expect(normalizeJobLimit(50)).toBe(50);
    expect(normalizeJobLimit(500)).toBe(JOBS_MAX_PAGE_SIZE);
    expect(normalizeJobLimit(0)).toBe(1);
  });

  it("returns the newest jobs first with a nextCursor when more rows exist", async () => {
    const seeded = Array.from({ length: 25 }, () => {
      const job = buildJob({ userId: "user-1" });
      state().jobs.push(job);
      return job;
    });
    const newestFirst = [...seeded].reverse();

    const firstPage = await listJobsForUser("user-1");
    expect(firstPage.jobs).toHaveLength(JOBS_DEFAULT_PAGE_SIZE);
    expect(firstPage.jobs.map((job) => job.id)).toEqual(
      newestFirst.slice(0, JOBS_DEFAULT_PAGE_SIZE).map((job) => job.id)
    );
    expect(firstPage.nextCursor).toBe(newestFirst[JOBS_DEFAULT_PAGE_SIZE - 1]?.id ?? null);

    const secondPage = await listJobsForUser("user-1", {
      cursor: firstPage.nextCursor ?? undefined
    });
    expect(secondPage.jobs.map((job) => job.id)).toEqual(
      newestFirst.slice(JOBS_DEFAULT_PAGE_SIZE).map((job) => job.id)
    );
    expect(secondPage.nextCursor).toBeNull();
  });

  it("filters by status and never leaks another user's jobs", async () => {
    state().jobs.push(
      buildJob({ userId: "user-1", status: JobStatus.succeeded }),
      buildJob({ userId: "user-1", status: JobStatus.queued }),
      buildJob({ userId: "user-2", status: JobStatus.succeeded })
    );

    const result = await listJobsForUser("user-1", { status: JobStatus.succeeded });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.status).toBe(JobStatus.succeeded);
    expect(state().jobs.filter((job) => job.userId === "user-2")).toHaveLength(1);
  });

  it("rejects unknown cursor ids instead of silently returning page one", async () => {
    await expect(listJobsForUser("user-1", { cursor: "missing-cursor" })).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR"
    });
  });
});

describe("T45 progress throttling", () => {
  it("writes only when progress moved at least 5 points or force is requested", async () => {
    state().jobs.push(buildJob({ id: "job_progress", userId: "user-1", status: JobStatus.running }));

    await updateJobProgress("job_progress", 10);
    expect(jobById("job_progress").progress).toBe(10);

    await updateJobProgress("job_progress", 12);
    expect(jobById("job_progress").progress).toBe(10);

    await updateJobProgress("job_progress", 15);
    expect(jobById("job_progress").progress).toBe(15);

    await updateJobProgress("job_progress", 18);
    expect(jobById("job_progress").progress).toBe(15);

    await updateJobProgress("job_progress", 18, { force: true });
    expect(jobById("job_progress").progress).toBe(18);
  });

  it("clamps out-of-range progress values", async () => {
    state().jobs.push(buildJob({ id: "job_clamp", userId: "user-1", status: JobStatus.running }));
    await updateJobProgress("job_clamp", 250);
    expect(jobById("job_clamp").progress).toBe(100);
    await updateJobProgress("job_clamp", -20, { force: true });
    expect(jobById("job_clamp").progress).toBe(0);
  });
});

describe("job approval", () => {
  it("approves a pending job and audits the action", async () => {
    const pending = buildJob({
      status: JobStatus.queued,
      requiresApproval: true,
      approvedAt: null
    });
    state().jobs.push(pending);

    const approved = await approveJob({
      jobId: pending.id,
      adminId: "admin-1",
      actorRole: "admin",
      note: "ok"
    });

    expect(approved.approvedAt).toBeInstanceOf(Date);
    expect(approved.approvedBy).toBe("admin-1");
    expect(approved.status).toBe(JobStatus.queued);
    expect(state().audits.at(-1)).toMatchObject({ action: "admin.job.approve" });
  });

  it("rejects a pending job and cancels it with a note", async () => {
    const pending = buildJob({
      status: JobStatus.queued,
      requiresApproval: true,
      approvedAt: null
    });
    state().jobs.push(pending);

    const rejected = await rejectJob({
      jobId: pending.id,
      adminId: "admin-1",
      actorRole: "admin",
      note: "缺少授权"
    });

    expect(rejected.status).toBe(JobStatus.cancelled);
    expect(rejected.error).toContain("缺少授权");
    expect(state().audits.at(-1)).toMatchObject({ action: "admin.job.reject" });
  });

  it("refuses to approve an already approved/running job", async () => {
    const running = buildJob({ status: JobStatus.running });
    state().jobs.push(running);
    await expect(
      approveJob({ jobId: running.id, adminId: "admin-1" })
    ).rejects.toMatchObject({ code: "JOB_NOT_APPROVABLE" });
  });

  it("worker claim SQL only selects approved jobs", async () => {
    await claimJobs("worker-1", 1, { reclaimStale: false });
    expect(state().rawQueries.some((sql) => sql.includes('"approvedAt" IS NOT NULL'))).toBe(true);
  });
});

describe("job retry", () => {
  it("clones a failed job into a new queued job and audits the retry", async () => {
    const original = buildJob({ status: JobStatus.failed, error: "boom", attempts: 3 });
    state().jobs.push(original);

    const retried = await retryJobForActor({
      jobId: original.id,
      actorUserId: original.userId,
      actorRole: "user"
    });

    expect(retried.id).not.toBe(original.id);
    expect(retried.status).toBe(JobStatus.queued);
    expect(retried.type).toBe(original.type);
    expect(retried.payload).toEqual(original.payload);
    expect(retried.idempotencyKey).toMatch(new RegExp(`^retry:${original.id}:`));
    expect(state().jobs).toHaveLength(2);
    expect(state().audits.at(-1)).toMatchObject({ action: "job.retry" });
  });

  it("allows an admin to retry another user's job", async () => {
    const original = buildJob({ userId: "owner-1", status: JobStatus.cancelled });
    state().jobs.push(original);

    const retried = await retryJobForActor({
      jobId: original.id,
      actorUserId: "admin-1",
      actorRole: "admin",
      isAdmin: true
    });
    expect(retried.userId).toBe("owner-1");
  });

  it("rejects other users' jobs with 404 and terminal jobs with 409", async () => {
    const original = buildJob({ userId: "owner-1", status: JobStatus.failed });
    state().jobs.push(original);

    await expect(
      retryJobForActor({ jobId: original.id, actorUserId: "intruder" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const succeeded = buildJob({ userId: "owner-1", status: JobStatus.succeeded });
    state().jobs.push(succeeded);
    await expect(
      retryJobForActor({ jobId: succeeded.id, actorUserId: "owner-1" })
    ).rejects.toMatchObject({ code: "JOB_NOT_RETRYABLE", status: 409 });
  });

  it("blocks retries once the monthly budget is exhausted", async () => {
    const original = buildJob({ status: JobStatus.failed });
    state().jobs.push(original);
    shared.assertWithinBudget.mockRejectedValueOnce(
      new (await import("@/src/platform/errors")).ApiError(
        429,
        "COST_BUDGET_EXCEEDED",
        "budget exhausted"
      )
    );

    await expect(
      retryJobForActor({ jobId: original.id, actorUserId: original.userId })
    ).rejects.toMatchObject({ code: "COST_BUDGET_EXCEEDED" });
    expect(state().jobs).toHaveLength(1);
    expect(state().audits.at(-1)).toMatchObject({ action: "job.blocked_budget" });
  });
});

describe("admin job cancellation", () => {
  it("cancels another user's queued job and audits the admin action", async () => {
    const job = buildJob({ userId: "owner-1" });
    state().jobs.push(job);

    const result = await cancelJobForAdmin({
      jobId: job.id,
      actorUserId: "admin-1",
      actorRole: "admin"
    });

    expect(result.previousStatus).toBe(JobStatus.queued);
    expect(result.job.status).toBe(JobStatus.cancelled);
    expect(state().audits.at(-1)).toMatchObject({ action: "admin.job.cancel" });
  });
});

describe("serializeJob", () => {
  it("emits ISO timestamps and keeps the legacy additive shape", () => {
    const cancelledAt = new Date("2026-01-02T03:04:05.000Z");
    const nextAttemptAt = new Date("2026-01-02T04:05:06.000Z");
    const payload = serializeJob(
      buildJob({
        id: "job_serialize",
        status: JobStatus.queued,
        cancelledAt,
        nextAttemptAt
      })
    );

    expect(payload).toMatchObject({
      id: "job_serialize",
      status: JobStatus.queued,
      attempts: 0
    });
    expect(payload.cancelledAt).toBe(cancelledAt.toISOString());
    expect(payload.nextAttemptAt).toBe(nextAttemptAt.toISOString());
    expect(payload.createdAt).toBeTypeOf("string");
  });
});
