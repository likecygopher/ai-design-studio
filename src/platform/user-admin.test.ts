import { describe, expect, it } from "vitest";
import {
  ADMIN_USER_BASE_SELECT,
  USER_ROLES,
  createAdminUserSchema,
  generateTemporaryPassword,
  passwordPolicySchema,
  selfPasswordSchema,
  toAdminUserView,
  updateAdminUserSchema
} from "./user-admin";

describe("password policy", () => {
  it("accepts compliant passwords", () => {
    for (const password of ["abcdefg1", "A1bcdefg", "MyP@ssw0rd"]) {
      expect(passwordPolicySchema.safeParse(password).success).toBe(true);
    }
  });

  it("rejects short, long, letter-only and digit-only passwords", () => {
    for (const password of ["a1", "abcdefgh", "12345678", "a".repeat(73)]) {
      expect(passwordPolicySchema.safeParse(password).success).toBe(false);
    }
  });
});

describe("generateTemporaryPassword", () => {
  it("always satisfies the password policy", () => {
    for (let i = 0; i < 25; i += 1) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(16);
      expect(passwordPolicySchema.safeParse(password).success).toBe(true);
    }
  });

  it("respects clamped lengths and avoids ambiguous characters", () => {
    expect(generateTemporaryPassword(2)).toHaveLength(8);
    expect(generateTemporaryPassword(999)).toHaveLength(72);
    const sample = Array.from({ length: 20 }, () => generateTemporaryPassword()).join("");
    expect(sample).not.toMatch(/[0OIl1]/);
  });

  it("produces different passwords across calls", () => {
    const values = new Set(Array.from({ length: 50 }, () => generateTemporaryPassword()));
    expect(values.size).toBeGreaterThan(45);
  });
});

describe("schemas", () => {
  it("normalises email and applies the default role", () => {
    const parsed = createAdminUserSchema.parse({ email: "  Mixed@Example.COM " });
    expect(parsed).toEqual({ email: "mixed@example.com", role: "user" });
  });

  it("rejects unknown roles", () => {
    expect(createAdminUserSchema.safeParse({ email: "a@b.com", role: "owner" }).success).toBe(false);
    expect(USER_ROLES).toEqual(["user", "admin"]);
  });

  it("requires at least one field for updates", () => {
    expect(updateAdminUserSchema.safeParse({}).success).toBe(false);
    expect(updateAdminUserSchema.safeParse({ disabled: true }).success).toBe(true);
    expect(updateAdminUserSchema.safeParse({ name: null }).success).toBe(true);
  });

  it("validates the self-service change payload", () => {
    expect(
      selfPasswordSchema.safeParse({ currentPassword: "old", newPassword: "NewPass123" }).success
    ).toBe(true);
    expect(
      selfPasswordSchema.safeParse({ currentPassword: "", newPassword: "NewPass123" }).success
    ).toBe(false);
  });
});

describe("toAdminUserView", () => {
  it("serialises dates and keeps counts optional", () => {
    const row = {
      id: "u1",
      email: "u1@example.com",
      name: null,
      role: "admin",
      disabled: true,
    monthlyBudgetUnits: null,
    requiresJobApproval: false,
    planId: null,
    planName: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z")
    };

    expect(toAdminUserView(row)).toEqual({
      id: "u1",
      email: "u1@example.com",
      name: null,
      role: "admin",
      disabled: true,
    monthlyBudgetUnits: null,
    requiresJobApproval: false,
    planId: null,
    planName: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    });
    expect(ADMIN_USER_BASE_SELECT).toMatchObject({ disabled: true });
  });
});
