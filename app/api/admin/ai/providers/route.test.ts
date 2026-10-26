// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  recordAudit: vi.fn(),
  listProviders: vi.fn(),
  createProvider: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/src/platform/ai-config", () => ({
  listProviders: mocks.listProviders,
  createProvider: mocks.createProvider
}));

import { GET, POST } from "./route";

const adminSession = { id: "admin-1", email: "admin@example.com", role: "admin" };
const view = {
  providers: [{ id: "p1", name: "OpenAI", channel: "openai-compatible", channelLabel: "OpenAI 兼容", active: true }],
  channels: [{ id: "openai-compatible", label: "OpenAI 兼容", hint: "" }]
};

beforeEach(() => {
  mocks.getSessionUser.mockReset().mockResolvedValue(adminSession);
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
  mocks.listProviders.mockReset().mockResolvedValue(view);
  mocks.createProvider.mockReset().mockResolvedValue(view);
});

describe("GET /api/admin/ai/providers", () => {
  it("requires admin", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u", role: "user" });
    const response = await GET(new Request("http://localhost/api/admin/ai/providers"));
    expect(response.status).toBe(403);
    expect(mocks.listProviders).not.toHaveBeenCalled();
  });

  it("returns the provider list", async () => {
    const response = await GET(new Request("http://localhost/api/admin/ai/providers"));
    expect(response.status).toBe(200);
    expect((await response.json()).providers).toHaveLength(1);
  });
});

describe("POST /api/admin/ai/providers", () => {
  function request(body: unknown) {
    return new Request("http://localhost/api/admin/ai/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  it("creates a provider and audits without leaking the key", async () => {
    const response = await POST(
      request({
        name: "DeepSeek",
        channel: "openai-compatible",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-secret-1111",
        models: { text: "deepseek-chat" }
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.createProvider).toHaveBeenCalled();
    const audit = mocks.recordAudit.mock.calls[0][0];
    expect(audit.action).toBe("admin.ai_config.create");
    expect(JSON.stringify(audit)).not.toContain("sk-secret-1111");
  });

  it("rejects an invalid channel or missing name", async () => {
    expect((await POST(request({ name: "x", channel: "other" }))).status).toBe(400);
    expect((await POST(request({ channel: "ark" }))).status).toBe(400);
    expect(mocks.createProvider).not.toHaveBeenCalled();
  });

  it("rejects a non-http base URL", async () => {
    const response = await POST(
      request({ name: "x", channel: "ark", baseUrl: "ftp://example.com" })
    );
    expect(response.status).toBe(400);
  });
});
