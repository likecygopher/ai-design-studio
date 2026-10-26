// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  endpointFindFirst: vi.fn(),
  endpointUpdate: vi.fn(),
  deliveryFindMany: vi.fn(),
  deliveryFindFirst: vi.fn(),
  deliveryUpdate: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: {
    webhookEndpoint: {
      findFirst: mocks.endpointFindFirst,
      update: mocks.endpointUpdate
    },
    webhookDelivery: {
      findMany: mocks.deliveryFindMany,
      findFirst: mocks.deliveryFindFirst,
      update: mocks.deliveryUpdate
    }
  }
}));

vi.mock("@/src/platform/secrets", () => ({
  decryptSecret: () => "whsec_test",
  encryptSecret: (value: string) => `enc:${value}`
}));

import {
  listWebhookDeliveries,
  processWebhookRetries,
  retryWebhookDelivery,
  webhookRetryDelayMs
} from "./webhooks";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.unstubAllGlobals();
});

describe("webhook retry/backoff", () => {
  it("uses exponential backoff capped at one hour", () => {
    expect(webhookRetryDelayMs(1)).toBe(30_000);
    expect(webhookRetryDelayMs(2)).toBe(60_000);
    expect(webhookRetryDelayMs(10)).toBe(60 * 60 * 1000);
  });

  it("lists deliveries only for an owned endpoint", async () => {
    mocks.endpointFindFirst.mockResolvedValue(null);
    expect(await listWebhookDeliveries("user-1", "wh-1")).toEqual([]);

    mocks.endpointFindFirst.mockResolvedValue({ id: "wh-1" });
    mocks.deliveryFindMany.mockResolvedValue([
      {
        id: "d-1",
        event: "job.failed",
        status: "failed",
        responseStatus: 500,
        error: "HTTP 500",
        attempts: 2,
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      }
    ]);
    const rows = await listWebhookDeliveries("user-1", "wh-1");
    expect(rows[0]).toMatchObject({ status: "failed", attempts: 2 });
  });

  it("retries a stored payload and updates the delivery", async () => {
    mocks.endpointFindFirst.mockResolvedValue({
      id: "wh-1",
      url: "https://example.com/hook",
      secretCipher: "enc"
    });
    mocks.deliveryFindFirst.mockResolvedValue({
      id: "d-1",
      event: "job.failed",
      payload: '{"event":"job.failed"}',
      attempts: 1
    });
    mocks.deliveryUpdate.mockResolvedValue({
      id: "d-1",
      event: "job.failed",
      status: "delivered",
      responseStatus: 200,
      error: null,
      attempts: 2,
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await retryWebhookDelivery("user-1", "wh-1", "d-1");
    expect(result?.status).toBe("delivered");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.deliveryUpdate.mock.calls[0][0].data).toMatchObject({
      status: "delivered",
      attempts: 2,
      nextAttemptAt: null
    });
  });

  it("sweeps due failed deliveries", async () => {
    mocks.deliveryFindMany.mockResolvedValue([
      {
        id: "d-2",
        endpointId: "wh-1",
        event: "job.failed",
        payload: '{"event":"job.failed"}',
        attempts: 1,
        endpoint: {
          id: "wh-1",
          userId: "user-1",
          url: "https://example.com/hook",
          secretCipher: "enc",
          enabled: true
        }
      }
    ]);
    mocks.deliveryUpdate.mockResolvedValue({});
    mocks.endpointUpdate.mockResolvedValue({});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 503 }))
    );

    expect(await processWebhookRetries(new Date("2026-01-01T00:10:00Z"))).toBe(1);
    expect(mocks.deliveryUpdate.mock.calls[0][0].data).toMatchObject({
      status: "failed",
      attempts: 2
    });
  });
});
