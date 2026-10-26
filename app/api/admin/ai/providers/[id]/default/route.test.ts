// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  recordAudit: vi.fn(),
  listProviders: vi.fn(),
  setActiveProvider: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/src/platform/ai-config", () => ({
  listProviders: mocks.listProviders,
  setActiveProvider: mocks.setActiveProvider
}));

import { POST } from "./route";

const adminSession = { id: "admin-1", role: "admin" };
const view = { providers: [{ id: "p1", name: "OpenAI", channel: "openai-compatible" }], channels: [] };

beforeEach(() => {
  mocks.getSessionUser.mockReset().mockResolvedValue(adminSession);
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
  mocks.listProviders.mockReset().mockResolvedValue(view);
  mocks.setActiveProvider.mockReset().mockResolvedValue(view);
});

describe("POST /api/admin/ai/providers/{id}/default", () => {
  it("activates the provider and audits", async () => {
    const response = await POST(new Request("http://localhost/api/admin/ai/providers/p1/default", { method: "POST" }), {
      params: Promise.resolve({ id: "p1" })
    });
    expect(response.status).toBe(200);
    expect(mocks.setActiveProvider).toHaveBeenCalledWith("p1");
    expect(mocks.recordAudit.mock.calls[0][0].action).toBe("admin.ai_config.activate");
  });

  it("returns 404 for an unknown provider", async () => {
    mocks.listProviders.mockResolvedValue({ providers: [], channels: [] });
    const response = await POST(
      new Request("http://localhost/api/admin/ai/providers/missing/default", { method: "POST" }),
      { params: Promise.resolve({ id: "missing" }) }
    );
    expect(response.status).toBe(404);
  });
});
