import { prisma } from "@/src/platform/db";
import { recordAudit } from "@/src/platform/audit";
import { ApiError, NotFoundError } from "@/src/platform/errors";
import { decryptSecret, encryptSecret } from "@/src/platform/secrets";
import {
  buildOtpauthUri,
  consumeRecoveryCode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp
} from "@/src/platform/totp";

/** TOTP 2FA lifecycle and login-time verification. */

const ISSUER = "Midea AI Content Studio";
const RECOVERY_CODE_COUNT = 8;

export type TwoFactorStatus = {
  enabled: boolean;
  recoveryCodesRemaining: number;
};

type TwoFactorRow = {
  id: string;
  email: string;
  totpEnabled: boolean;
  totpSecret: string | null;
  totpRecoveryCodes: unknown;
};

function recoveryHashes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function decryptOrThrow(cipher: string | null): string {
  if (!cipher) {
    throw new ApiError(400, "VALIDATION_ERROR", "尚未开始两步验证设置。");
  }
  return decryptSecret(cipher);
}

export async function getTwoFactorStatus(userId: string): Promise<TwoFactorStatus> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabled: true, totpRecoveryCodes: true }
  });
  if (!row) {
    throw new NotFoundError("用户不存在。");
  }
  return {
    enabled: row.totpEnabled,
    recoveryCodesRemaining: recoveryHashes(row.totpRecoveryCodes).length
  };
}

/** Generate a pending secret and return the otpauth URI for the authenticator app. */
export async function beginTwoFactorSetup(
  userId: string
): Promise<{ secret: string; otpauthUri: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, totpEnabled: true }
  });
  if (!user) {
    throw new NotFoundError("用户不存在。");
  }
  if (user.totpEnabled) {
    throw new ApiError(409, "CONFLICT", "两步验证已启用，请先停用后再重新设置。");
  }

  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: encryptSecret(secret), totpEnabled: false }
  });
  await recordAudit({
    action: "account.2fa_setup",
    userId,
    targetType: "user",
    targetId: userId
  });

  return {
    secret,
    otpauthUri: buildOtpauthUri({ secret, account: user.email, issuer: ISSUER })
  };
}

/** Verify the pending secret, enable 2FA and return one-time recovery codes. */
export async function enableTwoFactor(
  userId: string,
  code: string
): Promise<{ recoveryCodes: string[] }> {
  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, totpEnabled: true, totpSecret: true }
  })) as TwoFactorRow | null;
  if (!user) {
    throw new NotFoundError("用户不存在。");
  }
  if (user.totpEnabled) {
    throw new ApiError(409, "CONFLICT", "两步验证已启用。");
  }
  if (!verifyTotp(decryptOrThrow(user.totpSecret), code)) {
    throw new ApiError(400, "VALIDATION_ERROR", "验证码不正确，请确认手机时间后重试。");
  }

  const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  await prisma.user.update({
    where: { id: userId },
    data: {
      totpEnabled: true,
      totpRecoveryCodes: recoveryCodes.map(hashRecoveryCode)
    }
  });
  await recordAudit({
    action: "account.2fa_enable",
    userId,
    targetType: "user",
    targetId: userId,
    metadata: { recoveryCodes: recoveryCodes.length }
  });

  return { recoveryCodes };
}

export async function disableTwoFactor(
  userId: string,
  code: string
): Promise<void> {
  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, totpEnabled: true, totpSecret: true, totpRecoveryCodes: true }
  })) as TwoFactorRow | null;
  if (!user) {
    throw new NotFoundError("用户不存在。");
  }
  if (!user.totpEnabled) {
    throw new ApiError(400, "VALIDATION_ERROR", "两步验证尚未启用。");
  }
  if (!(await verifyTwoFactorRow(user, code))) {
    throw new ApiError(400, "VALIDATION_ERROR", "验证码或恢复码不正确。");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { totpEnabled: false, totpSecret: null, totpRecoveryCodes: [] }
  });
  await recordAudit({
    action: "account.2fa_disable",
    userId,
    targetType: "user",
    targetId: userId
  });
}

export async function regenerateRecoveryCodes(
  userId: string,
  code: string
): Promise<{ recoveryCodes: string[] }> {
  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, totpEnabled: true, totpSecret: true, totpRecoveryCodes: true }
  })) as TwoFactorRow | null;
  if (!user) {
    throw new NotFoundError("用户不存在。");
  }
  if (!user.totpEnabled) {
    throw new ApiError(400, "VALIDATION_ERROR", "两步验证尚未启用。");
  }
  if (!(await verifyTwoFactorRow(user, code))) {
    throw new ApiError(400, "VALIDATION_ERROR", "验证码或恢复码不正确。");
  }

  const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  await prisma.user.update({
    where: { id: userId },
    data: { totpRecoveryCodes: recoveryCodes.map(hashRecoveryCode) }
  });
  await recordAudit({
    action: "account.2fa_recovery_regenerate",
    userId,
    targetType: "user",
    targetId: userId
  });
  return { recoveryCodes };
}

/** Login-time check: TOTP code first, then a one-time recovery code. */
export async function verifySecondFactorByUserId(
  userId: string,
  code: string
): Promise<boolean> {
  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, totpEnabled: true, totpSecret: true, totpRecoveryCodes: true }
  })) as TwoFactorRow | null;
  if (!user) {
    return false;
  }
  return verifyTwoFactorRow(user, code);
}

async function verifyTwoFactorRow(user: TwoFactorRow, code: string): Promise<boolean> {
  if (!user.totpEnabled) {
    return true;
  }
  const trimmed = code.trim();
  if (!trimmed) {
    return false;
  }

  if (user.totpSecret) {
    try {
      if (verifyTotp(decryptSecret(user.totpSecret), trimmed)) {
        return true;
      }
    } catch {
      // Fall through to recovery codes for corrupted/missing secrets.
    }
  }

  const hashes = recoveryHashes(user.totpRecoveryCodes);
  const consumed = consumeRecoveryCode(hashes, trimmed);
  if (!consumed.ok) {
    return false;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { totpRecoveryCodes: consumed.remaining }
  });
  await recordAudit({
    action: "account.recovery_code_used",
    userId: user.id,
    targetType: "user",
    targetId: user.id,
    metadata: { remaining: consumed.remaining.length }
  });
  return true;
}
