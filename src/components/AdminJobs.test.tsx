import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminJobs } from "./AdminJobs";

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

const createdAt = "2026-01-01T08:00:00.000Z";

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-failed-1",
    userId: "user-abcdef123456",
    type: "pop-scene",
    status: "failed",
    progress: 0,
    attempts: 3,
    maxAttempts: 3,
    error: "provider timeout",
    requiresApproval: false,
    approvedAt: createdAt,
    approvedBy: null,
    approvalNote: null,
    createdAt,
    startedAt: createdAt,
    finishedAt: createdAt,
    ...overrides
  };
}

beforeEach(() => {
  mocks.apiFetch.mockReset().mockImplementation(async (url: string) => {
    if (url.includes("/retry")) return { job: { id: "job-new" } };
    if (url.includes("/cancel")) return { job: { id: "job-running" } };
    return {
      jobs: [
        job(),
        job({ id: "job-running-2", status: "running", progress: 42, error: null }),
        job({ id: "job-done-3", status: "succeeded", error: null })
      ],
      nextCursor: null
    };
  });
});

describe("AdminJobs", () => {
  it("renders jobs with type/status/error and only valid actions", async () => {
    render(<AdminJobs />);
    const table = within(await screen.findByRole("table", { name: "任务列表" }));

    expect(table.getByText("provider timeout")).toBeInTheDocument();
    expect(table.getByText("失败")).toBeInTheDocument();
    expect(table.getByText("生成中")).toBeInTheDocument();
    expect(table.getByText("已完成")).toBeInTheDocument();
    expect(table.getByRole("button", { name: /重试任务/ })).toBeInTheDocument();
    expect(table.getByRole("button", { name: /取消任务/ })).toBeInTheDocument();
  });

  it("retries a failed job and refreshes the list", async () => {
    const user = userEvent.setup();
    render(<AdminJobs />);
    await screen.findByRole("table", { name: "任务列表" });

    await user.click(screen.getByRole("button", { name: /重试任务/ }));

    expect(await screen.findByText(/已重新提交任务/)).toBeInTheDocument();
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/admin/jobs/job-failed-1/retry", {
      method: "POST"
    });
  });

  it("cancels a running job", async () => {
    const user = userEvent.setup();
    render(<AdminJobs />);
    await screen.findByRole("table", { name: "任务列表" });

    await user.click(screen.getByRole("button", { name: /取消任务/ }));

    expect(await screen.findByText(/已取消任务/)).toBeInTheDocument();
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/admin/jobs/job-running-2/cancel", {
      method: "POST"
    });
  });

  it("approves a job waiting for admin approval", async () => {
    mocks.apiFetch.mockImplementation(async (url: string) => {
      if (url.includes("/approve")) {
        return { job: { id: "job-pending-1", status: "queued" } };
      }
      return {
        jobs: [
          job({
            id: "job-pending-1",
            status: "queued",
            requiresApproval: true,
            approvedAt: null,
            error: null
          })
        ],
        nextCursor: null
      };
    });
    const user = userEvent.setup();
    render(<AdminJobs />);
    await screen.findByRole("table", { name: "任务列表" });

    const table = within(screen.getByRole("table", { name: "任务列表" }));
    expect(table.getByText("待审批")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /批准任务/ }));

    expect(await screen.findByText(/已批准任务/)).toBeInTheDocument();
    expect(mocks.apiFetch).toHaveBeenCalledWith("/api/admin/jobs/job-pending-1/approve", {
      method: "POST"
    });
  });

  it("shows an empty state and error state", async () => {
    mocks.apiFetch.mockResolvedValue({ jobs: [], nextCursor: null });
    const { unmount } = render(<AdminJobs />);
    expect(await screen.findByText("暂无匹配的任务。")).toBeInTheDocument();
    unmount();

    mocks.apiFetch.mockRejectedValue(new Error("读取失败"));
    render(<AdminJobs />);
    expect(await screen.findByRole("alert")).toHaveTextContent("读取失败");
  });
});
