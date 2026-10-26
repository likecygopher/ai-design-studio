// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  recordAudit: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: { user: { findUnique: mocks.findUnique, update: mocks.update } }
}));

vi.mock("@/src/platform/audit", () => ({ recordAudit: mocks.recordAudit }));

vi.mock("@/src/platform/logger", () => {
  const noop = () => undefined;
  const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  return { logger, createLogger: () => logger };
});

import { decryptSecret, encryptSecret } from "./secrets";
import { generateRecoveryCodes, hashRecoveryCode, generateTotp } from "./totp";
import {
  beginTwoFactorSetup,
  disableTwoFactor,
  enableTwoFactor,
  getTwoFactorStatus,
  regenerateRecoveryCodes,
  verifySecondFactorByUserId
} from "./two-factor";

beforeEach(() => {
  mocks.findUnique.mockReset();
  mocks.update.mockReset().mockResolvedValue({});
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
});

describe("beginTwoFactorSetup", () => {
  it("stores an encrypted pending secret and returns the otpauth URI", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "user-1",
      email: "demo@midea.local",
      totpEnabled: false
    });

    const result = await beginTwoFactorSetup("user-1");

    expect(result.secret).toMatch(/^[A-Z2-7]+$/);
    expect(result.otpauthUri).toContain("otpauth://totp/");
    const written = mocks.update.mock.calls[0][0].data;
    expect(written.totpSecret.startsWith("enc:v1:")).toBe(true);
    expect(decryptSecret(written.totpSecret)).toBe(result.secret);
    expect(written.totpEnabled).toBe(false);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account.2fa_setup" })
    );
  });

  it("refuses when 2FA is already enabled", async () => {
    mocks.findUnique.mockResolvedValue({ id: "user-1", email: "u@x", totpEnabled: true });
    await expect(beginTwoFactorSetup("user-1")).rejects.toMatchObject({ status: 409 });
  });
});

describe("enableTwoFactor", () => {
  it("verifies the pending secret and stores hashed recovery codes", async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    mocks.findUnique.mockResolvedValue({
      id: "user-1",
      totpEnabled: false,
      totpSecret: encryptSecret(secret),
      totpRecoveryCodes: []
    });

    const code = generateTotp(secret);
    const result = await enableTwoFactor("user-1", code);

    expect(result.recoveryCodes).toHaveLength(8);
    const written = mocks.update.mock.calls[0][0].data;
    expect(written.totpEnabled).toBe(true);
    expect(written.totpRecoveryCodes).toHaveLength(8);
    expect(written.totpRecoveryCodes).not.toContain(result.recoveryCodes[0]);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account.2fa_enable" })
    );
  });

  it("rejects an invalid code", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "user-1",
      totpEnabled: false,
      totpSecret: encryptSecret("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"),
      totpRecoveryCodes: []
    });
    await expect(enableTwoFactor("user-1", "000000")).rejects.toMatchObject({ status: 400 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("verifySecondFactorByUserId", () => {
  it("accepts a TOTP code and consumes a recovery code only once", async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const codes = generateRecoveryCodes(2);
    const row = {
      id: "user-1",
      totpEnabled: true,
      totpSecret: encryptSecret(secret),
      totpRecoveryCodes: codes.map(hashRecoveryCode)
    };
    mocks.findUnique.mockResolvedValue(row);

    expect(await verifySecondFactorByUserId("user-1", generateTotp(secret))).toBe(true);
    expect(await verifySecondFactorByUserId("user-1", "000000")).toBe(false);

    expect(await verifySecondFactorByUserId("user-1", codes[0])).toBe(true);
    const remaining = mocks.update.mock.calls.at(-1)?.[0].data.totpRecoveryCodes;
    expect(remaining).toHaveLength(1);
    expect(remaining).not.toContain(hashRecoveryCode(codes[0]));
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account.recovery_code_used" })
    );
  });
});

describe("disableTwoFactor / regenerateRecoveryCodes", () => {
  it("disables 2FA after a valid code", async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    mocks.findUnique.mockResolvedValue({
      id: "user-1",
      totpEnabled: true,
      totpSecret: encryptSecret(secret),
      totpRecoveryCodes: []
    });

    await disableTwoFactor("user-1", generateTotp(secret));
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({
      totpEnabled: false,
      totpSecret: null,
      totpRecoveryCodes: []
    });
  });

  it("regenerates recovery codes after verification", async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    mocks.findUnique.mockResolvedValue({
      id: "user-1",
      totpEnabled: true,
      totpSecret: encryptSecret(secret),
      totpRecoveryCodes: []
    });

    const result = await regenerateRecoveryCodes("user-1", generateTotp(secret));
    expect(result.recoveryCodes).toHaveLength(8);
  });
});

describe("getTwoFactorStatus", () => {
  it("reports enabled state and remaining recovery codes", async () => {
    mocks.findUnique.mockResolvedValue({ totpEnabled: true, totpRecoveryCodes: ["a", "b"] });
    await expect(getTwoFactorStatus("user-1")).resolves.toEqual({
      enabled: true,
      recoveryCodesRemaining: 2
    });
  });
});
