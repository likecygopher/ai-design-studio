// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  jobCount: vi.fn(),
  groupBy: vi.fn(),
  providerFindMany: vi.fn(),
  getWorkerHealth: vi.fn()
}));

vi.mock("@/src/platform/db", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    generationJob: { count: mocks.jobCount, groupBy: mocks.groupBy },
    aiProvider: { findMany: mocks.providerFindMany }
  }
}));
vi.mock("@/src/platform/worker-heartbeat", () => ({
  getWorkerHealth: mocks.getWorkerHealth
}));
vi.mock("@/src/platform/logger", () => {
  const noop = () => undefined;
  const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  return { logger, createLogger: () => logger };
});

import {
  __resetAlertStateForTests,
  collectPlatformHealth,
  dispatchAlertWebhook
} from "./alerting";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.queryRaw.mockResolvedValue([{ ok: 1 }]);
  mocks.jobCount.mockResolvedValue(0);
  mocks.groupBy.mockResolvedValue([]);
  mocks.providerFindMany.mockResolvedValue([]);
  mocks.getWorkerHealth.mockResolvedValue({ total: 1, alive: 1 });
  __resetAlertStateForTests();
  vi.unstubAllGlobals();
});

describe("collectPlatformHealth", () => {
  it("raises critical alerts for a down database and missing workers", async () => {
    mocks.queryRaw.mockRejectedValue(new Error("db down"));
    mocks.getWorkerHealth.mockResolvedValue({ total: 1, alive: 0 });

    const snapshot = await collectPlatformHealth();
    expect(snapshot.databaseOk).toBe(false);
    expect(snapshot.alerts.map((alert) => alert.id)).toEqual(
      expect.arrayContaining(["database", "workers"])
    );
  });

  it("raises queue/failure/provider warnings", async () => {
    mocks.jobCount.mockImplementation(async ({ where }: { where: { status: string } }) => {
      if (where.status === "queued") return 1000;
      return 0;
    });
    mocks.groupBy.mockResolvedValue([
      { status: "failed", _count: { _all: 9 } },
      { status: "succeeded", _count: { _all: 1 } }
    ]);
    mocks.providerFindMany.mockResolvedValue([
      { id: "p1", name: "OpenAI", consecutiveFailures: 3 }
    ]);

    const snapshot = await collectPlatformHealth();
    const ids = snapshot.alerts.map((alert) => alert.id);
    expect(ids).toEqual(expect.arrayContaining(["queue-depth", "failure-rate", "provider-p1"]));
    expect(snapshot.failureRate24h).toBeGreaterThan(0.2);
  });
});

describe("dispatchAlertWebhook", () => {
  it("does nothing without a configured webhook", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await dispatchAlertWebhook(
      [{ id: "workers", severity: "critical", message: "no workers" }],
      { webhookUrl: undefined }
    );
    expect(result.sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts Slack-compatible alerts and deduplicates within cooldown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const alerts = [{ id: "workers", severity: "critical" as const, message: "no workers" }];

    const first = await dispatchAlertWebhook(alerts, {
      webhookUrl: "https://hooks.example.com/x",
      nowMs: 1_000_000,
      cooldownMs: 60_000
    });
    const duplicate = await dispatchAlertWebhook(alerts, {
      webhookUrl: "https://hooks.example.com/x",
      nowMs: 1_000_030,
      cooldownMs: 60_000
    });
    const later = await dispatchAlertWebhook(alerts, {
      webhookUrl: "https://hooks.example.com/x",
      nowMs: 1_100_000,
      cooldownMs: 60_000
    });

    expect(first.sent).toBe(true);
    expect(duplicate.sent).toBe(false);
    expect(later.sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.text).toContain("no workers");
  });

  it("sends a one-shot recovery message when alerts clear", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await dispatchAlertWebhook(
      [{ id: "workers", severity: "critical", message: "no workers" }],
      { webhookUrl: "https://hooks.example.com/x", nowMs: 1_000_000 }
    );
    const recovery = await dispatchAlertWebhook([], {
      webhookUrl: "https://hooks.example.com/x",
      nowMs: 1_100_000
    });
    expect(recovery.sent).toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).text).toContain("recovered");
  });
});
