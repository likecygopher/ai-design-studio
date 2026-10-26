import { randomUUID } from "node:crypto";
import { JobStatus, type GenerationJob, type Prisma } from "@prisma/client";
import { PLATFORM_CONFIG } from "@/src/platform/config";
import { prisma } from "@/src/platform/db";
import { getActiveOrganizationId } from "@/src/platform/organizations";
import { recordAudit } from "@/src/platform/audit";
import { logger } from "@/src/platform/logger";
import { assertWithinBudget } from "@/src/platform/quotas";
import { recordBudgetBlocked, recordJobEnqueued } from "@/src/platform/metrics";
import {
  ApiError,
  ConflictError,
  JobCancelledError,
  NotFoundError,
  ValidationError
} from "@/src/platform/errors";

/**
 * Job queue semantics (design.md §6, spec R4):
 * - `enqueue` is idempotent per (userId, idempotencyKey) and quota-capped.
 * - `claim` is lease-based with `FOR UPDATE SKIP LOCKED` and honours
 *   `nextAttemptAt` so backoff delays are actually respected.
 * - `fail` requeues with exponential backoff until `maxAttempts` is reached.
 * - `reclaim` returns expired `running` leases to `queued` without counting an
 *   extra attempt (a crashed worker must not burn retries for the user).
 * - `cancel` is user-scoped; running jobs are finalised by the worker at its
 *   next checkpoint so a mid-flight result is never persisted.
 */

export const JOB_TYPES = [
  "style-transfer",
  "sku-replacement",
  "pop-scene",
  "white-background",
  "phone-standardize",
  "localize",
  "icon-design",
  "product-video"
] as const;

export type JobType = (typeof JOB_TYPES)[number];

/**
 * @deprecated kept for backward compatibility: `src/platform/http.ts` maps this
 * legacy error name to `429 JOB_QUOTA_EXCEEDED`. New code throws
 * `ApiError(429, "JOB_QUOTA_EXCEEDED")` instead.
 */
export class JobQuotaError extends Error {
  status = 429;

  constructor(message: string) {
    super(message);
    this.name = "JobQuotaError";
  }
}

/** Raised by the user-scoped cancel endpoint when a job already finished. */
export const JOB_NOT_CANCELLABLE = "JOB_NOT_CANCELLABLE";

export const JOBS_DEFAULT_PAGE_SIZE = 20;
export const JOBS_MAX_PAGE_SIZE = 100;
/** Progress writes are throttled unless the delta reaches this many points. */
export const PROGRESS_MIN_DELTA = 5;
/** Bounds the in-memory throttle cache for long-lived workers. */
const PROGRESS_CACHE_LIMIT = 10_000;

export type EnqueueJobInput = {
  userId: string;
  type: JobType;
  payload: Prisma.InputJsonValue;
  priority?: number;
  maxAttempts?: number;
  /** Optional client-generated key enabling safe retries of a submit request. */
  idempotencyKey?: string | null;
  actorRole?: string | null;
  ip?: string;
  requestId?: string;
};

export type EnqueueJobResult = {
  job: GenerationJob;
  /** false when an existing job was returned for a repeated idempotency key. */
  created: boolean;
};

export type ListJobsOptions = {
  status?: JobStatus;
  limit?: number;
  cursor?: string;
};

export type ListJobsResult = {
  jobs: GenerationJob[];
  nextCursor: string | null;
};

export type ClaimJobsOptions = {
  /** Defaults to true: reclaim expired leases before every claim round. */
  reclaimStale?: boolean;
};

export type CancelJobResult = {
  job: GenerationJob;
  previousStatus: JobStatus;
};

/** True when `error` is a Prisma unique-constraint violation. */
function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "P2002"
  );
}

function normalizeIdempotencyKey(key: string | null | undefined): string | null {
  const trimmed = key?.trim();
  return trimmed ? trimmed : null;
}

/** Count queued + running jobs for a user (the quota denominator). */
export async function countActiveJobs(userId: string): Promise<number> {
  return prisma.generationJob.count({
    where: {
      userId,
      status: { in: [JobStatus.queued, JobStatus.running] }
    }
  });
}

