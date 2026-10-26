// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  cancelJobForAdmin: vi.fn(),
  serializeJob: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/jobs", () => ({
  cancelJobForAdmin: mocks.cancelJobForAdmin,
  serializeJob: mocks.serializeJob
}));

import { setRateLimiter } from "@/src/platform/api";
import { MemoryRateLimiter } from "@/src/platform/rate-limit";
import { POST } from "./route";

function call(id = "job-1") {
  return POST(
    new Request(`http://localhost/api/admin/jobs/${id}/cancel`, { method: "POST" }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  setRateLimiter(new MemoryRateLimiter());
  mocks.getSessionUser.mockReset().mockResolvedValue({ id: "admin-1", role: "admin" });
  mocks.cancelJobForAdmin.mockReset().mockResolvedValue({
    job: { id: "job-1" },
    previousStatus: "queued"
  });
  mocks.serializeJob.mockReset().mockImplementation((job) => ({ id: job.id }));
});

describe("POST /api/admin/jobs/{id}/cancel", () => {
  it("cancels another user's job", async () => {
    const response = await call();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.previousStatus).toBe("queued");
    expect(mocks.cancelJobForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", actorUserId: "admin-1" })
    );
  });

  it("requires admin", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u", role: "user" });
    expect((await call()).status).toBe(403);
  });
});
