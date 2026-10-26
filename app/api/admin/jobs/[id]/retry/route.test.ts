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

function call(id = "job-1") {
  return POST(
    new Request(`http://localhost/api/admin/jobs/${id}/retry`, { method: "POST" }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  setRateLimiter(new MemoryRateLimiter());
  mocks.getSessionUser.mockReset().mockResolvedValue({ id: "admin-1", role: "admin" });
  mocks.retryJobForActor.mockReset().mockResolvedValue({ id: "job-new" });
  mocks.serializeJob.mockReset().mockImplementation((job) => ({ id: job.id }));
});

describe("POST /api/admin/jobs/{id}/retry", () => {
  it("requires admin", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u", role: "user" });
    expect((await call()).status).toBe(403);
    expect(mocks.retryJobForActor).not.toHaveBeenCalled();
  });

  it("retries as admin for another user's job", async () => {
    const response = await call();
    expect(response.status).toBe(201);
    expect(mocks.retryJobForActor).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", isAdmin: true })
    );
  });
});
