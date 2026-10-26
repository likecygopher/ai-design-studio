// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  recordAudit: vi.fn(),
  listProviders: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/src/platform/ai-config", () => ({
  listProviders: mocks.listProviders,
  updateProvider: mocks.updateProvider,
  deleteProvider: mocks.deleteProvider
}));

import { DELETE, PATCH } from "./route";

const adminSession = { id: "admin-1", email: "admin@example.com", role: "admin" };
const view = {
  providers: [{ id: "p1", name: "OpenAI", channel: "openai-compatible" }],
  channels: []
};

beforeEach(() => {
  mocks.getSessionUser.mockReset().mockResolvedValue(adminSession);
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
  mocks.listProviders.mockReset().mockResolvedValue(view);
  mocks.updateProvider.mockReset().mockResolvedValue(view);
  mocks.deleteProvider.mockReset().mockResolvedValue({ providers: [], channels: [] });
});

function request(method: string, body?: unknown) {
  return new Request("http://localhost/api/admin/ai/providers/p1", {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  });
}

const context = { params: Promise.resolve({ id: "p1" }) };

describe("PATCH /api/admin/ai/providers/{id}", () => {
  it("updates a provider and audits the change", async () => {
    const response = await PATCH(
      request("PATCH", {
        name: "OpenAI",
        channel: "openai-compatible",
        baseUrl: "https://new.example/v1"
      }),
      context
    );
    expect(response.status).toBe(200);
    expect(mocks.updateProvider).toHaveBeenCalled();
    expect(mocks.recordAudit.mock.calls[0][0].action).toBe("admin.ai_config.update");
  });

  it("returns 404 for an unknown provider", async () => {
    mocks.listProviders.mockResolvedValue({ providers: [], channels: [] });
    const response = await PATCH(
      request("PATCH", { name: "x", channel: "ark" }),
      { params: Promise.resolve({ id: "missing" }) }
    );
    expect(response.status).toBe(404);
    expect(mocks.updateProvider).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/ai/providers/{id}", () => {
  it("deletes a provider and audits", async () => {
    const response = await DELETE(request("DELETE"), context);
    expect(response.status).toBe(200);
    expect(mocks.deleteProvider).toHaveBeenCalledWith("p1");
    expect(mocks.recordAudit.mock.calls[0][0].action).toBe("admin.ai_config.delete");
  });

  it("returns 404 when missing", async () => {
    mocks.listProviders.mockResolvedValue({ providers: [], channels: [] });
    const response = await DELETE(request("DELETE"), {
      params: Promise.resolve({ id: "missing" })
    });
    expect(response.status).toBe(404);
  });
});
