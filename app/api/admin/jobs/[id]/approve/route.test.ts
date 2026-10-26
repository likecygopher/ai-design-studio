// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  approveJob: vi.fn(),
  serializeJob: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/jobs", () => ({
  approveJob: mocks.approveJob,
  serializeJob: mocks.serializeJob
}));

import { setRateLimiter } from "@/src/platform/api";
import { MemoryRateLimiter } from "@/src/platform/rate-limit";
import { POST } from "./route";

function call(id = "job-1", body: unknown = {}) {
  return POST(
    new Request(`http://localhost/api/admin/jobs/${id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  setRateLimiter(new MemoryRateLimiter());
  mocks.getSessionUser.mockReset().mockResolvedValue({ id: "admin-1", role: "admin" });
  mocks.approveJob.mockReset().mockResolvedValue({ id: "job-1" });
  mocks.serializeJob.mockReset().mockImplementation((job) => ({ id: job.id }));
});

describe("POST /api/admin/jobs/{id}/approve", () => {
  it("approves a pending job with an optional note", async () => {
    const response = await call("job-1", { note: "ok" });
    expect(response.status).toBe(200);
    expect(mocks.approveJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", adminId: "admin-1", note: "ok" })
    );
  });

  it("requires admin", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u", role: "user" });
    expect((await call()).status).toBe(403);
  });
});
