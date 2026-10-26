import { NextResponse } from "next/server";
import { isProduction } from "@/src/platform/config";
import { ApiError } from "@/src/platform/errors";
import { logger } from "@/src/platform/logger";

export type ErrorBody = {
  error: string;
  code: string;
  requestId?: string;
  details?: unknown;
};

export type ErrorResponseOptions =
  | number
  | {
      fallbackStatus?: number;
      requestId?: string;
    };

function normalizeOptions(options: ErrorResponseOptions): {
  fallbackStatus: number;
  requestId?: string;
} {
  if (typeof options === "number") {
    return { fallbackStatus: options };
  }
  return {
    fallbackStatus: options.fallbackStatus ?? 500,
    requestId: options.requestId
  };
}

/** Legacy error classes kept for backward compatibility (auth/jobs modules). */
function legacyCode(name: string | undefined): { status: number; code: string } | undefined {
  if (name === "AuthRequiredError") {
    return { status: 401, code: "AUTH_REQUIRED" };
  }
  if (name === "JobQuotaError") {
    return { status: 429, code: "JOB_QUOTA_EXCEEDED" };
  }
  return undefined;
}

/**
 * Map any thrown value to the unified error response contract.
 *
 * `{ error, code, requestId, details? }` — `error` stays a string so existing
 * frontend code that reads `payload.error` keeps working.
 */
export function toErrorResponse(
  error: unknown,
  options: ErrorResponseOptions = 500
): NextResponse<ErrorBody> {
  const { fallbackStatus, requestId } = normalizeOptions(options);

  let status = fallbackStatus;
  let code = "INTERNAL_ERROR";
  let message = "服务器错误，请稍后重试。";
  let details: unknown;

  if (error instanceof ApiError) {
    status = error.status;
    code = error.code;
    message = error.expose ? error.message : "服务器错误，请稍后重试。";
    details = error.details;
    if (!error.expose && isProduction()) {
      message = "服务器错误，请稍后重试。";
    }
  } else {
    const legacy = legacyCode(error instanceof Error ? error.name : undefined);
    if (legacy) {
      status = legacy.status;
      code = legacy.code;
      message = error instanceof Error ? error.message : message;
    } else if (error instanceof Error) {
      // Unknown errors: never leak internals in production.
      message = isProduction() ? message : error.message || message;
    }
  }

  const body: ErrorBody = { error: message, code };
  if (requestId) {
    body.requestId = requestId;
  }
  if (details !== undefined) {
    body.details = details;
  }

  const response = NextResponse.json(body, { status });
  if (requestId) {
    response.headers.set("x-request-id", requestId);
  }
  if (status === 429 && error instanceof ApiError && error.code === "RATE_LIMITED") {
    const retryAfter = (error as ApiError & { retryAfterSec?: number }).retryAfterSec;
    response.headers.set("retry-after", String(retryAfter ?? 60));
  }

  if (status >= 500) {
    logger.error("api.error", error, { requestId, code, status });
  }

  return response;
}
