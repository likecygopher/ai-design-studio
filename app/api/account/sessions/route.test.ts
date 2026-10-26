// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  list: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/sessions", () => ({ listAuthSessions: mocks.list }));

import { setRateLimiter } from "@/src/platform/api";
import { MemoryRateLimiter } from "@/src/platform/rate-limit";
import { GET } from "./route";

beforeEach(() => {
  setRateLimiter(new MemoryRateLimiter());
  mocks.getSessionUser.mockReset().mockResolvedValue({
    id: "user-1",
    role: "user",
    sessionId: "session-1"
  });
  mocks.list.mockReset().mockResolvedValue([
    {
      id: "session-1",
      userAgent: "Chrome",
      ip: "127.0.0.1",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:05:00.000Z",
      current: true
    }
  ]);
});

describe("GET /api/account/sessions", () => {
  it("lists sessions and flags the current device", async () => {
    const response = await GET(new Request("http://localhost/api/account/sessions"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sessions[0].current).toBe(true);
    expect(mocks.list).toHaveBeenCalledWith("user-1", "session-1");
  });

  it("requires auth", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/account/sessions"))).status).toBe(401);
  });
});
