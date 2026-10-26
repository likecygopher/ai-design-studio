import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPlans } from "./AdminPlans";

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

const plan = {
  id: "plan-1",
  name: "Pro",
  description: "专业版",
  monthlyBudgetUnits: 500,
  maxActiveJobs: 3,
  usersCount: 2
};

beforeEach(() => {
  mocks.apiFetch.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return { plan };
    return { plans: [plan] };
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("AdminPlans", () => {
  it("lists plans and creates a new one", async () => {
    const user = userEvent.setup();
    render(<AdminPlans />);
    const table = within(await screen.findByRole("table", { name: "套餐列表" }));
    expect(table.getByText("Pro")).toBeInTheDocument();
    expect(table.getByText("500")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新增套餐" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("套餐名称"), "Team");
    await user.type(within(dialog).getByLabelText("套餐月度预算"), "1000");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        "/api/admin/plans",
        expect.objectContaining({ method: "POST" })
      )
    );
  });

  it("does not delete a plan with members", async () => {
    render(<AdminPlans />);
    const table = within(await screen.findByRole("table", { name: "套餐列表" }));
    expect(table.getByRole("button", { name: "删除套餐 Pro" })).toBeDisabled();
  });
});
