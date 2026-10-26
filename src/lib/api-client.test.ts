import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  apiFetch,
  formatApiError,
  isApiClientError
} from "./api-client";

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("parses successful JSON payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ jobs: [{ id: "job-1" }] })));

    const payload = await apiFetch<{ jobs: { id: string }[] }>("/api/jobs");

    expect(payload.jobs).toEqual([{ id: "job-1" }]);
  });

  it("throws ApiClientError carrying status, code and requestId for non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: "任务状态已变化，无法取消。", code: "JOB_NOT_CANCELLABLE", requestId: "req-42" },
          409
        )
      )
    );

    const error = await apiFetch("/api/jobs/job-1/cancel", { method: "POST" }).catch(
      (cause: unknown) => cause
    );

    expect(isApiClientError(error)).toBe(true);
    const apiError = error as ApiClientError;
    expect(apiError.status).toBe(409);
    expect(apiError.code).toBe("JOB_NOT_CANCELLABLE");
    expect(apiError.requestId).toBe("req-42");
    expect(apiError.message).toContain("无法取消");
  });

  it("keeps legacy { error } responses usable and derives a fallback code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "该邮箱已注册，请直接登录。" }, 409))
    );

    const error = (await apiFetch("/api/auth/register", { method: "POST" }).catch(
      (cause: unknown) => cause
    )) as ApiClientError;

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.status).toBe(409);
    expect(error.code).toBe("HTTP_409");
    expect(error.message).toBe("该邮箱已注册，请直接登录。");
  });

  it("falls back to the x-request-id response header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "服务器错误" }, 500, { "x-request-id": "hdr-7" }))
    );

    const error = (await apiFetch("/api/jobs").catch((cause: unknown) => cause)) as ApiClientError;

    expect(error.requestId).toBe("hdr-7");
  });

  it("wraps transport failures as NETWORK_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );

    const error = (await apiFetch("/api/jobs").catch((cause: unknown) => cause)) as ApiClientError;

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.status).toBe(0);
    expect(error.code).toBe("NETWORK_ERROR");
  });

  it("surfaces non-JSON error bodies with a generic message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 }))
    );

    const error = (await apiFetch("/api/jobs").catch((cause: unknown) => cause)) as ApiClientError;

    expect(error.status).toBe(502);
    expect(error.code).toBe("HTTP_502");
    expect(error.message).toContain("502");
  });

  it("returns undefined for empty 204 responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    await expect(apiFetch("/api/jobs/job-1/cancel", { method: "POST" })).resolves.toBeUndefined();
  });
});

describe("formatApiError", () => {
  it("appends the request id so users can report it", () => {
    const error = new ApiClientError("生成任务失败", {
      status: 500,
      code: "INTERNAL_ERROR",
      requestId: "req-99"
    });

    expect(formatApiError(error)).toBe("生成任务失败（请求编号：req-99）");
  });

  it("uses plain messages for unknown or request-id-less errors", () => {
    expect(formatApiError(new Error("读取任务失败"))).toBe("读取任务失败");
    expect(formatApiError("boom", "兜底提示")).toBe("兜底提示");
    expect(formatApiError(new ApiClientError("没有编号", { status: 500 }))).toBe("没有编号");
  });
});

describe("formatApiError localization", () => {
  afterEach(() => {
    document.cookie = "studio_locale=; max-age=0; path=/";
  });

  it("translates known codes in English mode and keeps the request id", () => {
    document.cookie = "studio_locale=en; path=/";
    const error = new ApiClientError("本月额度已用尽。", {
      status: 429,
      code: "COST_BUDGET_EXCEEDED",
      requestId: "req_abc"
    });
    const text = formatApiError(error);
    expect(text).toContain("budget is exhausted");
    expect(text).toContain("Request ID: req_abc");
  });

  it("keeps the server message in Chinese mode", () => {
    const error = new ApiClientError("本月额度已用尽。", {
      status: 429,
      code: "COST_BUDGET_EXCEEDED",
      requestId: "req_abc"
    });
    expect(formatApiError(error)).toBe("本月额度已用尽。（请求编号：req_abc）");
  });
});
