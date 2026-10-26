import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signIn } from "next-auth/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { LoginForm } from "./LoginForm";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  params: new URLSearchParams()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: navigation.replace,
    refresh: navigation.refresh,
    push: navigation.push
  }),
  useSearchParams: () => navigation.params
}));

const signInMock = signIn as unknown as Mock;

beforeEach(() => {
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
  navigation.push.mockReset();
  navigation.params = new URLSearchParams();
  signInMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function login(user: ReturnType<typeof userEvent.setup>, email = "user@midea.com", password = "passw0rd") {
  await user.type(screen.getByLabelText("邮箱"), email);
  await user.type(screen.getByLabelText("密码"), password);
  await user.click(screen.getByRole("button", { name: "进入工作台" }));
}

describe("LoginForm", () => {
  it("does not pre-fill demo credentials outside development", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText("邮箱")).toHaveValue("");
    expect(screen.getByLabelText("密码")).toHaveValue("");
    expect(screen.queryByText(/demo@midea\.local/)).not.toBeInTheDocument();
  });

  it("signs in and redirects to the studio home", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await login(user);

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/studio-home"));
    expect(navigation.refresh).toHaveBeenCalled();
    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: "user@midea.com",
      password: "passw0rd",
      redirect: false
    });
  });

  it("honours the callbackUrl when present", async () => {
    navigation.params = new URLSearchParams("callbackUrl=/jobs");
    const user = userEvent.setup();
    render(<LoginForm />);

    await login(user);

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/jobs"));
  });

  it("shows a friendly error and stays on the page when credentials fail", async () => {
    signInMock.mockResolvedValueOnce({ error: "CredentialsSignin" });
    const user = userEvent.setup();
    render(<LoginForm />);

    await login(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("邮箱、密码或两步验证码不正确。");
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("邮箱")).toBeInTheDocument();
  });

  it("validates empty credentials before calling signIn", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: "进入工作台" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("请输入邮箱和密码。");
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("switches to the shared register form and links to the standalone register page", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    expect(screen.getByRole("link", { name: "创建账号" })).toHaveAttribute("href", "/register");
    await user.click(screen.getByRole("button", { name: "注册" }));

    expect(screen.getByLabelText("确认密码")).toBeInTheDocument();
    expect(screen.getByText(/8 位以上，含字母与数字/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建账号并登录" })).toBeInTheDocument();
    expect(signInMock).not.toHaveBeenCalled();
  });
});