async function resolveMaxActiveJobs(userId: string): Promise<number> {
  try {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: { select: { maxActiveJobs: true } } }
    });
    const planLimit = row?.plan?.maxActiveJobs;
    return typeof planLimit === "number" && planLimit > 0
      ? planLimit
      : PLATFORM_CONFIG.maxUserActiveJobs;
  } catch {
    return PLATFORM_CONFIG.maxUserActiveJobs;
  }
}

async function assertUserJobQuota(userId: string): Promise<void> {
  const activeCount = await countActiveJobs(userId);
  const limit = await resolveMaxActiveJobs(userId);
  if (activeCount >= limit) {
    throw new ApiError(
      429,
      "JOB_QUOTA_EXCEEDED",
      `当前账号已有 ${activeCount} 个进行中的任务，最多同时 ${limit} 个。请等待完成后再提交。`
    );
  }
}

async function resolveApprovalRequirement(userId: string): Promise<boolean> {
  if (PLATFORM_CONFIG.jobRequireApproval) {
    return true;
  }
  try {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { requiresJobApproval: true }
    });
    return Boolean(row?.requiresJobApproval);
  } catch {
    return false;
  }
}

/**
 * Idempotent submit. Returns the previously-created job for a repeated
 * (userId, idempotencyKey) pair and recovers from the concurrent-request race
 * through the database unique constraint.
 */
export async function enqueueJobIdempotent(input: EnqueueJobInput): Promise<EnqueueJobResult> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);

  if (idempotencyKey) {
    const existing = await prisma.generationJob.findFirst({
      where: { userId: input.userId, idempotencyKey }
    });
    if (existing) {
      return { job: existing, created: false };
    }
  }

  try {
    await assertWithinBudget(input.userId);
  } catch (error) {
    if (error instanceof ApiError && error.code === "COST_BUDGET_EXCEEDED") {
      recordBudgetBlocked();
      void recordAudit({
        userId: input.userId,
        actorRole: input.actorRole ?? null,
        action: "job.blocked_budget",
        targetType: "user",
        targetId: input.userId,
        metadata: { type: input.type },
        ip: input.ip,
        requestId: input.requestId
      });
    }
    throw error;
  }

  await assertUserJobQuota(input.userId);

  const requiresApproval = await resolveApprovalRequirement(input.userId);
  const organizationId = getActiveOrganizationId(input.userId);

  try {
    const job = await prisma.generationJob.create({
      data: {
        userId: input.userId,
        organizationId,
        type: input.type,
        payload: input.payload,
        priority: input.priority ?? 0,
        status: JobStatus.queued,
        maxAttempts: input.maxAttempts ?? PLATFORM_CONFIG.jobMaxAttempts,
        idempotencyKey,
        nextAttemptAt: new Date(),
        requiresApproval,
        approvedAt: requiresApproval ? null : new Date()
      }
    });

    recordJobEnqueued(input.type);
    void recordAudit({
      userId: input.userId,
      actorRole: input.actorRole ?? null,
      action: "job.enqueue",
      targetType: "GenerationJob",
      targetId: job.id,
      metadata: {
        type: job.type,
        idempotencyKey: idempotencyKey ?? undefined
      },
      ip: input.ip,
      requestId: input.requestId
    });

    return { job, created: true };
  } catch (error) {
    // Concurrent duplicate submit: the loser of the race returns the winner's job.
    if (idempotencyKey && isUniqueConstraintError(error)) {
      const existing = await prisma.generationJob.findFirst({
        where: { userId: input.userId, idempotencyKey }
      });
      if (existing) {
        return { job: existing, created: false };
      }
    }
    throw error;
  }
}

/** Backward-compatible entry point: returns the job, ignoring the `created` flag. */
export async function enqueueJob(input: EnqueueJobInput): Promise<GenerationJob> {
  return (await enqueueJobIdempotent(input)).job;
}

export async function getJobForUser(
  jobId: string,
  userId: string
): Promise<GenerationJob | null> {
  const organizationId = getActiveOrganizationId(userId);
  return prisma.generationJob.findFirst({
    where: { id: jobId, OR: [{ organizationId }, { userId }] }
  });
}

