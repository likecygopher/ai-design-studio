import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  recordAudit: vi.fn()
}));

vi.mock("@/src/platform/auth", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/src/platform/audit", () => ({
  recordAudit: mocks.recordAudit
}));

vi.mock("@/src/platform/logger", () => {
  const noop = () => undefined;
  const logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger
  };
  return { logger, createLogger: () => logger };
});

import { NextResponse } from "next/server";
import { getClientIp, handleApi, RequestId } from "./api";
import { defaultRateLimiter } from "./rate-limit";

const userSession = { id: "user-1", email: "u@example.com", role: "user" };
const adminSession = { id: "admin-1", email: "a@example.com", role: "admin" };

function request(path = "/api/test", init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

beforeEach(() => {
  mocks.getSessionUser.mockReset();
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
  defaultRateLimiter.reset();
});

describe("handleApi auth", () => {
  it("allows public routes without a session", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await handleApi(
      request(),
      { auth: "public", rateLimit: false },
      async () => NextResponse.json({ ok: true })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(response.headers.get("x-request-id")).toMatch(/^req_[a-z0-9]+$/);
  });

  it("rejects unauthenticated protected routes with 401 + code", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await handleApi(request(), { rateLimit: false }, async () =>
      NextResponse.json({ ok: true })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: "AUTH_REQUIRED" });
    expect(body.requestId).toBeTruthy();
  });

  it("rejects non-admin users on admin routes with 403", async () => {
    mocks.getSessionUser.mockResolvedValue(userSession);

    const response = await handleApi(request(), { auth: "admin", rateLimit: false }, async () =>
      NextResponse.json({ ok: true })
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("FORBIDDEN");
  });

  it("passes userId and role to admin handlers", async () => {
    mocks.getSessionUser.mockResolvedValue(adminSession);

    const response = await handleApi(request(), { auth: "admin", rateLimit: false }, async (ctx) =>
      NextResponse.json({ userId: ctx.userId, role: ctx.role })
    );

    expect(await response.json()).toEqual({ userId: "admin-1", role: "admin" });
  });
});

describe("handleApi body validation", () => {
  const schema = z.object({ name: z.string().min(1), count: z.number().int().optional() });

  it("returns parsed body", async () => {
    mocks.getSessionUser.mockResolvedValue(userSession);

    const response = await handleApi(
      request("/api/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "midea" })
      }),
      { rateLimit: false },
      async (ctx) => NextResponse.json(await ctx.body(schema))
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "midea" });
  });

  it("rejects invalid bodies with 400 and issue details", async () => {
    mocks.getSessionUser.mockResolvedValue(userSession);

    const response = await handleApi(
      request("/api/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "" })
      }),
      { rateLimit: false },
      async (ctx) => NextResponse.json(await ctx.body(schema))
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details.issues[0].path).toBe("name");
  });

  it("rejects malformed JSON", async () => {
    mocks.getSessionUser.mockResolvedValue(userSession);

    const response = await handleApi(
      request("/api/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json"
      }),
      { rateLimit: false },
      async (ctx) => NextResponse.json(await ctx.body(schema))
    );

    expect(response.status).toBe(400);
  });
});

describe("handleApi rate limiting", () => {
  it("returns 429 with retry-after once the bucket is exhausted", async () => {
    mocks.getSessionUser.mockResolvedValue(userSession);

    const options = {
      rateLimit: { name: "test-bucket", limit: 1, windowMs: 60_000 }
    } as const;

    const first = await handleApi(request(), options, async () =>
      NextResponse.json({ ok: true })
    );
    expect(first.status).toBe(200);

    const second = await handleApi(request(), options, async () =>
      NextResponse.json({ ok: true })
    );
    const body = await second.json();

    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
    expect(body.code).toBe("RATE_LIMITED");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "rate_limit.exceeded" })
    );
  });

  it("keys public buckets by ip", async () => {
    const options = {
      auth: "public" as const,
      rateLimit: { name: "public-bucket", limit: 1, windowMs: 60_000 }
    };

    const first = await handleApi(
      request("/api/public", { headers: { "x-forwarded-for": "9.9.9.9" } }),
      options,
      async () => NextResponse.json({ ok: true })
    );
    expect(first.status).toBe(200);

    const second = await handleApi(
      request("/api/public", { headers: { "x-forwarded-for": "9.9.9.9" } }),
      options,
      async () => NextResponse.json({ ok: true })
    );
    expect(second.status).toBe(429);

    const third = await handleApi(
      request("/api/public", { headers: { "x-forwarded-for": "8.8.8.8" } }),
      options,
      async () => NextResponse.json({ ok: true })
    );
    expect(third.status).toBe(200);
  });
});

describe("handleApi errors and request ids", () => {
  it("maps thrown ApiError to the contract", async () => {
    mocks.getSessionUser.mockResolvedValue(userSession);

    const response = await handleApi(request(), { rateLimit: false }, async () => {
      const { NotFoundError } = await import("./errors");
      throw new NotFoundError("任务不存在。");
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("preserves a caller-supplied request id", async () => {
    mocks.getSessionUser.mockResolvedValue(userSession);

    const response = await handleApi(
      request("/api/test", { headers: { "x-request-id": "trace-abc-123" } }),
      { rateLimit: false },
      async () => NextResponse.json({ ok: true })
    );

    expect(response.headers.get("x-request-id")).toBe("trace-abc-123");
  });

  it("ignores unsafe request ids", () => {
    const id = RequestId.fromRequest(
      request("/api/test", { headers: { "x-request-id": "bad id with spaces" } })
    ).value;
    expect(id).toMatch(/^req_/);
  });
});

describe("getClientIp", () => {
  it("prefers the first forwarded address", () => {
    expect(
      getClientIp(request("/api/x", { headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" } }))
    ).toBe("1.1.1.1");
  });

  it("falls back to other headers then loopback", () => {
    expect(getClientIp(request("/api/x", { headers: { "x-real-ip": "3.3.3.3" } }))).toBe(
      "3.3.3.3"
    );
    expect(getClientIp(request("/api/x"))).toBe("127.0.0.1");
  });
});
