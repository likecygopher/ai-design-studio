// @vitest-environment node
/**
 * Route-level tests for `GET/POST /api/jobs` (SDD T40, T45 + R3 boundaries):
 * idempotent submit, quota 429, cursor pagination, validation 400, auth 401.
 */
import { JobStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({
  prisma: null as unknown,
  sessionUser: null as { id: string; role: string } | null,
  getSessionUser: vi.fn(),
  recordAudit: vi.fn(),
  authenticateApiToken: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_target, property) =>
        (shared.prisma as Record<string | symbol, unknown>)[property]
    }
  )
}));

vi.mock("@/src/platform/auth", () => ({
  getSessionUser: shared.getSessionUser
}));

vi.mock("@/src/platform/api-tokens", () => ({
  authenticateApiToken: shared.authenticateApiToken
}));

vi.mock("@/src/platform/audit", () => ({
  recordAudit: shared.recordAudit
}));

vi.mock("@/src/platform/quotas", () => ({
  assertWithinBudget: vi.fn().mockResolvedValue({
    monthStart: "2026-01-01T00:00:00.000Z",
    usedUnits: 0,
    budgetUnits: null,
    remainingUnits: null,
    percent: null,
    exceeded: false,
    inherited: false
  })
}));

vi.mock("@/src/platform/logger", () => {
  const noop = () => undefined;
  const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  return { logger, createLogger: () => logger };
});

import { PLATFORM_CONFIG } from "@/src/platform/config";
import { setRateLimiter } from "@/src/platform/api";
import { MemoryRateLimiter } from "@/src/platform/rate-limit";
import {
  buildJob,
  createFakePrisma,
  flushAsync,
  type FakePrisma
} from "@/src/platform/jobs.test-utils";
import { GET, POST } from "./route";

function fake(): FakePrisma {
  return shared.prisma as FakePrisma;
}

function state() {
  return fake().state;
}