export function normalizeJobLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return JOBS_DEFAULT_PAGE_SIZE;
  }
  return Math.min(JOBS_MAX_PAGE_SIZE, Math.max(1, Math.floor(limit)));
}

/** Cursor pagination (newest first) scoped to the calling user. */
export async function listJobsForUser(
  userId: string,
  options: ListJobsOptions = {}
): Promise<ListJobsResult> {
  const limit = normalizeJobLimit(options.limit);

  const organizationId = getActiveOrganizationId(userId);
  if (options.cursor) {
    const cursorJob = await prisma.generationJob.findFirst({
      where: { id: options.cursor, OR: [{ organizationId }, { userId }] },
      select: { id: true }
    });
    if (!cursorJob) {
      throw new ValidationError("分页游标无效。", {
        issues: [{ path: "cursor", message: "未知的任务游标" }]
      });
    }
  }

  const where: Prisma.GenerationJobWhereInput = {
    OR: [{ organizationId }, { userId }],
    ...(options.status ? { status: options.status } : {})
  };

  const rows = await prisma.generationJob.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {})
  });

  const hasMore = rows.length > limit;
  const jobs = hasMore ? rows.slice(0, limit) : rows;

  return {
    jobs,
    nextCursor: hasMore ? jobs.at(-1)?.id ?? null : null
  };
}

export function serializeJob(job: GenerationJob) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
    attempts: job.attempts,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    // Additive fields for the job centre (existing clients ignore them).
    nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
    cancelledAt: job.cancelledAt?.toISOString() ?? null,
    requiresApproval: job.requiresApproval,
    approvedAt: job.approvedAt?.toISOString() ?? null,
  };
}

/**
 * Return jobs whose lease expired (worker crashed / was killed) to the queue.
 * `attempts` is intentionally left untouched: the user should not pay for a
 * process crash. Returns the number of reclaimed jobs.
 */
export async function reclaimStaleJobs(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PLATFORM_CONFIG.jobLockMs);
  const result = await prisma.generationJob.updateMany({
    where: {
      status: JobStatus.running,
      lockedAt: { lt: cutoff }
    },
    data: {
      status: JobStatus.queued,
      lockedAt: null,
      lockedBy: null,
      startedAt: null
    }
  });

  if (result.count > 0) {
    logger.warn("job.reclaim_stale", {
      count: result.count,
      cutoff: cutoff.toISOString()
    });
  }

  return result.count;
}

/**
 * Claim up to `limit` queued jobs with SKIP LOCKED semantics via a transaction.
 * Respects `nextAttemptAt` (backoff) and per-user active running caps.
 */
export async function claimJobs(
  workerId: string,
  limit: number,
  options: ClaimJobsOptions = {}
): Promise<GenerationJob[]> {
  if (limit <= 0) {
    return [];
  }

  if (options.reclaimStale !== false) {
    // Every poll starts by reclaiming expired leases (spec R4.3).
    await reclaimStaleJobs();
  }

  const claimed: GenerationJob[] = [];

  for (let i = 0; i < limit; i += 1) {
    const job = await prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<Array<{ id: string; userId: string }>>`
        SELECT id, "userId"
        FROM "GenerationJob"
        WHERE status = 'queued'
          AND "approvedAt" IS NOT NULL
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
        ORDER BY priority DESC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 20
      `;

      for (const candidate of candidates) {
        const runningForUser = await tx.generationJob.count({
          where: {
            userId: candidate.userId,
            status: JobStatus.running
          }
        });
        if (runningForUser >= PLATFORM_CONFIG.maxUserActiveJobs) {
          continue;
        }

        const now = new Date();
        return tx.generationJob.update({
          where: { id: candidate.id },
          data: {
            status: JobStatus.running,
            lockedAt: now,
            lockedBy: workerId,
            startedAt: now,
            attempts: { increment: 1 },
            progress: 5,
            nextAttemptAt: null
          }
        });
      }

      return null;
    });

    if (!job) {
      break;
    }
    claimed.push(job);
  }

  return claimed;
}

/** In-memory last-written progress per job, so worker updates stay cheap. */
const progressWriteCache = new Map<string, number>();

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(progress)));
}

