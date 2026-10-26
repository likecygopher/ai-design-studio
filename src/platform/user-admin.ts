/**
 * Admin account-management primitives (CHG-2026-10-26-ACCOUNT-ADMIN, R11/R12).
 *
 * Kept free of HTTP/Next.js concerns so schemas, password generation and view
 * mapping can be unit tested and reused by both admin and self-service routes.
 */
import { randomInt } from "node:crypto";
import { z } from "zod";

export const USER_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const userRoleSchema = z.enum(USER_ROLES, {
  message: "角色只能是 user 或 admin。"
});

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
export const TEMPORARY_PASSWORD_LENGTH = 16;

/** Password policy shared by create / admin reset / self-service change. */
export const passwordPolicySchema = z
  .string({ error: "请输入密码。" })
  .min(PASSWORD_MIN_LENGTH, "密码至少 8 位。")
  .max(PASSWORD_MAX_LENGTH, "密码最多 72 位。")
  .regex(/[A-Za-z]/, "密码必须包含字母。")
  .regex(/\d/, "密码必须包含数字。");

export const createAdminUserSchema = z.object({
  email: z
    .string({ error: "请输入邮箱。" })
    .trim()
    .toLowerCase()
    .email("请输入有效邮箱。")
    .max(254, "邮箱过长。"),
  password: passwordPolicySchema.optional(),
  name: z.string().trim().min(1, "昵称不能为空。").max(80, "昵称最多 80 字。").optional(),
  role: userRoleSchema.default("user")
});

export const updateAdminUserSchema = z
  .object({
    name: z.string().trim().min(1).max(80).nullable().optional(),
    role: userRoleSchema.optional(),
    disabled: z.boolean().optional(),
    /// null = platform default; 0 = unlimited; positive = monthly unit budget.
    monthlyBudgetUnits: z.number().int().min(0).max(1_000_000).nullable().optional(),
    /// When true, this user's new jobs wait for admin approval.
    requiresJobApproval: z.boolean().optional(),
    /// Commercial plan assignment; null clears it.
    planId: z.string().trim().min(1).max(64).nullable().optional()
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.role !== undefined ||
      value.disabled !== undefined ||
      value.monthlyBudgetUnits !== undefined ||
      value.requiresJobApproval !== undefined ||
      value.planId !== undefined,
    { message: "至少提供一个要修改的字段。" }
  );

export const resetUserPasswordSchema = z.object({
  password: passwordPolicySchema.optional()
});

export const selfPasswordSchema = z.object({
  currentPassword: z.string({ error: "请输入当前密码。" }).min(1).max(200),
  newPassword: passwordPolicySchema
});

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%*_-";
const ALL = LETTERS + DIGITS + SYMBOLS;

function pick(alphabet: string): string {
  return alphabet[randomInt(0, alphabet.length)];
}

/**
 * Generate a one-time password that satisfies the policy and is readable enough
 * to be typed from a screen: excludes ambiguous 0/O/1/l/I characters.
 */
export function generateTemporaryPassword(length = TEMPORARY_PASSWORD_LENGTH): string {
  const safeLength = Math.max(PASSWORD_MIN_LENGTH, Math.min(PASSWORD_MAX_LENGTH, length));
  const chars = [pick(LETTERS), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < safeLength) {
    chars.push(pick(ALL));
  }
  // Fisher-Yates so the guaranteed classes are not always at the front.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export type AdminUserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  disabled: boolean;
  monthlyBudgetUnits?: number | null;
  requiresJobApproval?: boolean;
  planId?: string | null;
  plan?: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { products: number; assets: number; jobs: number };
};

export type AdminUserView = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  disabled: boolean;
  monthlyBudgetUnits: number | null;
  requiresJobApproval: boolean;
  planId: string | null;
  planName: string | null;
  createdAt: string;
  updatedAt: string;
  counts?: { products: number; assets: number; jobs: number };
};

export function toAdminUserView(row: AdminUserRow): AdminUserView {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    disabled: row.disabled,
    monthlyBudgetUnits: row.monthlyBudgetUnits ?? null,
    requiresJobApproval: row.requiresJobApproval ?? false,
    planId: row.planId ?? null,
    planName: row.plan?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row._count
      ? {
          counts: {
            products: row._count.products,
            assets: row._count.assets,
            jobs: row._count.jobs
          }
        }
      : {})
  };
}

export const ADMIN_USER_BASE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  disabled: true,
  monthlyBudgetUnits: true,
  requiresJobApproval: true,
  planId: true,
  plan: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true
} as const;

export const ADMIN_USER_LIST_SELECT = {
  ...ADMIN_USER_BASE_SELECT,
  _count: { select: { products: true, assets: true, jobs: true } }
} as const;
