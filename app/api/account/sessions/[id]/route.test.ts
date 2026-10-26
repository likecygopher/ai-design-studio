// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  recordAudit: vi.fn(),
  revoke: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/src/platform/sessions", () => ({ revokeAuthSession: mocks.revoke }));

import { setRateLimiter } from "@/src/platform/api";
import { MemoryRateLimiter } from "@/src/platform/rate-limit";
import { DELETE } from "./route";

const session = { id: "user-1", role: "user", sessionId: "session-current" };

function call(id = "session-2") {
  return DELETE(
    new Request(`http://localhost/api/account/sessions/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  setRateLimiter(new MemoryRateLimiter());
  mocks.getSessionUser.mockReset().mockResolvedValue(session);
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
  mocks.revoke.mockReset().mockResolvedValue(true);
});

describe("DELETE /api/account/sessions/{id}", () => {
  it("revokes another device session and audits it", async () => {
    const response = await call();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ revoked: true, revokedCurrent: false });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account.session_revoke", targetId: "session-2" })
    );
  });

  it("flags current-session revocation so the client can sign out", async () => {
    const response = await call("session-current");
    expect((await response.json()).revokedCurrent).toBe(true);
  });

  it("returns 404 for unknown/foreign sessions", async () => {
    mocks.revoke.mockResolvedValue(false);
    expect((await call("missing")).status).toBe(404);
  });

  it("requires auth", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
});
