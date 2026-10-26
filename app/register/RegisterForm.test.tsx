import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signIn } from "next-auth/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { RegisterForm } from "./RegisterForm";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: navigation.replace,
    refresh: navigation.refresh,
    push: vi.fn()
  })
}));

const signInMock = signIn as unknown as Mock;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function renderForm() {
  return render(<RegisterForm />);
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  values: { email?: string; name?: string; password?: string; confirmPassword?: string } = {}
) {
  const {
    email = "new-user@midea.com",
    name = "New User",
    password = "passw0rd",
    confirmPassword = password
  } = values;
  await user.type(screen.getByLabelText("邮箱"), email);
  if (name) await user.type(screen.getByLabelText("昵称（可选）"), name);
  await user.type(screen.getByLabelText("密码"), password);
  await user.type(screen.getByLabelText("确认密码"), confirmPassword);
}

beforeEach(() => {
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
  signInMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RegisterForm", () => {
  it("shows the password policy and links back to login", () => {
    renderForm();

    expect(screen.getByText(/8 位以上，含字母与数字/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去登录" })).toHaveAttribute("href", "/login");
  });

  it("rejects a password shorter than 8 characters without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderForm();

    await fillForm(user, { password: "abc123", confirmPassword: "abc123" });
    await user.click(screen.getByRole("button", { name: "创建账号并登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("密码至少 8 位。");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("rejects a password without a digit or without a letter", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderForm();

    await fillForm(user, { password: "abcdefgh", confirmPassword: "abcdefgh" });
    await user.click(screen.getByRole("button", { name: "创建账号并登录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("密码需至少包含一个数字。");

    await user.clear(screen.getByLabelText("密码"));
    await user.clear(screen.getByLabelText("确认密码"));
    await user.type(screen.getByLabelText("密码"), "12345678");
    await user.type(screen.getByLabelText("确认密码"), "12345678");
    await user.click(screen.getByRole("button", { name: "创建账号并登录" }));
    expect(await screen.findByText("密码需至少包含一个字母。")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirmation passwords", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderForm();

    await fillForm(user, { password: "passw0rd", confirmPassword: "passw0rd2" });
    await user.click(screen.getByRole("button", { name: "创建账号并登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("两次输入的密码不一致。");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("registers, signs in automatically and redirects to the studio home", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ user: { id: "u1" } }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderForm();

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "创建账号并登录" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/studio-home"));
    expect(navigation.refresh).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/register");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "new-user@midea.com",
      password: "passw0rd",
      name: "New User"
    });
    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: "new-user@midea.com",
      password: "passw0rd",
      redirect: false
    });
  });

  it("shows the server message with its request id and stays on the form", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        { error: "该邮箱已注册，请直接登录。", code: "EMAIL_TAKEN", requestId: "req-abc" },
        409
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderForm();

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "创建账号并登录" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("该邮箱已注册，请直接登录。");
    expect(alert).toHaveTextContent("请求编号：req-abc");
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("邮箱")).toBeInTheDocument();
  });

  it("keeps the submit button disabled while the request is in flight", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderForm();

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "创建账号并登录" }));

    const pending = await screen.findByRole("button", { name: "注册中..." });
    expect(pending).toBeDisabled();

    resolveFetch?.(jsonResponse({ user: { id: "u1" } }, 201));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/studio-home"));
  });
});
