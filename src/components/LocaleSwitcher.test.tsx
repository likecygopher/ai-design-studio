import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/src/i18n/I18nProvider";
import { LocaleSwitcher } from "./LocaleSwitcher";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  refresh.mockReset();
  document.cookie = "studio_locale=; max-age=0; path=/";
});

describe("LocaleSwitcher", () => {
  it("marks the active locale and persists the choice in a cookie", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider locale="zh">
        <LocaleSwitcher />
      </I18nProvider>
    );

    const group = screen.getByRole("group");
    expect(group).toHaveAccessibleName("切换语言");
    expect(screen.getByRole("button", { name: "中文" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await user.click(screen.getByRole("button", { name: "EN" }));

    expect(document.cookie).toContain("studio_locale=en");
    expect(refresh).toHaveBeenCalled();
  });

  it("renders English labels when the provider locale is en", () => {
    render(
      <I18nProvider locale="en">
        <LocaleSwitcher />
      </I18nProvider>
    );
    expect(screen.getByRole("group")).toHaveAccessibleName("Switch language");
    expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
