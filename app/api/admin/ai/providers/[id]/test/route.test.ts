// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  recordAudit: vi.fn(),
  getProviderTestTarget: vi.fn(),
  recordProviderTest: vi.fn(),
  fetchOpenAi: vi.fn(),
  createProxyDispatcher: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/src/platform/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/src/platform/ai-config", () => ({
  getProviderTestTarget: mocks.getProviderTestTarget,
  recordProviderTest: mocks.recordProviderTest
}));
vi.mock("@/src/services/image-provider", () => ({
  createProxyDispatcher: mocks.createProxyDispatcher,
  fetchOpenAi: mocks.fetchOpenAi,
  normalizeApiRoot: (value: string | undefined) =>
    (value?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "")
}));
vi.mock("@/src/platform/logger", () => {
  const noop = () => undefined;
  const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  return { logger, createLogger: () => logger };
});

import { POST } from "./route";

const target = {
  id: "p1",
  name: "OpenAI",
  channel: "openai-compatible",
  baseUrl: "https://api.example/v1",
  proxyUrl: undefined,
  apiKey: "sk-live-1234"
};

function call(id = "p1") {
  return POST(new Request(`http://localhost/api/admin/ai/providers/${id}/test`, { method: "POST" }), {
    params: Promise.resolve({ id })
  });
}

beforeEach(() => {
  mocks.getSessionUser.mockReset().mockResolvedValue({ id: "admin-1", role: "admin" });
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
  mocks.getProviderTestTarget.mockReset().mockResolvedValue(target);
  mocks.recordProviderTest.mockReset().mockResolvedValue(undefined);
  mocks.createProxyDispatcher.mockReset().mockReturnValue(undefined);
  mocks.fetchOpenAi.mockReset();
});

describe("POST /api/admin/ai/providers/{id}/test", () => {
  it("returns 404 for an unknown provider", async () => {
    mocks.getProviderTestTarget.mockResolvedValue(null);
    expect((await call("missing")).status).toBe(404);
  });

  it("reports NO_KEY without a request", async () => {
    mocks.getProviderTestTarget.mockResolvedValue({ ...target, apiKey: undefined });
    const response = await call();
    expect((await response.json()).reason).toBe("NO_KEY");
    expect(mocks.fetchOpenAi).not.toHaveBeenCalled();
    expect(mocks.recordProviderTest).toHaveBeenCalledWith("p1", { ok: false, note: "NO_KEY" });
  });

  it("reports OK and records the test result", async () => {
    mocks.fetchOpenAi.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }), { status: 200 })
    );
    const response = await call();
    const body = await response.json();

    expect(body).toMatchObject({ ok: true, reason: "OK", status: 200, modelCount: 2 });
    expect(mocks.fetchOpenAi.mock.calls[0][0]).toBe("https://api.example/v1/models");
    expect(JSON.stringify(body)).not.toContain("sk-live-1234");
    expect(mocks.recordProviderTest.mock.calls[0][1].ok).toBe(true);
  });

  it("maps auth and network failures", async () => {
    mocks.fetchOpenAi.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    expect((await (await call()).json()).reason).toBe("AUTH_FAILED");

    mocks.fetchOpenAi.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const network = await (await call()).json();
    expect(network.reason).toBe("NETWORK_ERROR");
    expect(network.message).not.toContain("ECONNREFUSED");
  });
});
