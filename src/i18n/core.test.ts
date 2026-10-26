// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  normalizeLocale,
  translate
} from "./core";

describe("i18n core", () => {
  it("normalizes unknown locales to Chinese", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("zh")).toBe("zh");
    expect(normalizeLocale("fr")).toBe("zh");
    expect(normalizeLocale(undefined)).toBe("zh");
    expect(normalizeLocale(null)).toBe("zh");
    expect(DEFAULT_LOCALE).toBe("zh");
  });

  it("translates with interpolation and falls back to Chinese", () => {
    expect(translate("zh", "nav.home")).toBe("首页");
    expect(translate("en", "nav.home")).toBe("Home");
    expect(translate("en", "account.lastActive", { time: "10:00" })).toBe(
      "Last active 10:00"
    );
    expect(translate("en", "missing.key")).toBe("missing.key");
    expect(translate("zh", "shell.roleTitle", { role: "管理员", code: "admin" })).toBe(
      "当前角色：管理员（admin）"
    );
  });

  it("keeps both dictionaries aligned for every key", () => {
    for (const key of ["nav.adminAi", "auth.submit", "account.twoFactor", "common.save"]) {
      expect(translate("zh", key)).not.toBe(key);
      expect(translate("en", key)).not.toBe(key);
    }
  });
});