/**
 * Throttled progress write (spec R4.7): persist only when the rounded value
 * moved at least `PROGRESS_MIN_DELTA` points, unless `force` is set.
 */
export async function updateJobProgress(
  jobId: string,
  progress: number,
  options: { force?: boolean } = {}
): Promise<void> {
  const value = clampProgress(progress);
  const lastWritten = progressWriteCache.get(jobId);

  if (!options.force && lastWritten !== undefined && Math.abs(value - lastWritten) < PROGRESS_MIN_DELTA) {
    return;
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: { progress: value }
  });
  rememberProgress(jobId, value);
}

function rememberProgress(jobId: string, value: number): void {
  progressWriteCache.set(jobId, value);
  if (progressWriteCache.size > PROGRESS_CACHE_LIMIT) {
    progressWriteCache.clear();
  }
}

function forgetProgress(jobId: string): void {
  progressWriteCache.delete(jobId);
}

/** Finalise a cancellation requested through the API / worker control flow. */
async function finalizeCancelledJob(
  jobId: string,
  existing?: GenerationJob
): Promise<GenerationJob> {
  const current =
    existing ??
    (await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } }));

  if (
    current.status === JobStatus.cancelled &&
    current.lockedAt === null &&
    current.finishedAt !== null
  ) {
    return current;
  }

  const now = new Date();
  const job = await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.cancelled,
      cancelledAt: current.cancelledAt ?? now,
      finishedAt: current.finishedAt ?? now,
      lockedAt: null,
      lockedBy: null,
      nextAttemptAt: null,
      error: current.error ?? "任务已取消。"
    }
  });
  forgetProgress(jobId);
  return job;
}

export async function completeJob(
  jobId: string,
  result: Prisma.InputJsonValue
): Promise<GenerationJob> {
  const current = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });

  // A cancellation may have landed while the last handler stage was running.
  if (current.status === JobStatus.cancelled || current.cancelledAt) {
    return finalizeCancelledJob(jobId, current);
  }
  if (current.status === JobStatus.succeeded || current.status === JobStatus.failed) {
    return current;
  }

  const job = await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      progress: 100,
      result,
      error: null,
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      nextAttemptAt: null
    }
  });
  forgetProgress(jobId);

  void recordAudit({
    userId: job.userId,
    action: "job.complete",
    targetType: "GenerationJob",
    targetId: jobId,
    metadata: { type: job.type, attempts: job.attempts }
  });

  return job;
}

export type FailJobOptions = {
  /** Worker cancellation checkpoint: finalise as cancelled instead of retrying. */
  cancelled?: boolean;
};

/**
 * Exponential backoff delay: `min(max, base * 2^(attempts-1)) + jitter(0..1000)`.
 * `random` is injectable for deterministic tests.
 */
export function computeBackoffDelayMs(attempts: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, Math.floor(attempts) - 1);
  const exponential = Math.min(
    PLATFORM_CONFIG.jobRetryMaxMs,
    PLATFORM_CONFIG.jobRetryBaseMs * 2 ** exponent
  );
  const jitter = Math.floor(random() * 1000);
  return exponential + jitter;
}

