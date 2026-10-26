import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAiConfig } from "./AdminAiConfig";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  formatApiError: vi.fn((error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback
  )
}));

vi.mock("@/src/lib/api-client", () => ({
  apiFetch: mocks.apiFetch,
  formatApiError: mocks.formatApiError
}));

const channels = [
  { id: "openai-compatible", label: "OpenAI 兼容", hint: "" },
  { id: "ark", label: "火山方舟 ARK", hint: "" }
];

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    name: "OpenAI 生产",
    channel: "openai-compatible",
    channelLabel: "OpenAI 兼容",
    baseUrl: "https://api.openai.com/v1",
    proxyUrl: null,
    models: { image: "gpt-image-1", text: "gpt-4o-mini" },
    enabled: true,
    priority: 10,
    hasApiKey: true,
    apiKeyMasked: "••••••1234",
    lastTestAt: "2026-01-01T08:00:00.000Z",
    lastTestOk: true,
    lastTestNote: "OK · 200 · 120ms",
    successCount: 12,
    failureCount: 1,
    consecutiveFailures: 0,
    lastFailureAt: null,
    lastFailureReason: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

const view = {
  providers: [
    provider(),
    provider({
      id: "p2",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      active: false,
      priority: 20,
      models: { text: "deepseek-chat" },
      successCount: 3,
      failureCount: 0,
      lastTestAt: null,
      lastTestOk: null,
      lastTestNote: null
    }),
    provider({
      id: "p3",
      name: "火山方舟",
      channel: "ark",
      channelLabel: "火山方舟 ARK",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      active: true,
      models: { image: "doubao-seedream", video: "doubao-seedance" },
      successCount: 0,
      failureCount: 0,
      lastTestAt: null,
      lastTestOk: null,
      lastTestNote: null
    })
  ],
  channels
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

beforeEach(() => {
  mocks.apiFetch.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/admin/ai/providers" && method === "GET") return view;
    if (url === "/api/admin/ai/providers" && method === "POST") return view;
    if (url.endsWith("/default")) return view;
    if (url.endsWith("/test")) {
      return { ok: true, status: 200, reason: "OK", latencyMs: 120, modelCount: 42 };
    }
    if (method === "PATCH") return view;
    if (method === "DELETE") return { providers: [], channels };
    throw new Error(`unexpected ${method} ${url}`);
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

describe("AdminAiConfig", () => {
  it("renders providers in a table with active/status/model details", async () => {
    render(<AdminAiConfig />);
    const table = await screen.findByRole("table", { name: "AI 供应商列表" });

    expect(within(table).getByText("OpenAI 生产")).toBeInTheDocument();
    expect(within(table).getByText("DeepSeek")).toBeInTheDocument();
    expect(within(table).getAllByText("生效中")).toHaveLength(2);
    expect(within(table).getByText(/图像 gpt-image-1 · 文本 gpt-4o-mini/)).toBeInTheDocument();
    expect(within(table).getByText(/正常 · OK · 200 · 120ms/)).toBeInTheDocument();
    expect(within(table).getByText(/调用 12 成功 · 1 失败/)).toBeInTheDocument();
    expect(within(rowFor("DeepSeek")).getAllByText("未测试")).toHaveLength(2);
    expect(within(rowFor("火山方舟")).getAllByText("未测试")).toHaveLength(2);
  });

  it("creates a provider from a preset dialog", async () => {
    const user = userEvent.setup();
    render(<AdminAiConfig />);
    await screen.findByRole("table", { name: "AI 供应商列表" });

    await user.click(screen.getByRole("button", { name: "新增供应商" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "DeepSeek" }));

    expect(dialog.getByLabelText("供应商名称")).toHaveValue("DeepSeek");
    expect(dialog.getByLabelText("供应商 Base URL")).toHaveValue("https://api.deepseek.com/v1");
    await user.click(dialog.getByRole("button", { name: "新增供应商" }));

    await waitFor(() => {
      const post = mocks.apiFetch.mock.calls.find(
        (call) => call[0] === "/api/admin/ai/providers" && call[1]?.method === "POST"
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post![1]?.body));
      expect(body).toMatchObject({
        name: "DeepSeek",
        channel: "openai-compatible",
        baseUrl: "https://api.deepseek.com/v1",
        models: { text: "deepseek-chat" },
        enabled: true
      });
      expect(body.apiKey).toBeUndefined();
    });
  });

  it("edits a provider and keeps the existing key when untouched", async () => {
    const user = userEvent.setup();
    render(<AdminAiConfig />);
    await screen.findByRole("table", { name: "AI 供应商列表" });

    await user.click(within(rowFor("OpenAI 生产")).getByRole("button", { name: /编辑/ }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByLabelText("供应商 API Key")).toHaveAttribute(
      "placeholder",
      "••••••1234（留空保持不变）"
    );
    const baseUrl = dialog.getByLabelText("供应商 Base URL");
    await user.clear(baseUrl);
    await user.type(baseUrl, "https://new.example/v1");
    await user.click(dialog.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      const patch = mocks.apiFetch.mock.calls.find((call) => call[1]?.method === "PATCH");
      expect(patch).toBeTruthy();
      const body = JSON.parse(String(patch![1]?.body));
      expect(body.baseUrl).toBe("https://new.example/v1");
      expect(body.apiKey).toBeUndefined();
      expect(body.clearApiKey).toBeUndefined();
    });
  });

  it("tests a provider and shows the result", async () => {
    const user = userEvent.setup();
    render(<AdminAiConfig />);
    await screen.findByRole("table", { name: "AI 供应商列表" });

    await user.click(within(rowFor("DeepSeek")).getByRole("button", { name: /测试/ }));

    expect(
      await screen.findByText(/「DeepSeek」连接正常 · 200 · 120ms · 42 个模型/)
    ).toBeInTheDocument();
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/admin/ai/providers/p2/test", {
      method: "POST"
    });
  });

  it("activates and deletes a provider", async () => {
    const user = userEvent.setup();
    render(<AdminAiConfig />);
    await screen.findByRole("table", { name: "AI 供应商列表" });

    await user.click(within(rowFor("DeepSeek")).getByRole("button", { name: /设为生效/ }));
    await waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith("/api/admin/ai/providers/p2/default", {
        method: "POST"
      });
    });

    await user.click(within(rowFor("DeepSeek")).getByRole("button", { name: /删除/ }));
    await waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith("/api/admin/ai/providers/p2", {
        method: "DELETE"
      });
    });
  });
});
