"use client";

/**
 * Unified frontend API client (SPEC R8.4).
 *
 * Server errors follow `{ error, code, requestId, details? }`
 * (see docs/sdd/specs/2026-10-26-commercial-platform/design.md §3).
 * `error` is still a plain string so legacy callers/backends stay compatible;
 * `code`/`requestId` are parsed when present so the UI can show a traceable
 * request id to the user (support-friendly).
 */

import { getClientLocale, localizeErrorCode } from "@/src/i18n/errors";

export type ApiErrorBody = {
  error?: unknown;
  code?: unknown;
  requestId?: unknown;
  details?: unknown;
};

export type ApiClientErrorOptions = {
  status: number;
  code?: string;
  requestId?: string;
  details?: unknown;
};

const NETWORK_ERROR_MESSAGE = "网络连接失败，请检查网络后重试。";

/** Error thrown by {@link apiFetch} for any non-2xx or transport failure. */
export class ApiClientError extends Error {
  /** HTTP status, or 0 for transport/network failures. */
  readonly status: number;
  /** Stable machine code, e.g. `AUTH_REQUIRED`, `JOB_NOT_CANCELLABLE`, `NETWORK_ERROR`. */
  readonly code: string;
  /** Server request id used for support tickets / log correlation. */
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(message: string, options: ApiClientErrorOptions) {
    super(message);
    this.name = "ApiClientError";
    this.status = options.status;
    this.code =
      options.code ?? (options.status > 0 ? `HTTP_${options.status}` : "NETWORK_ERROR");
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

export function isApiClientError(value: unknown): value is ApiClientError {
  return value instanceof ApiClientError;
}

/**
 * Render any thrown value as user-facing text. When the server supplied a
 * request id it is appended so the user can quote it when reporting an issue.
 */
export function formatApiError(error: unknown, fallback = "操作失败，请稍后重试。"): string {
  if (error instanceof ApiClientError) {
    const locale = getClientLocale();
    const localized =
      localizeErrorCode(locale, error.code) ?? error.message ?? fallback;
    if (error.requestId) {
      return locale === "en"
        ? `${localized} (Request ID: ${error.requestId})`
        : `${localized}（请求编号：${error.requestId}）`;
    }
    return localized;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) {
    return undefined;
  }
  const text = await response.text().catch(() => "");
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * `fetch` wrapper that always parses the body and throws {@link ApiClientError}
 * on non-2xx responses. Callers can rely on `error.code`/`error.requestId`
 * instead of re-implementing error parsing on every page.
 */
export async function apiFetch<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw cause;
    }
    throw new ApiClientError(NETWORK_ERROR_MESSAGE, { status: 0, code: "NETWORK_ERROR" });
  }

  const body = await readBody(response);

  if (!response.ok) {
    const payload: ApiErrorBody =
      body && typeof body === "object" ? (body as ApiErrorBody) : {};
    const message =
      stringField(payload.error) ?? `请求失败（HTTP ${response.status}），请稍后重试。`;
    const code = stringField(payload.code) ?? `HTTP_${response.status}`;
    const requestId =
      stringField(payload.requestId) ??
      stringField(response.headers.get("x-request-id")) ??
      undefined;
    throw new ApiClientError(message, {
      status: response.status,
      code,
      requestId,
      details: payload.details
    });
  }

  return body as T;
}
