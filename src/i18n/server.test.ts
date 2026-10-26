// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.get })
}));

import { getLocale } from "./server";

beforeEach(() => {
  mocks.get.mockReset();
});

describe("getLocale", () => {
  it("reads the locale cookie", async () => {
    mocks.get.mockReturnValue({ name: "studio_locale", value: "en" });
    await expect(getLocale()).resolves.toBe("en");
  });

  it("defaults to Chinese when the cookie is missing or invalid", async () => {
    mocks.get.mockReturnValue(undefined);
    await expect(getLocale()).resolves.toBe("zh");
    mocks.get.mockReturnValue({ name: "studio_locale", value: "fr" });
    await expect(getLocale()).resolves.toBe("zh");
  });
});
