import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminOverview, formatBytes, formatUptime } from "./AdminOverview";

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

const stats = {
  users: { total: 7 },
  jobs: {
    total: 120,
    byStatus: { succeeded: 100, failed: 20 },
    queued: 3,
    running: 2,
    failedLast24h: 4,
    failureRate: 0.1667
  },
  storage: { assets: 42, bytes: 5 * 1024 * 1024 * 1024 }
};

const health = {
  status: "ok",
  database: { ok: true },
  queue: { queued: 3, running: 2, failed: 20 },
  workers: { total: 2, alive: 1 },
  process: { uptimeSec: 90_000 }
};

beforeEach(() => {
  mocks.apiFetch.mockReset().mockImplementation(async (url: string) => {
    if (url === "/api/admin/stats") return stats;
    if (url === "/api/admin/health") return health;
    throw new Error(`unexpected ${url}`);
  });
});

describe("AdminOverview", () => {
  it("renders platform metrics and quick links", async () => {
    render(<AdminOverview />);

    expect(await screen.findByText("7")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("3/2")).toBeInTheDocument();
    expect(screen.getByText("5.0 GB")).toBeInTheDocument();
    expect(screen.getByText(/数据库 已连接/)).toBeInTheDocument();
    expect(screen.getByText(/Worker 1\/2 在线/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /AI 引擎/ })).toHaveAttribute("href", "/admin/ai");
  });

  it("refreshes via the button", async () => {
    const user = userEvent.setup();
    render(<AdminOverview />);
    await screen.findByText("7");

    await user.click(screen.getByRole("button", { name: "刷新" }));
    expect(mocks.apiFetch.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("shows an error state", async () => {
    mocks.apiFetch.mockRejectedValue(new Error("读取失败"));
    render(<AdminOverview />);
    expect(await screen.findByRole("alert")).toHaveTextContent("读取失败");
  });
});

describe("formatters", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
  });

  it("formats uptime", () => {
    expect(formatUptime(59)).toBe("0m");
    expect(formatUptime(3_600)).toBe("1h 0m");
    expect(formatUptime(90_000)).toBe("1d 1h");
  });
});
