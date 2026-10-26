import { describe, expect, it, vi } from "vitest";
import {
  PLATFORM_CONFIG,
  assertRuntimeConfig,
  describeRuntimeConfig,
  getAuthSecret
} from "./config";

describe("PLATFORM_CONFIG", () => {
  it("exposes numeric limits with safe defaults", () => {
    expect(typeof PLATFORM_CONFIG.jobConcurrency).toBe("number");
    expect(PLATFORM_CONFIG.jobConcurrency).toBeGreaterThan(0);
    expect(PLATFORM_CONFIG.maxUserActiveJobs).toBeGreaterThan(0);
    expect(PLATFORM_CONFIG.jobLockMs).toBeGreaterThan(0);
    expect(PLATFORM_CONFIG.maxUploadBytes).toBeGreaterThan(0);
    expect(PLATFORM_CONFIG.maxFilesPerRequest).toBeGreaterThan(0);
    expect(PLATFORM_CONFIG.userStorageQuotaBytes).toBeGreaterThan(PLATFORM_CONFIG.maxUploadBytes);
  });

  it("keeps bcrypt cost inside the safe range", () => {
    expect(PLATFORM_CONFIG.bcryptCost).toBeGreaterThanOrEqual(10);
    expect(PLATFORM_CONFIG.bcryptCost).toBeLessThanOrEqual(15);
  });

  it("keeps retry policy bounded", () => {
    expect(PLATFORM_CONFIG.jobRetryBaseMs).toBeGreaterThan(0);
    expect(PLATFORM_CONFIG.jobRetryMaxMs).toBeGreaterThanOrEqual(PLATFORM_CONFIG.jobRetryBaseMs);
  });
});

describe("getAuthSecret", () => {
  it("returns the configured secret", () => {
    vi.stubEnv("AUTH_SECRET", "x".repeat(40));
    expect(getAuthSecret()).toHaveLength(40);
    vi.unstubAllEnvs();
  });

  it("throws a helpful error when missing", () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => getAuthSecret()).toThrow(/AUTH_SECRET is required/);
    vi.unstubAllEnvs();
  });
});

describe("describeRuntimeConfig", () => {
  it("never includes secrets", () => {
    const summary = describeRuntimeConfig();
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toMatch(/AUTH_SECRET/i);
    expect(serialized).not.toMatch(/DATABASE_URL/i);
    expect(summary).toMatchObject({ nodeEnv: expect.any(String) });
  });
});

describe("assertRuntimeConfig", () => {
  it("does not throw outside production", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => assertRuntimeConfig()).not.toThrow();
    vi.restoreAllMocks();
  });
});
