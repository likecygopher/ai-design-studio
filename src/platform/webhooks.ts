import { createHmac, randomBytes } from "node:crypto";
import type { GenerationJob } from "@prisma/client";
import { prisma } from "@/src/platform/db";
import { logger } from "@/src/platform/logger";
import { decryptSecret, encryptSecret } from "@/src/platform/secrets";

/** HMAC-signed webhook delivery for terminal job events. */

export const WEBHOOK_EVENTS = ["job.succeeded", "job.failed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const DELIVERY_TIMEOUT_MS = 8_000;

export function normalizeWebhookEvents(events: string[]): WebhookEvent[] {
  return WEBHOOK_EVENTS.filter((event) => events.includes(event));
}

/** Basic SSRF guard: HTTPS only, no credentials, no localhost/private hosts. */
export function validateWebhookUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Webhook URL 无效。" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "Webhook 必须使用 https://。" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Webhook URL 不能包含凭据。" };
  }
  const host = url.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal");
  if (isPrivate) {
    return { ok: false, error: "Webhook 不允许指向内网地址。" };
  }
  return { ok: true, url: url.toString() };
}

export type WebhookDeliveryView = {
  id: string;
  event: string;
  status: string;
  responseStatus: number | null;
  error: string | null;
  attempts: number;
  createdAt: string;
};

export type WebhookEndpointView = {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: string | null;
  createdAt: string;
};

export async function createWebhookEndpoint(
  userId: string,
  input: { url: string; events: string[] }
): Promise<{ endpoint: WebhookEndpointView; secret: string }> {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const row = await prisma.webhookEndpoint.create({
    data: {
      userId,
      url: input.url,
      secretCipher: encryptSecret(secret),
      events: normalizeWebhookEvents(input.events)
    }
  });
  return { endpoint: toView(row), secret };
}

function toView(row: {
  id: string;
  url: string;
  events: unknown;
  enabled: boolean;
  lastDeliveryAt: Date | null;
  lastDeliveryStatus: string | null;
  createdAt: Date;
}): WebhookEndpointView {
  return {
    id: row.id,
    url: row.url,
    events: Array.isArray(row.events) ? row.events.filter((e): e is string => typeof e === "string") : [],
    enabled: row.enabled,
    lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
    lastDeliveryStatus: row.lastDeliveryStatus ?? null,
    createdAt: row.createdAt.toISOString()
  };
}

export async function listWebhookEndpoints(userId: string): Promise<WebhookEndpointView[]> {
  const rows = await prisma.webhookEndpoint.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" }
  });
  return rows.map(toView);
}

export async function deleteWebhookEndpoint(userId: string, id: string): Promise<boolean> {
  const result = await prisma.webhookEndpoint.deleteMany({ where: { id, userId } });
  return result.count > 0;
}

const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_BASE_MS = 30_000;

/** Exponential backoff for failed webhook deliveries (30s, 1m, 2m, ...). */
export function webhookRetryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(RETRY_BASE_MS * 2 ** exponent, 60 * 60 * 1000);
}

export async function listWebhookDeliveries(
  userId: string,
  endpointId: string,
  limit = 20
): Promise<WebhookDeliveryView[]> {
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, userId },
    select: { id: true }
  });
  if (!endpoint) {
    return [];
  }
  const rows = await prisma.webhookDelivery.findMany({
    where: { endpointId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100)
  });
  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    status: row.status,
    responseStatus: row.responseStatus,
    error: row.error,
    attempts: row.attempts,
    createdAt: row.createdAt.toISOString()
  }));
}

type DeliveryResult = {
  status: "delivered" | "failed";
  responseStatus: number | null;
  error: string | null;
};

