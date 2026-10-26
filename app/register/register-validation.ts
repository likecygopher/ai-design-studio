/**
 * Client-side password policy for registration (SPEC R8.1 / constitution §4).
 * The server enforces the same rule; validating here keeps the failure fast
 * and lets us show a precise, friendly hint.
 */
export const PASSWORD_RULE_HINT = "8 位以上，含字母与数字。";

export const PASSWORD_MAX_LENGTH = 72;

export function validatePassword(value: string): string | undefined {
  if (value.length < 8) {
    return "密码至少 8 位。";
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `密码不能超过 ${PASSWORD_MAX_LENGTH} 位。`;
  }
  if (!/[A-Za-z]/.test(value)) {
    return "密码需至少包含一个字母。";
  }
  if (!/\d/.test(value)) {
    return "密码需至少包含一个数字。";
  }
  return undefined;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | undefined {
  if (!value.trim()) {
    return "请输入邮箱。";
  }
  if (!EMAIL_PATTERN.test(value.trim())) {
    return "请输入有效邮箱。";
  }
  return undefined;
}
