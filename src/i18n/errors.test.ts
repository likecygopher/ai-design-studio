// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { getClientLocale, localizeErrorCode } from "./errors";

afterEach(() => {
  document.cookie = "studio_locale=; max-age=0; path=/";
});

describe("error localization", () => {
  it("maps known codes only in English mode", () => {
    expect(localizeErrorCode("en", "COST_BUDGET_EXCEEDED")).toContain("budget");
    expect(localizeErrorCode("en", "UNKNOWN_CODE")).toBeUndefined();
    expect(localizeErrorCode("zh", "COST_BUDGET_EXCEEDED")).toBeUndefined();
  });

  it("reads the locale cookie", () => {
    expect(getClientLocale()).toBe("zh");
    document.cookie = "studio_locale=en; path=/";
    expect(getClientLocale()).toBe("en");
  });
});
