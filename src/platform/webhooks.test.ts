// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  deliveryCreate: vi.fn(),
  endpointCreate: vi.fn(),
  endpointFindMany: vi.fn(),
  endpointDeleteMany: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: {
    webhookEndpoint: {
      findMany: mocks.endpointFindMany,
      update: mocks.update,
      create: mocks.endpointCreate,
      deleteMany: mocks.endpointDeleteMany
    },
    webhookDelivery: { create: mocks.deliveryCreate }
  }
}));

vi.mock("@/src/platform/logger", () => {
  const noop = () => undefined;
  const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  return { logger, createLogger: () => logger };
});

import { encryptSecret } from "./secrets";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  dispatchJobWebhooks,
  listWebhookEndpoints,
  normalizeWebhookEvents,
  validateWebhookUrl
} from "./webhooks";

const endpointRow = {
  id: "wh-1",
  userId: "user-1",
  url: "https://example.com/hook",
  secretCipher: encryptSecret("whsec_test"),
  events: ["job.failed"],
  enabled: true,
  lastDeliveryAt: null,
  lastDeliveryStatus: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z")
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.endpointFindMany.mockResolvedValue([]);
  mocks.update.mockResolvedValue({});
  mocks.deliveryCreate.mockResolvedValue({});
  mocks.endpointDeleteMany.mockResolvedValue({ count: 1 });
  vi.unstubAllGlobals();
});

describe("validateWebhookUrl", () => {
  it("accepts public https endpoints", () => {
    expect(validateWebhookUrl("https://example.com/hook")).toEqual({
      ok: true,
      url: "https://example.com/hook"
    });
  });

  it("rejects http, credentials, localhost and private ranges", () => {
    expect(validateWebhookUrl("http://example.com").ok).toBe(false);
    expect(validateWebhookUrl("https://user:pass@example.com").ok).toBe(false);
    expect(validateWebhookUrl("https://localhost/hook").ok).toBe(false);
    expect(validateWebhookUrl("https://127.0.0.1/hook").ok).toBe(false);
    expect(validateWebhookUrl("https://192.168.1.2/hook").ok).toBe(false);
    expect(validateWebhookUrl("https://service.local/hook").ok).toBe(false);
    expect(validateWebhookUrl("not a url").ok).toBe(false);
  });
});

describe("endpoint management", () => {
  it("creates an endpoint with an encrypted secret and one-time plaintext", async () => {
    mocks.endpointCreate.mockResolvedValue(endpointRow);
    const result = await createWebhookEndpoint("user-1", {
      url: "https://example.com/hook",
      events: ["job.failed", "unknown"]
    });
    expect(result.secret.startsWith("whsec_")).toBe(true);
    const data = mocks.endpointCreate.mock.calls[0][0].data;
    expect(data.secretCipher.startsWith("enc:v1:")).toBe(true);
    expect(data.events).toEqual(["job.failed"]);
    expect(result.endpoint.events).toEqual(["job.failed"]);
  });

  it("normalizes events and maps views without secrets", async () => {
    expect(normalizeWebhookEvents(["job.failed", "x", "job.succeeded"])).toEqual([
      "job.succeeded",
      "job.failed"
    ]);
    mocks.endpointFindMany.mockResolvedValue([endpointRow]);
    const views = await listWebhookEndpoints("user-1");
    expect(JSON.stringify(views)).not.toContain("secretCipher");
    expect(views[0].url).toBe("https://example.com/hook");
  });

  it("deletes only the caller's endpoint", async () => {
    expect(await deleteWebhookEndpoint("user-1", "wh-1")).toBe(true);
    expect(mocks.endpointDeleteMany).toHaveBeenCalledWith({
      where: { id: "wh-1", userId: "user-1" }
    });
  });
});

describe("dispatchJobWebhooks", () => {
  const job = {
    id: "job-1",
    userId: "user-1",
    type: "pop-scene",
    status: "failed",
    error: "boom"
  };

  it("posts an HMAC-signed payload and records the delivery", async () => {
    mocks.endpointFindMany.mockResolvedValue([endpointRow]);
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await dispatchJobWebhooks(job as never, "job.failed");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/hook");
    expect(init.headers["X-Studio-Event"]).toBe("job.failed");
    const signature = String(init.headers["X-Studio-Signature"]).replace("sha256=", "");
    const crypto = await import("node:crypto");
    const expected = crypto
      .createHmac("sha256", "whsec_test")
      .update(`${init.headers["X-Studio-Timestamp"]}.${init.body}`)
      .digest("hex");
    expect(signature).toBe(expected);
    expect(mocks.deliveryCreate.mock.calls[0][0].data.status).toBe("delivered");
  });

  it("records failures and skips non-matching events", async () => {
    mocks.endpointFindMany.mockResolvedValue([endpointRow]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await dispatchJobWebhooks(job as never, "job.failed");
    expect(mocks.deliveryCreate.mock.calls[0][0].data).toMatchObject({
      status: "failed",
      responseStatus: 500
    });

    mocks.deliveryCreate.mockClear();
    await dispatchJobWebhooks(job as never, "job.succeeded");
    expect(mocks.deliveryCreate).not.toHaveBeenCalled();
  });

  it("never throws into the worker path when delivery fails", async () => {
    mocks.endpointFindMany.mockResolvedValue([endpointRow]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(dispatchJobWebhooks(job as never, "job.failed")).resolves.toBeUndefined();
    expect(mocks.deliveryCreate.mock.calls[0][0].data.status).toBe("failed");
  });
});
