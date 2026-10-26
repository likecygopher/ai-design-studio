/**
 * Central error taxonomy for the platform.
 *
 * Contract (see docs/sdd/specs/2026-10-26-commercial-platform/design.md §3):
 * every API error response is `{ error, code, requestId, details? }` where
 * `error` remains a human-readable string for backward compatibility with the
 * existing frontend (`payload.error`).
 */

export type ErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "JOB_QUOTA_EXCEEDED"
  | "JOB_NOT_CANCELLABLE"
  | "JOB_NOT_RETRYABLE"
  | "JOB_NOT_APPROVABLE"
  | "COST_BUDGET_EXCEEDED"
  | "LAST_ADMIN"
  | "CANNOT_MODIFY_SELF"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "EMAIL_TAKEN"
  | "STORAGE_QUOTA_EXCEEDED"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export type ApiErrorOptions = {
  details?: unknown;
  /** When false, the message is replaced by a generic one in production. */
  expose?: boolean;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(status: number, code: ErrorCode, message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.expose = options.expose ?? true;
  }
}

export class ValidationError extends ApiError {
  constructor(message = "请求参数无效。", details?: unknown) {
    super(400, "VALIDATION_ERROR", message, { details });
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "请先登录后再使用平台功能。") {
    super(401, "AUTH_REQUIRED", message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "当前账号无权执行该操作。") {
    super(403, "FORBIDDEN", message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "资源不存在。") {
    super(404, "NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends ApiError {
  constructor(message = "资源状态冲突。", code: ErrorCode = "CONFLICT") {
    super(409, code, message);
    this.name = "ConflictError";
  }
}

export class PayloadTooLargeError extends ApiError {
  constructor(message = "上传内容超过允许的大小。") {
    super(413, "PAYLOAD_TOO_LARGE", message);
    this.name = "PayloadTooLargeError";
  }
}

export class UnsupportedMediaTypeError extends ApiError {
  constructor(message = "不支持的文件类型。") {
    super(415, "UNSUPPORTED_MEDIA_TYPE", message);
    this.name = "UnsupportedMediaTypeError";
  }
}

export class StorageQuotaError extends ApiError {
  constructor(message = "存储空间不足，请先清理素材。") {
    super(413, "STORAGE_QUOTA_EXCEEDED", message);
    this.name = "StorageQuotaError";
  }
}

export class RateLimitError extends ApiError {
  readonly retryAfterSec: number;

  constructor(retryAfterSec: number, message = "请求过于频繁，请稍后再试。") {
    super(429, "RATE_LIMITED", message);
    this.name = "RateLimitError";
    this.retryAfterSec = Math.max(1, Math.ceil(retryAfterSec));
  }
}

/**
 * Internal control-flow signal used by the worker to stop a cancelled job.
 * Never exposed to HTTP clients.
 */
export class JobCancelledError extends Error {
  constructor(message = "任务已取消。") {
    super(message);
    this.name = "JobCancelledError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Best-effort extraction of an HTTP status from legacy error classes. */
export function readLegacyStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}