export async function failJob(
  jobId: string,
  reason: string,
  options: FailJobOptions = {}
): Promise<GenerationJob> {
  const current = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });

  if (options.cancelled || current.status === JobStatus.cancelled || current.cancelledAt) {
    return finalizeCancelledJob(jobId, current);
  }
  if (current.status === JobStatus.succeeded || current.status === JobStatus.failed) {
    return current;
  }

  const shouldRetry = current.attempts < current.maxAttempts;

  if (shouldRetry) {
    const delayMs = computeBackoffDelayMs(current.attempts);
    const job = await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: JobStatus.queued,
        progress: 0,
        error: reason,
        lockedAt: null,
        lockedBy: null,
        startedAt: null,
        nextAttemptAt: new Date(Date.now() + delayMs)
      }
    });
    forgetProgress(jobId);
    logger.warn("job.retry_scheduled", {
      jobId,
      userId: current.userId,
      attempts: current.attempts,
      maxAttempts: current.maxAttempts,
      delayMs
    });

    void recordAudit({
      userId: current.userId,
      action: "job.fail",
      targetType: "GenerationJob",
      targetId: jobId,
      metadata: {
        type: current.type,
        attempts: current.attempts,
        maxAttempts: current.maxAttempts,
        willRetry: true,
        delayMs
      }
    });

    return job;
  }

  const job = await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.failed,
      error: reason,
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      nextAttemptAt: null
    }
  });
  forgetProgress(jobId);
  logger.error("job.failed", undefined, {
    jobId,
    userId: current.userId,
    attempts: current.attempts,
    maxAttempts: current.maxAttempts
  });

  void recordAudit({
    userId: current.userId,
    action: "job.fail",
    targetType: "GenerationJob",
    targetId: jobId,
    metadata: {
      type: current.type,
      attempts: current.attempts,
      maxAttempts: current.maxAttempts,
      willRetry: false
    }
  });

  return job;
}

export const JOB_NOT_APPROVABLE = "JOB_NOT_APPROVABLE";

/** Admin approval: a pending queued job becomes claimable by workers. */
export async function approveJob(input: {
  jobId: string;
  adminId: string;
  actorRole?: string | null;
  note?: string;
  ip?: string;
  requestId?: string;
}): Promise<GenerationJob> {
  const job = await prisma.generationJob.findUnique({ where: { id: input.jobId } });
  if (!job) {
    throw new NotFoundError("任务不存在。");
  }
  if (job.status !== JobStatus.queued || job.approvedAt || !job.requiresApproval) {
    throw new ConflictError("该任务当前不需要或不能审批。", JOB_NOT_APPROVABLE);
  }
  const updated = await prisma.generationJob.update({
    where: { id: input.jobId },
    data: {
      approvedAt: new Date(),
      approvedBy: input.adminId,
      approvalNote: input.note?.trim() || null,
      nextAttemptAt: new Date()
    }
  });
  void recordAudit({
    userId: input.adminId,
    actorRole: input.actorRole ?? null,
    action: "admin.job.approve",
    targetType: "GenerationJob",
    targetId: input.jobId,
    metadata: { ownerId: job.userId, type: job.type, note: input.note ?? undefined },
    ip: input.ip,
    requestId: input.requestId
  });
  return updated;
}

/** Admin rejection: cancel the pending job with an approval note. */
export async function rejectJob(input: {
  jobId: string;
  adminId: string;
  actorRole?: string | null;
  note?: string;
  ip?: string;
  requestId?: string;
}): Promise<GenerationJob> {
  const job = await prisma.generationJob.findUnique({ where: { id: input.jobId } });
  if (!job) {
    throw new NotFoundError("任务不存在。");
  }
  if (job.status !== JobStatus.queued || job.approvedAt || !job.requiresApproval) {
    throw new ConflictError("该任务当前不需要或不能审批。", JOB_NOT_APPROVABLE);
  }
  const updated = await prisma.generationJob.update({
    where: { id: input.jobId },
    data: {
      status: JobStatus.cancelled,
      cancelledAt: new Date(),
      finishedAt: new Date(),
      error: input.note?.trim() ? `审批未通过：${input.note.trim()}` : "审批未通过。",
      approvalNote: input.note?.trim() || null,
      lockedAt: null,
      lockedBy: null,
      nextAttemptAt: null
    }
  });
  void recordAudit({
    userId: input.adminId,
    actorRole: input.actorRole ?? null,
    action: "admin.job.reject",
    targetType: "GenerationJob",
    targetId: input.jobId,
    metadata: { ownerId: job.userId, type: job.type, note: input.note ?? undefined },
    ip: input.ip,
    requestId: input.requestId
  });
  return updated;
}

export type RetryJobInput = {
  jobId: string;
  actorUserId: string;
  actorRole?: string | null;
  /** Admins may retry any user's job; normal users only their own. */
  isAdmin?: boolean;
  ip?: string;
  requestId?: string;
};

