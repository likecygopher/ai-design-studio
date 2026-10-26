// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  retryJobForActor: vi.fn(),
  serializeJob: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/jobs", () => ({
  retryJobForActor: mocks.retryJobForActor,
  serializeJob: mocks.serializeJob
}));

import { setRateLimiter } from "@/src/platform/api";
import { MemoryRateLimiter } from "@/src/platform/rate-limit";
import { POST } from "./route";

const session = { id: "user-1", role: "user" };

function call(id = "job-1") {
  return POST(
    new Request(`http://localhost/api/jobs/${id}/retry`, { method: "POST" }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  setRateLimiter(new MemoryRateLimiter());
  mocks.getSessionUser.mockReset().mockResolvedValue(session);
  mocks.retryJobForActor.mockReset().mockResolvedValue({ id: "job-new" });
  mocks.serializeJob.mockReset().mockImplementation((job) => ({ id: job.id, status: "queued" }));
});

describe("POST /api/jobs/{id}/retry", () => {
  it("requires auth", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mocks.retryJobForActor).not.toHaveBeenCalled();
  });

  it("returns the new job with 201 and passes actor context", async () => {
    const response = await call();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.job).toMatchObject({ id: "job-new" });
    expect(mocks.retryJobForActor).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", actorUserId: "user-1" })
    );
  });

  it("maps domain errors to the API contract", async () => {
    const { ApiError } = await import("@/src/platform/errors");
    mocks.retryJobForActor.mockRejectedValueOnce(
      new ApiError(409, "JOB_NOT_RETRYABLE", "not retryable")
    );
    const response = await call();
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("JOB_NOT_RETRYABLE");
  });
});
