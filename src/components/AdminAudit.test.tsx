import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAudit, actionLabel, formatAuditTime } from "./AdminAudit";

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

function logRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "audit-1",
    action: "admin.user.create",
    actorRole: "admin",
    userId: "admin-1",
    userEmail: "admin@example.com",
    targetType: "user",
    targetId: "user-9",
    metadata: { role: "user" },
    ip: "127.0.0.1",
    requestId: "req_abc",
    createdAt: "2026-01-01T08:30:00.000Z",
    ...overrides
  };
}

beforeEach(() => {
  mocks.apiFetch.mockReset().mockResolvedValue({
    logs: [logRow()],
    actions: ["admin.user.create", "auth.login"],
    nextCursor: null
  });
});

describe("AdminAudit", () => {
  it("renders audit rows with labels and helpers", async () => {
    render(<AdminAudit />);
    const table = within(await screen.findByRole("table", { name: "审计日志列表" }));

    expect(table.getByText("创建用户")).toBeInTheDocument();
    expect(table.getByText("admin@example.com")).toBeInTheDocument();
    expect(table.getByText("req_abc")).toBeInTheDocument();
    expect(table.getByText(/user · user-9/)).toBeInTheDocument();

    expect(actionLabel("admin.ai_config.update")).toBe("更新 AI 配置");
    expect(actionLabel("unknown.action")).toBe("unknown.action");
    expect(formatAuditTime("2026-01-01T08:30:00.000Z")).toMatch(/^2026-01-01 /);
  });

  it("filters by action and search term", async () => {
    const user = userEvent.setup();
    render(<AdminAudit />);
    await screen.findByRole("table", { name: "审计日志列表" });

    await user.selectOptions(screen.getByLabelText("操作类型筛选"), "auth.login");
    await user.type(screen.getByLabelText("搜索审计日志"), "admin");

    await waitFor(
      () => {
        const urls = mocks.apiFetch.mock.calls.map((call) => String(call[0]));
        expect(
          urls.some((url) => url.includes("action=auth.login") && url.includes("q=admin"))
        ).toBe(true);
      },
      { timeout: 3000 }
    );
  });

  it("loads more rows with the cursor", async () => {
    mocks.apiFetch
      .mockResolvedValueOnce({
        logs: [logRow()],
        actions: ["admin.user.create"],
        nextCursor: "audit-1"
      })
      .mockResolvedValueOnce({
        logs: [logRow({ id: "audit-2", action: "auth.login" })],
        actions: ["admin.user.create", "auth.login"],
        nextCursor: null
      });

    const user = userEvent.setup();
    render(<AdminAudit />);
    await screen.findByRole("table", { name: "审计日志列表" });

    await user.click(screen.getByRole("button", { name: "加载更多" }));

    await waitFor(() => {
      const urls = mocks.apiFetch.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("cursor=audit-1"))).toBe(true);
    });
    const table = within(await screen.findByRole("table", { name: "审计日志列表" }));
    expect(table.getByText("登录")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    mocks.apiFetch.mockResolvedValue({ logs: [], actions: [], nextCursor: null });
    render(<AdminAudit />);

    expect(await screen.findByText("暂无匹配的审计记录。")).toBeInTheDocument();
  });

  it("shows an error state", async () => {
    mocks.apiFetch.mockRejectedValue(new Error("读取失败"));
    render(<AdminAudit />);

    expect(await screen.findByRole("alert")).toHaveTextContent("读取失败");
  });
});