function getRequest(query = ""): Request {
  return new Request(`http://localhost/api/jobs${query}`, { method: "GET" });
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

beforeEach(() => {
  shared.prisma = createFakePrisma();
  shared.sessionUser = { id: "user-1", role: "user" };
  shared.getSessionUser.mockReset().mockImplementation(async () => shared.sessionUser);
  shared.recordAudit.mockReset().mockResolvedValue(undefined);
  shared.authenticateApiToken.mockReset().mockResolvedValue(null);
  setRateLimiter(new MemoryRateLimiter());
});

describe("POST /api/jobs", () => {
  it("creates a job and writes an enqueue audit entry", async () => {
    const response = await POST(
      postRequest({ type: "pop-scene", payload: { templateId: "tpl-1" } })
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.created).toBe(true);
    expect(body.job).toMatchObject({ type: "pop-scene", status: JobStatus.queued });
    expect(body.job.nextAttemptAt).toBeTypeOf("string");
    expect(state().jobs).toHaveLength(1);
    expect(response.headers.get("x-request-id")).toMatch(/^req_/);

    await flushAsync();
    expect(shared.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "job.enqueue",
        userId: "user-1",
        targetId: body.job.id
      })
    );
  });

  it("returns the original job with 200 for a repeated idempotency key", async () => {
    const submit = () =>
      POST(
        postRequest({
          type: "pop-scene",
          payload: { templateId: "tpl-1" },
          idempotencyKey: "idem-key-0001"
        })
      );

    const first = await submit();
    const second = await submit();
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(202);
    expect(firstBody.created).toBe(true);
    expect(second.status).toBe(200);
    expect(secondBody.created).toBe(false);
    expect(secondBody.job.id).toBe(firstBody.job.id);
    expect(state().jobs).toHaveLength(1);
  });

  it("tolerates extra top-level fields from legacy clients", async () => {
    const response = await POST(
      postRequest({
        type: "style-transfer",
        payload: { productId: "product-1" },
        imageModel: "openai"
      })
    );
    expect(response.status).toBe(202);
  });

  it("rejects unknown job types with 400 VALIDATION_ERROR", async () => {
    const response = await POST(postRequest({ type: "not-a-job", payload: {} }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(body.requestId).toMatch(/^req_/);
    expect(state().jobs).toHaveLength(0);
  });

  it("rejects malformed JSON bodies with 400 VALIDATION_ERROR", async () => {
    const response = await POST(postRequest("{not-json"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("enforces the per-user active job quota with 429 JOB_QUOTA_EXCEEDED", async () => {
    for (let index = 0; index < PLATFORM_CONFIG.maxUserActiveJobs; index += 1) {
      state().jobs.push(buildJob({ userId: "user-1", status: JobStatus.queued }));
    }

    const response = await POST(postRequest({ type: "pop-scene", payload: {} }));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.code).toBe("JOB_QUOTA_EXCEEDED");
    expect(state().jobs).toHaveLength(PLATFORM_CONFIG.maxUserActiveJobs);
  });

  it("returns 401 AUTH_REQUIRED without a session", async () => {
    shared.sessionUser = null;
    const response = await POST(postRequest({ type: "pop-scene", payload: {} }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("returns 429 RATE_LIMITED with Retry-After when the limiter rejects", async () => {
    setRateLimiter({
      consume: () => ({
        ok: false,
        remaining: 0,
        resetAtMs: Date.now() + 60_000,
        retryAfterSec: 30
      }),
      reset: () => undefined,
      size: () => 0
    });

    const response = await POST(postRequest({ type: "pop-scene", payload: {} }));
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: "RATE_LIMITED" });
    expect(response.headers.get("retry-after")).toBe("30");
  });
});

describe("GET /api/jobs", () => {
  it("paginates with a 20-row default and returns nextCursor", async () => {
    for (let index = 0; index < 25; index += 1) {
      state().jobs.push(buildJob({ userId: "user-1" }));
    }

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.jobs).toHaveLength(20);
    expect(body.nextCursor).toBe(body.jobs.at(-1).id);

    const nextPage = await GET(getRequest(`?cursor=${body.nextCursor}`));
    const nextBody = await nextPage.json();
    expect(nextBody.jobs).toHaveLength(5);
    expect(nextBody.nextCursor).toBeNull();

    const firstIds = new Set(body.jobs.map((job: { id: string }) => job.id));
    expect(nextBody.jobs.every((job: { id: string }) => !firstIds.has(job.id))).toBe(true);
  });

  it("filters by status and honours a custom limit", async () => {
    state().jobs.push(
      buildJob({ userId: "user-1", status: JobStatus.succeeded }),
      buildJob({ userId: "user-1", status: JobStatus.queued }),
      buildJob({ userId: "user-2", status: JobStatus.succeeded })
    );

    const response = await GET(getRequest("?status=succeeded&limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].status).toBe(JobStatus.succeeded);
  });

  it("rejects invalid query parameters with 400 VALIDATION_ERROR", async () => {
    for (const query of ["?status=unknown", "?limit=0", "?limit=500", "?limit=abc", "?cursor=missing"]) {
      const response = await GET(getRequest(query));
      expect(response.status, query).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
    }
  });

  it("returns 401 AUTH_REQUIRED without a session", async () => {
    shared.sessionUser = null;
    const response = await GET(getRequest());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("returns 429 RATE_LIMITED when the limiter rejects", async () => {
    setRateLimiter({
      consume: () => ({
        ok: false,
        remaining: 0,
        resetAtMs: Date.now() + 60_000,
        retryAfterSec: 5
      }),
      reset: () => undefined,
      size: () => 0
    });

    const response = await GET(getRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("5");
  });

  it("rejects writes from a read-only API token", async () => {
    shared.sessionUser = { id: "user-1", role: "user" };
    shared.getSessionUser.mockResolvedValue(null);
    shared.authenticateApiToken.mockResolvedValue({
      tokenId: "token-1",
      userId: "user-1",
      role: "user",
      scopes: ["read"]
    });

    const response = await POST(
      new Request("http://localhost/api/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer mcs_readonly"
        },
        body: JSON.stringify({ type: "pop-scene", payload: {} })
      })
    );
    expect(response.status).toBe(403);
  });
});