async function sendSignedPayload(
  endpoint: { url: string; secretCipher: string },
  event: string,
  body: string
): Promise<DeliveryResult> {
  let secret: string;
  try {
    secret = decryptSecret(endpoint.secretCipher);
  } catch {
    return { status: "failed", responseStatus: null, error: "secret_decrypt_failed" };
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signPayload(secret, timestamp, body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Studio-Event": event,
        "X-Studio-Timestamp": timestamp,
        "X-Studio-Signature": `sha256=${signature}`
      },
      body,
      signal: controller.signal
    });
    if (response.ok) {
      return { status: "delivered", responseStatus: response.status, error: null };
    }
    return {
      status: "failed",
      responseStatus: response.status,
      error: `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      error: error instanceof Error ? error.message.slice(0, 200) : "delivery failed"
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function retryWebhookDelivery(
  userId: string,
  endpointId: string,
  deliveryId: string
): Promise<WebhookDeliveryView | null> {
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, userId },
    select: { id: true, url: true, secretCipher: true }
  });
  if (!endpoint) return null;
  const delivery = await prisma.webhookDelivery.findFirst({
    where: { id: deliveryId, endpointId },
    select: { id: true, event: true, payload: true, attempts: true }
  });
  if (!delivery?.payload) return null;

  const result = await sendSignedPayload(endpoint, delivery.event, delivery.payload);
  const attempts = delivery.attempts + 1;
  const row = await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: result.status,
      responseStatus: result.responseStatus,
      error: result.error,
      attempts,
      nextAttemptAt:
        result.status === "delivered" ? null : new Date(Date.now() + webhookRetryDelayMs(attempts))
    }
  });
  await prisma.webhookEndpoint.update({
    where: { id: endpoint.id },
    data: { lastDeliveryAt: new Date(), lastDeliveryStatus: result.status }
  });
  return {
    id: row.id,
    event: row.event,
    status: row.status,
    responseStatus: row.responseStatus,
    error: row.error,
    attempts: row.attempts,
    createdAt: row.createdAt.toISOString()
  };
}

/**
 * Worker-driven retry sweep for failed deliveries with expired backoff.
 * Returns the number of attempted retries.
 */
export async function processWebhookRetries(now = new Date(), limit = 20): Promise<number> {
  const due = await prisma.webhookDelivery.findMany({
    where: {
      status: "failed",
      attempts: { lt: MAX_DELIVERY_ATTEMPTS },
      nextAttemptAt: { lte: now },
      payload: { not: null }
    },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    include: {
      endpoint: { select: { id: true, userId: true, url: true, secretCipher: true, enabled: true } }
    }
  });
  let attempted = 0;
  for (const delivery of due) {
    if (!delivery.endpoint.enabled || !delivery.payload) continue;
    attempted += 1;
    const result = await sendSignedPayload(delivery.endpoint, delivery.event, delivery.payload);
    const attempts = delivery.attempts + 1;
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: result.status,
        responseStatus: result.responseStatus,
        error: result.error,
        attempts,
        nextAttemptAt:
          result.status === "delivered"
            ? null
            : attempts >= MAX_DELIVERY_ATTEMPTS
              ? null
              : new Date(now.getTime() + webhookRetryDelayMs(attempts))
      }
    });
    await prisma.webhookEndpoint.update({
      where: { id: delivery.endpoint.id },
      data: { lastDeliveryAt: new Date(), lastDeliveryStatus: result.status }
    });
  }
  return attempted;
}

function signPayload(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Fire-and-forget delivery to all matching endpoints of the job owner. */
export async function dispatchJobWebhooks(
  job: Pick<GenerationJob, "id" | "userId" | "type" | "status" | "error">,
  event: WebhookEvent
): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { userId: job.userId, enabled: true }
  });
  const matching = endpoints.filter((endpoint) => {
    const events = Array.isArray(endpoint.events) ? endpoint.events : [];
    return events.includes(event);
  });
  if (matching.length === 0) {
    return;
  }

  const body = JSON.stringify({
    event,
    job: {
      id: job.id,
      type: job.type,
      status: job.status,
      error: job.error ?? null
    },
    sentAt: new Date().toISOString()
  });

  await Promise.all(
    matching.map(async (endpoint) => {
      const result = await sendSignedPayload(endpoint, event, body);
      if (result.error === "secret_decrypt_failed") {
        logger.warn("webhook.secret_decrypt_failed", { endpointId: endpoint.id });
        return;
      }
      const attempts = 1;
      await prisma.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          event,
          status: result.status,
          responseStatus: result.responseStatus,
          error: result.error,
          payload: body,
          attempts,
          nextAttemptAt:
            result.status === "delivered"
              ? null
              : new Date(Date.now() + webhookRetryDelayMs(attempts))
        }
      });
      await prisma.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { lastDeliveryAt: new Date(), lastDeliveryStatus: result.status }
      });
    })
  );
}
