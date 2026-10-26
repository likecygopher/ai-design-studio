import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

vi.mock("next/navigation", () => ({ usePathname: () => "/sku-variants" }));

// File-local session stub so the role badge can be exercised for both roles.
const auth = vi.hoisted(() => ({
  session: null as null | {
    user: { id: string; email: string; name?: string; role?: string };
    expires: string;
  }
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: auth.session,
    status: auth.session ? "authenticated" : "unauthenticated",
    update: vi.fn()
  }),
  signIn: vi.fn(),
  signOut: vi.fn(),
  SessionProvider: ({ children }: { children: unknown }) => children
}));

function mockSession(role?: string) {
  auth.session = {
    user: {
      id: "test-user",
      email: "test@midea.local",
      name: "Test User",
      ...(role ? { role } : {})
    },
    expires: "2099-01-01T00:00:00.000Z"
  };
}

beforeEach(() => {
  mockSession("user");
});

describe("grouped navigation", () => {
  it("preserves all routes and exposes the active tool", async () => {
    const user = userEvent.setup();
    render(<AppShell><h1>Workbench</h1></AppShell>);
    const nav = within(screen.getByRole("navigation", { name: "平台导航" }));
    expect(nav.getByRole("button", { name: "创作中心" })).toHaveAttribute("aria-expanded", "true");
    expect(nav.getByRole("link", { name: "SKU 替换" })).toHaveAttribute("aria-current", "page");
    await user.click(nav.getByRole("button", { name: "资产中心" }));
    await user.click(nav.getByRole("button", { name: "品牌管理" }));
    await user.click(nav.getByRole("button", { name: "系统" }));
    expect(new Set(nav.getAllByRole("link").map(link => link.getAttribute("href")))).toEqual(new Set([
      "/studio-home", "/jobs", "/assets", "/products", "/white-background", "/phone-standardize", "/sku-variants",
      "/style-transfer", "/icon-design", "/product-video", "/pop", "/pdp", "/localize", "/marketplace", "/account/organization", "/costs", "/account"
    ]));
    await user.click(nav.getByRole("button", { name: "创作中心" }));
    expect(nav.queryByRole("link", { name: "SKU 替换" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用户设置" })).toBeInTheDocument();
  });

  it("groups task center, usage, marketplace and account under System", async () => {
    const user = userEvent.setup();
    render(<AppShell><h1>Workbench</h1></AppShell>);
    const nav = within(screen.getByRole("navigation", { name: "平台导航" }));
    await user.click(nav.getByRole("button", { name: "系统" }));
    expect(nav.getByRole("link", { name: "任务中心" })).toHaveAttribute("href", "/jobs");
    expect(nav.getByRole("link", { name: "资源消耗" })).toHaveAttribute("href", "/costs");
    expect(nav.getByRole("link", { name: "模板市场" })).toHaveAttribute("href", "/marketplace");
    expect(nav.getByRole("link", { name: "组织与团队" })).toHaveAttribute("href", "/account/organization");
    expect(nav.getByRole("link", { name: "账户设置" })).toHaveAttribute("href", "/account");
  });

  it("hides platform-management entries from regular users", () => {
    render(<AppShell><h1>Workbench</h1></AppShell>);
    const nav = within(screen.getByRole("navigation", { name: "平台导航" }));
    expect(nav.queryByRole("link", { name: "用户管理" })).not.toBeInTheDocument();
    expect(nav.queryByRole("link", { name: "AI 引擎" })).not.toBeInTheDocument();
    expect(nav.queryByRole("link", { name: "审计日志" })).not.toBeInTheDocument();
  });
});

describe("session summary", () => {
  it("shows the signed-in email and a regular-user role badge", () => {
    render(<AppShell><h1>Workbench</h1></AppShell>);
    expect(screen.getByText("test@midea.local")).toBeInTheDocument();
    expect(screen.getByText("普通用户")).toHaveAttribute("data-role", "user");
  });

  it("falls back to the regular-user badge for legacy sessions without a role", () => {
    mockSession();
    render(<AppShell><h1>Workbench</h1></AppShell>);
    expect(screen.getByText("普通用户")).toHaveAttribute("data-role", "user");
  });

  it("marks admins and exposes the admin directory", async () => {
    mockSession("admin");
    const user = userEvent.setup();
    render(<AppShell><h1>Workbench</h1></AppShell>);
    expect(
      screen.getAllByText("管理员").find((element) => element.hasAttribute("data-role"))
    ).toHaveAttribute("data-role", "admin");
    const nav = within(screen.getByRole("navigation", { name: "平台导航" }));
    await user.click(nav.getByRole("button", { name: "管理员" }));
    expect(nav.getByRole("link", { name: "用户管理" })).toHaveAttribute("href", "/admin/users");
    expect(nav.getByRole("link", { name: "系统概览" })).toHaveAttribute("href", "/admin");
    expect(nav.getByRole("link", { name: "AI 引擎" })).toHaveAttribute("href", "/admin/ai");
    expect(nav.getByRole("link", { name: "审计日志" })).toHaveAttribute("href", "/admin/audit");
  });
});
