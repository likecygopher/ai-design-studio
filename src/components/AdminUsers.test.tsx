import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signOut } from "next-auth/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AdminUsers } from "./AdminUsers";

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

const signOutMock = signOut as unknown as Mock;

const self = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  role: "admin",
  disabled: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  counts: { products: 1, assets: 2, jobs: 3 }
};

const regular = {
  id: "user-1",
  email: "user@example.com",
  name: "Regular",
  role: "user",
  disabled: true,
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  counts: { products: 0, assets: 0, jobs: 0 }
};

function listResponse(users = [self, regular]) {
  return { users, nextCursor: null };
}

beforeEach(() => {
  mocks.apiFetch.mockReset();
  signOutMock.mockReset();

  mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/admin/users?")) {
      return listResponse();
    }
    if (url === "/api/admin/users" && init?.method === "POST") {
      return {
        user: { ...regular, email: "new@example.com", name: "New", disabled: false },
        temporaryPassword: "TempPass12345678"
      };
    }
    if (url.endsWith("/password")) {
      return {
        user: { ...regular, disabled: false },
        temporaryPassword: "ResetPass1234567",
        reauthRequired: false
      };
    }
    if (init?.method === "PATCH") {
      return { user: { ...regular, name: "Updated", disabled: false } };
    }
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
  });
});

async function renderAndWait() {
  render(<AdminUsers currentUserId={self.id} />);
  await screen.findByText("admin@example.com");
}

describe("AdminUsers", () => {
  it("renders accounts with role, status, counts and creation date", async () => {
    await renderAndWait();

    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    const table = within(screen.getByRole("table", { name: "用户列表" }));
    expect(table.getByText("管理员")).toBeInTheDocument();
    expect(table.getByText("普通用户")).toBeInTheDocument();
    expect(table.getByText("已禁用")).toBeInTheDocument();
    expect(table.getByText("正常")).toBeInTheDocument();
    expect(table.getByText("产品 1 · 素材 2 · 任务 3")).toBeInTheDocument();
    expect(table.getByText("2026-01-02")).toBeInTheDocument();
    expect(table.getByText("当前账号")).toBeInTheDocument();
  });

  it("sends the search term and role filter to the list API", async () => {
    const user = userEvent.setup();
    render(<AdminUsers currentUserId={self.id} />);
    await screen.findByText("admin@example.com");

    await user.type(screen.getByLabelText("搜索用户"), "midea");
    await user.selectOptions(screen.getByLabelText("角色筛选"), "admin");

    await waitFor(
      () => {
        const urls = mocks.apiFetch.mock.calls.map((call) => String(call[0]));
        expect(urls.some((url) => url.includes("q=midea") && url.includes("role=admin"))).toBe(true);
      },
      { timeout: 3000 }
    );
  });

  it("creates a user and shows the one-time password once", async () => {
    const user = userEvent.setup();
    await renderAndWait();

    await user.click(screen.getByRole("button", { name: "新建用户" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.type(dialog.getByLabelText("邮箱"), "new@example.com");
    await user.type(dialog.getByLabelText("昵称"), "New");
    await user.selectOptions(dialog.getByLabelText("角色"), "user");
    await user.click(dialog.getByRole("button", { name: "创建用户" }));

    await waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        "/api/admin/users",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "new@example.com", name: "New", role: "user" })
        })
      );
    });

    const secretDialog = await screen.findByRole("dialog");
    expect(within(secretDialog).getByLabelText("一次性密码")).toHaveTextContent(
      "TempPass12345678"
    );
    expect(within(secretDialog).getByText(/仅显示这一次/)).toBeInTheDocument();
  });

  it("edits nickname, role and disabled state", async () => {
    const user = userEvent.setup();
    await renderAndWait();

    await user.click(screen.getByRole("button", { name: "编辑用户 user@example.com" }));
    const dialog = within(screen.getByRole("dialog"));
    const nameInput = dialog.getByLabelText("昵称");
    await user.clear(nameInput);
    await user.type(nameInput, "Updated");
    await user.selectOptions(dialog.getByLabelText("角色"), "admin");
    await user.click(dialog.getByLabelText(/禁用该账户/));
    await user.click(dialog.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        "/api/admin/users/user-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            name: "Updated",
            role: "admin",
            disabled: false,
            monthlyBudgetUnits: null,
            requiresJobApproval: false,
            planId: null
          })
        })
      );
    });
  });

  it("protects the current admin from self disable/demote in the edit dialog", async () => {
    const user = userEvent.setup();
    await renderAndWait();

    await user.click(screen.getByRole("button", { name: `编辑用户 ${self.email}` }));
    const dialog = within(screen.getByRole("dialog"));

    expect(dialog.getByLabelText("角色")).toBeDisabled();
    expect(dialog.getByLabelText(/禁用该账户/)).toBeDisabled();
    expect(dialog.getByText(/不能禁用或降级当前登录的管理员账号/)).toBeInTheDocument();
  });

  it("resets a password and surfaces the temporary password", async () => {
    const user = userEvent.setup();
    await renderAndWait();

    await user.click(screen.getByRole("button", { name: `重置 ${regular.email} 的密码` }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "重置密码" }));

    await waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        "/api/admin/users/user-1/password",
        expect.objectContaining({ method: "POST", body: "{}" })
      );
    });

    expect(await screen.findByLabelText("一次性密码")).toHaveTextContent("ResetPass1234567");
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("shows a readable error when the list request fails", async () => {
    mocks.apiFetch.mockRejectedValue(new Error("读取失败"));
    render(<AdminUsers currentUserId={self.id} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("读取失败");
  });
});
