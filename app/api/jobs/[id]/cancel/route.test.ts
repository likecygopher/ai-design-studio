// @vitest-environment node
/**
 * Route-level tests for `POST /api/jobs/[id]/cancel` (SDD T43):
 * queued → cancelled, running → cancelledAt marker, terminal → 409, cross-user → 404.
 */
import { JobStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({
  prisma: null as unknown,
  sessionUser: null as { id: string; role: string } | null,
  getSessionUser: vi.fn(),
  recordAudit: vi.fn()
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

vi.mock("@/src/platform/auth", () => ({
  getSessionUser: shared.getSessionUser
}));

vi.mock("@/src/platform/audit", () => ({
  recordAudit: shared.recordAudit
}));

vi.mock("@/src/platform/logger", () => {
  const noop = () => undefined;
  const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  return { logger, createLogger: () => logger };
});

import { setRateLimiter } from "@/src/platform/api";
import { MemoryRateLimiter } from "@/src/platform/rate-limit";
import {
  buildJob,
  createFakePrisma,
  flushAsync,
  type FakePrisma
} from "@/src/platform/jobs.test-utils";
import { POST } from "./route";

function fake(): FakePrisma {
  return shared.prisma as FakePrisma;
}

function state() {
  return fake().state;
}

function cancelRequest(jobId: string): Promise<Response> {
  return POST(new Request(`http://localhost/api/jobs/${jobId}/cancel`, { method: "POST" }), {
    params: Promise.resolve({ id: jobId })
  });
}

beforeEach(() => {
  shared.prisma = createFakePrisma();
  shared.sessionUser = { id: "user-1", role: "user" };
  shared.getSessionUser.mockReset().mockImplementation(async () => shared.sessionUser);
  shared.recordAudit.mockReset().mockResolvedValue(undefined);
  setRateLimiter(new MemoryRateLimiter());
});

describe("POST /api/jobs/[id]/cancel", () => {
  it("cancels a queued job and writes a cancel audit entry", async () => {
    state().jobs.push(buildJob({ id: "job_queued", userId: "user-1", status: JobStatus.queued }));

    const response = await cancelRequest("job_queued");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.job).toMatchObject({ id: "job_queued", status: JobStatus.cancelled });
    expect(body.job.cancelledAt).toBeTypeOf("string");
    expect(state().jobs[0]?.status).toBe(JobStatus.cancelled);

    await flushAsync();
    expect(shared.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "job.cancel",
        targetId: "job_queued",
        userId: "user-1"
      })
    );
  });

  it("marks a running job as cancelled by timestamp without finalising it", async () => {
    state().jobs.push(
      buildJob({
        id: "job_running",
        userId: "user-1",
        status: JobStatus.running,
        lockedAt: new Date(),
        lockedBy: "worker-1"
      })
    );

    const response = await cancelRequest("job_running");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.job.status).toBe(JobStatus.running);
    expect(body.job.cancelledAt).toBeTypeOf("string");
  });

  it("returns 409 JOB_NOT_CANCELLABLE for jobs that already finished", async () => {
    state().jobs.push(
      buildJob({ id: "job_done", userId: "user-1", status: JobStatus.succeeded }),
      buildJob({ id: "job_failed", userId: "user-1", status: JobStatus.failed }),
      buildJob({ id: "job_cancelled", userId: "user-1", status: JobStatus.cancelled })
    );

    for (const jobId of ["job_done", "job_failed", "job_cancelled"]) {
      const response = await cancelRequest(jobId);
      expect(response.status, jobId).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "JOB_NOT_CANCELLABLE" });
    }
  });

  it("returns 404 for another user's job and for unknown ids", async () => {
    state().jobs.push(buildJob({ id: "job_other", userId: "user-2", status: JobStatus.queued }));

    const foreign = await cancelRequest("job_other");
    expect(foreign.status).toBe(404);
    await expect(foreign.json()).resolves.toMatchObject({ code: "NOT_FOUND" });
    expect(state().jobs[0]?.status).toBe(JobStatus.queued);

    const missing = await cancelRequest("does-not-exist");
    expect(missing.status).toBe(404);
  });

  it("returns 401 AUTH_REQUIRED without a session", async () => {
    state().jobs.push(buildJob({ id: "job_queued", userId: "user-1", status: JobStatus.queued }));
    shared.sessionUser = null;

    const response = await cancelRequest("job_queued");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(state().jobs[0]?.status).toBe(JobStatus.queued);
  });
});
