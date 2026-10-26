import { normalizeLocale, type Locale } from "./core";

/**
 * Client-side localization of API error codes.
 *
 * The server returns stable `code` values plus Chinese `error` messages. In
 * English mode we prefer a translated message per code; unknown codes fall back
 * to the server message so no information is lost.
 */

const EN_BY_CODE: Record<string, string> = {
  AUTH_REQUIRED: "Please sign in to use the platform.",
  FORBIDDEN: "You do not have permission to perform this action.",
  NOT_FOUND: "The requested resource was not found.",
  VALIDATION_ERROR: "The submitted data is invalid.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  JOB_QUOTA_EXCEEDED: "Too many active jobs. Wait for one to finish before submitting another.",
  JOB_NOT_CANCELLABLE: "This job has already finished and cannot be cancelled.",
  JOB_NOT_RETRYABLE: "Only failed or cancelled jobs can be retried.",
  JOB_NOT_APPROVABLE: "This job does not need approval or cannot be approved now.",
  COST_BUDGET_EXCEEDED: "The monthly AI budget is exhausted. Contact an admin or wait for the next month.",
  LAST_ADMIN: "At least one active admin must remain.",
  CANNOT_MODIFY_SELF: "You cannot disable or demote the signed-in admin.",
  PAYLOAD_TOO_LARGE: "The request payload is too large.",
  UNSUPPORTED_MEDIA_TYPE: "Unsupported file or content type.",
  EMAIL_TAKEN: "This email is already registered.",
  STORAGE_QUOTA_EXCEEDED: "Storage quota exceeded.",
  CONFLICT: "The resource is in a conflicting state.",
  INTERNAL_ERROR: "Something went wrong on the server.",
  NETWORK_ERROR: "Network request failed. Check your connection and retry."
};

export function localizeErrorCode(locale: Locale, code: string): string | undefined {
  return locale === "en" ? EN_BY_CODE[code] : undefined;
}

/** Read `studio_locale` without React (used by non-component helpers). */
export function getClientLocale(): Locale {
  if (typeof document === "undefined") {
    return "zh";
  }
  const match = /(?:^|;\s*)studio_locale=([^;]+)/.exec(document.cookie);
  return normalizeLocale(match?.[1]);
}