/** Retry a failed/cancelled job by cloning its type and payload into a new job. */
export async function retryJobForActor(input: RetryJobInput): Promise<GenerationJob> {
  const original = await prisma.generationJob.findUnique({ where: { id: input.jobId } });
  if (!original) {
    throw new NotFoundError("任务不存在。");
  }
  if (!input.isAdmin && original.userId !== input.actorUserId) {
    throw new NotFoundError("任务不存在。");
  }
  if (original.status !== JobStatus.failed && original.status !== JobStatus.cancelled) {
    throw new ConflictError("只有失败或已取消的任务可以重试。", "JOB_NOT_RETRYABLE");
  }

  const { job } = await enqueueJobIdempotent({
    userId: original.userId,
    type: original.type as JobType,
    payload: original.payload as Prisma.InputJsonValue,
    priority: original.priority,
    idempotencyKey: `retry:${original.id}:${randomUUID()}`,
    actorRole: input.actorRole ?? null,
    ip: input.ip,
    requestId: input.requestId
  });

  void recordAudit({
    userId: input.actorUserId,
    actorRole: input.actorRole ?? null,
    action: "job.retry",
    targetType: "GenerationJob",
    targetId: job.id,
    metadata: { originalJobId: original.id, type: original.type },
    ip: input.ip,
    requestId: input.requestId
  });

  return job;
}

/** Admin cancellation for a job owned by another account. */
export async function cancelJobForAdmin(input: {
  jobId: string;
  actorUserId: string;
  actorRole?: string | null;
  ip?: string;
  requestId?: string;
}): Promise<CancelJobResult> {
  const job = await prisma.generationJob.findUnique({ where: { id: input.jobId } });
  if (!job) {
    throw new NotFoundError("任务不存在。");
  }

  const result = await cancelJob(input.jobId, job.userId);

  void recordAudit({
    userId: input.actorUserId,
    actorRole: input.actorRole ?? null,
    action: "admin.job.cancel",
    targetType: "GenerationJob",
    targetId: input.jobId,
    metadata: { ownerId: job.userId, previousStatus: result.previousStatus },
    ip: input.ip,
    requestId: input.requestId
  });

  return result;
}

/**
 * User-scoped cancellation.
 * - queued → cancelled immediately
 * - running → `cancelledAt` marker; the worker discards the result at its next
 *   checkpoint and finalises the job
 * - terminal → 409 JOB_NOT_CANCELLABLE
 * - not owned by the caller → 404 (never reveal existence)
 */
export async function cancelJob(jobId: string, userId: string): Promise<CancelJobResult> {
  const existing = await prisma.generationJob.findFirst({
    where: { id: jobId, userId }
  });
  if (!existing) {
    throw new NotFoundError("任务不存在。");
  }

  if (existing.status === JobStatus.queued) {
    const result = await prisma.generationJob.updateMany({
      where: { id: jobId, userId, status: JobStatus.queued },
      data: {
        status: JobStatus.cancelled,
        cancelledAt: existing.cancelledAt ?? new Date(),
        finishedAt: new Date(),
        error: existing.error ?? "任务已取消。",
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: null
      }
    });
    if (result.count > 0) {
      forgetProgress(jobId);
      const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
      return { job, previousStatus: JobStatus.queued };
    }
  }

  if (existing.status === JobStatus.running || existing.status === JobStatus.queued) {
    // Either it was running, or it raced from queued → running between reads.
    const result = await prisma.generationJob.updateMany({
      where: { id: jobId, userId, status: JobStatus.running },
      data: { cancelledAt: existing.cancelledAt ?? new Date() }
    });
    if (result.count > 0) {
      const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
      return { job, previousStatus: JobStatus.running };
    }
  }

  throw new ConflictError("任务已结束，无法取消。", JOB_NOT_CANCELLABLE);
}

/**
 * Worker checkpoint used between expensive stages. Throws `JobCancelledError`
 * so the worker can stop early and discard partial results.
 */
export async function assertJobNotCancelled(jobId: string): Promise<void> {
  const current = await prisma.generationJob.findUnique({
    where: { id: jobId },
    select: { status: true, cancelledAt: true }
  });

  if (!current || current.status === JobStatus.cancelled || current.cancelledAt) {
    throw new JobCancelledError();
  }
}
