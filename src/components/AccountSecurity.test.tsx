import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signOut } from "next-auth/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AccountSecurity } from "./AccountSecurity";

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

const user = { id: "user-1", email: "user@example.com", role: "user" };

beforeEach(() => {
  mocks.apiFetch.mockReset().mockImplementation(async (url: string) => {
    if (url === "/api/account/2fa") {
      return { enabled: false, recoveryCodesRemaining: 0 };
    }
    if (url === "/api/account/api-tokens") {
      return { tokens: [] };
    }
    if (url === "/api/account/webhooks") {
      return { webhooks: [] };
    }
    if (url === "/api/account/sessions") {
      return {
        sessions: [
          {
            id: "session-1",
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/124",
            ip: "127.0.0.1",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: "2026-01-01T00:05:00.000Z",
            current: true
          }
        ]
      };
    }
    return { reauthRequired: true };
  });
  signOutMock.mockReset();
});

async function fill(
  event: ReturnType<typeof userEvent.setup>,
  values: { current?: string; next?: string; confirm?: string } = {}
) {
  const current = values.current ?? "CurrentPass1";
  const next = values.next ?? "NextPass123";
  const confirm = values.confirm ?? next;

  if (current) await event.type(screen.getByLabelText("当前密码"), current);
  if (next) await event.type(screen.getByLabelText("新密码"), next);
  if (confirm) await event.type(screen.getByLabelText("确认新密码"), confirm);
}

describe("AccountSecurity", () => {
  it("shows the signed-in identity and role", () => {
    render(<AccountSecurity user={user} />);
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByText("普通用户")).toBeInTheDocument();
  });

  it("rejects a missing current password", async () => {
    const event = userEvent.setup();
    render(<AccountSecurity user={user} />);

    await event.type(screen.getByLabelText("新密码"), "NextPass123");
    await event.type(screen.getByLabelText("确认新密码"), "NextPass123");
    await event.click(screen.getByRole("button", { name: /更新密码/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("请输入当前密码");
    expect(
      mocks.apiFetch.mock.calls.some(
        ([url, init]) => url === "/api/account/password" && init?.method === "POST"
      )
    ).toBe(false);
  });

  it("rejects a weak new password", async () => {
    const event = userEvent.setup();
    render(<AccountSecurity user={user} />);

    await fill(event, { next: "short", confirm: "short" });
    await event.click(screen.getByRole("button", { name: /更新密码/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("至少 8 位");
    expect(
      mocks.apiFetch.mock.calls.some(
        ([url, init]) => url === "/api/account/password" && init?.method === "POST"
      )
    ).toBe(false);
  });

  it("rejects mismatched confirmation", async () => {
    const event = userEvent.setup();
    render(<AccountSecurity user={user} />);

    await fill(event, { confirm: "Different123" });
    await event.click(screen.getByRole("button", { name: /更新密码/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("不一致");
    expect(
      mocks.apiFetch.mock.calls.some(
        ([url, init]) => url === "/api/account/password" && init?.method === "POST"
      )
    ).toBe(false);
  });

  it("rejects reusing the current password", async () => {
    const event = userEvent.setup();
    render(<AccountSecurity user={user} />);

    await fill(event, { current: "SamePass123", next: "SamePass123" });
    await event.click(screen.getByRole("button", { name: /更新密码/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("不能与当前密码相同");
    expect(
      mocks.apiFetch.mock.calls.some(
        ([url, init]) => url === "/api/account/password" && init?.method === "POST"
      )
    ).toBe(false);
  });

  it("creates an API token and shows it exactly once", async () => {
    const event = userEvent.setup();
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/account/2fa") return { enabled: false, recoveryCodesRemaining: 0 };
      if (url === "/api/account/sessions") return { sessions: [] };
      if (url === "/api/account/api-tokens" && init?.method === "POST") {
        return {
          token: "mcs_secret-token-value",
          apiToken: {
            id: "token-1",
            name: "CI",
            prefix: "mcs_secret-",
            scopes: ["read", "write"],
            lastUsedAt: null,
            expiresAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            revokedAt: null
          }
        };
      }
      if (url === "/api/account/api-tokens") return { tokens: [] };
      return { reauthRequired: true };
    });

    render(<AccountSecurity user={user} />);
    await event.type(screen.getByLabelText("令牌名称"), "CI");
    await event.click(screen.getByRole("button", { name: "创建令牌" }));

    expect(await screen.findByText("mcs_secret-token-value")).toBeInTheDocument();
    expect(screen.getByText(/仅展示一次/)).toBeInTheDocument();
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/account/api-tokens",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "CI", scopes: ["read", "write"] })
      })
    );
  });

  it("creates a webhook and shows its signing secret once", async () => {
    const event = userEvent.setup();
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/account/2fa") return { enabled: false, recoveryCodesRemaining: 0 };
      if (url === "/api/account/sessions") return { sessions: [] };
      if (url === "/api/account/api-tokens") return { tokens: [] };
      if (url === "/api/account/webhooks" && init?.method === "POST") {
        return {
          webhook: {
            id: "wh-1",
            url: "https://example.com/hook",
            events: ["job.succeeded", "job.failed"],
            enabled: true,
            lastDeliveryAt: null,
            lastDeliveryStatus: null,
            createdAt: "2026-01-01T00:00:00.000Z"
          },
          secret: "whsec_smoke-secret"
        };
      }
      if (url === "/api/account/webhooks") return { webhooks: [] };
      return { reauthRequired: true };
    });

    render(<AccountSecurity user={user} />);
    await event.type(screen.getByLabelText("回调地址"), "https://example.com/hook");
    await event.click(screen.getByRole("button", { name: "创建 Webhook" }));

    expect(await screen.findByText("whsec_smoke-secret")).toBeInTheDocument();
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/account/webhooks",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("deletes the account after password confirmation", async () => {
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/account/2fa") return { enabled: false, recoveryCodesRemaining: 0 };
      if (url === "/api/account/sessions") return { sessions: [] };
      if (url === "/api/account/api-tokens") return { tokens: [] };
      if (url === "/api/account" && init?.method === "DELETE") return { deleted: true };
      return { reauthRequired: true };
    });
    const event = userEvent.setup();
    render(<AccountSecurity user={user} />);

    await event.click(screen.getByRole("button", { name: "注销账号" }));
    await event.type(screen.getByLabelText("输入当前密码以确认"), "CurrentPass1");
    await event.click(screen.getByRole("button", { name: "永久注销" }));

    await waitFor(() =>
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        "/api/account",
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ password: "CurrentPass1" })
        })
      )
    );
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: "/login?expired=1" });
  });

  it("submits the change and signs out into a fresh login", async () => {
    const event = userEvent.setup();
    render(<AccountSecurity user={user} />);

    await fill(event);
    await event.click(screen.getByRole("button", { name: /更新密码/ }));

    await waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith(
        "/api/account/password",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            currentPassword: "CurrentPass1",
            newPassword: "NextPass123"
          })
        })
      );
    });
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: "/login?expired=1" });
  });

  it("shows the server error and stays on the page when the API rejects", async () => {
    mocks.apiFetch.mockImplementation(async (url: string) => {
      if (url === "/api/account/password") {
        throw new Error("当前密码不正确。");
      }
      if (url === "/api/account/2fa") {
        return { enabled: false, recoveryCodesRemaining: 0 };
      }
      return { sessions: [] };
    });
    const event = userEvent.setup();
    render(<AccountSecurity user={user} />);

    await fill(event);
    await event.click(screen.getByRole("button", { name: /更新密码/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("当前密码不正确");
    expect(signOutMock).not.toHaveBeenCalled();
  });
});
