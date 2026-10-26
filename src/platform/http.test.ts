import { describe, expect, it } from "vitest";
import {
  ApiError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  StorageQuotaError,
  UnsupportedMediaTypeError,
  ValidationError
} from "./errors";
import { toErrorResponse } from "./http";

async function bodyOf(response: Response) {
  return (await response.json()) as {
    error: string;
    code: string;
    requestId?: string;
    details?: unknown;
  };
}

describe("toErrorResponse", () => {
  it("maps ApiError to the unified contract", async () => {
    const response = toErrorResponse(new ForbiddenError(), { requestId: "req_123" });
    const body = await bodyOf(response);

    expect(response.status).toBe(403);
    expect(response.headers.get("x-request-id")).toBe("req_123");
    expect(body).toEqual({ error: "当前账号无权执行该操作。", code: "FORBIDDEN", requestId: "req_123" });
  });

  it("keeps human-readable messages for 4xx errors", async () => {
    const response = toErrorResponse(new NotFoundError("产品不存在。"));
    const body = await bodyOf(response);

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: "产品不存在。", code: "NOT_FOUND" });
  });

  it("exposes validation details", async () => {
    const response = toErrorResponse(new ValidationError("请求参数无效。", { issues: [{ path: "email", message: "invalid" }] }));
    const body = await bodyOf(response);

    expect(response.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details).toEqual({ issues: [{ path: "email", message: "invalid" }] });
  });

  it("adds retry-after for rate limit errors", async () => {
    const response = toErrorResponse(new RateLimitError(42));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
  });

  it("maps storage/media errors to their dedicated codes", async () => {
    const quota = toErrorResponse(new StorageQuotaError());
    expect(quota.status).toBe(413);
    expect((await bodyOf(quota)).code).toBe("STORAGE_QUOTA_EXCEEDED");

    const media = toErrorResponse(new UnsupportedMediaTypeError());
    expect(media.status).toBe(415);
    expect((await bodyOf(media)).code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("maps legacy error classes by name for backward compatibility", async () => {
    const legacyAuth = Object.assign(new Error("请先登录。"), {
      name: "AuthRequiredError",
      status: 401
    });
    const authResponse = toErrorResponse(legacyAuth);
    expect(authResponse.status).toBe(401);
    expect((await bodyOf(authResponse)).code).toBe("AUTH_REQUIRED");

    const legacyQuota = Object.assign(new Error("任务太多。"), {
      name: "JobQuotaError",
      status: 429
    });
    const quotaResponse = toErrorResponse(legacyQuota);
    expect(quotaResponse.status).toBe(429);
    expect((await bodyOf(quotaResponse)).code).toBe("JOB_QUOTA_EXCEEDED");
  });

  it("never leaks unknown internals in the error code", async () => {
    const response = toErrorResponse(new Error("database exploded"));
    const body = await bodyOf(response);

    expect(response.status).toBe(500);
    expect(body.code).toBe("INTERNAL_ERROR");
  });

  it("honours a custom fallback status", async () => {
    const response = toErrorResponse(new ApiError(418, "VALIDATION_ERROR", "teapot"), 400);
    expect(response.status).toBe(418);
  });
});
