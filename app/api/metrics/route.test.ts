// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn() }));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));

import { recordHttpRequest, resetMetricsForTests } from "@/src/platform/metrics";
import { GET } from "./route";

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/metrics", { headers });
}

beforeEach(() => {
  resetMetricsForTests();
  mocks.getSessionUser.mockReset().mockResolvedValue({ id: "admin-1", role: "admin" });
  recordHttpRequest({ method: "GET", route: "/api/jobs", status: 200, durationMs: 5 });
});

describe("GET /api/metrics", () => {
  it("serves Prometheus text to an admin session", async () => {
    const response = await GET(request());
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(text).toContain("studio_http_requests_total");
  });

  it("rejects anonymous callers", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("FORBIDDEN");
  });

  it("rejects regular users", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u", role: "user" });
    expect((await GET(request())).status).toBe(401);
  });
});
