// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  rejectJob: vi.fn(),
  serializeJob: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/jobs", () => ({
  rejectJob: mocks.rejectJob,
  serializeJob: mocks.serializeJob
}));

import { setRateLimiter } from "@/src/platform/api";
import { MemoryRateLimiter } from "@/src/platform/rate-limit";
import { POST } from "./route";

function call(id = "job-1", body: unknown = {}) {
  return POST(
    new Request(`http://localhost/api/admin/jobs/${id}/reject`, {
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
  mocks.rejectJob.mockReset().mockResolvedValue({ id: "job-1" });
  mocks.serializeJob.mockReset().mockImplementation((job) => ({ id: job.id }));
});

describe("POST /api/admin/jobs/{id}/reject", () => {
  it("rejects a pending job with a note", async () => {
    const response = await call("job-1", { note: "缺少品牌授权" });
    expect(response.status).toBe(200);
    expect(mocks.rejectJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", note: "缺少品牌授权" })
    );
  });

  it("requires admin", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u", role: "user" });
    expect((await call()).status).toBe(403);
  });
});
