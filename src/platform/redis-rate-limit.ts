import { PLATFORM_CONFIG } from "@/src/platform/config";
import { logger } from "@/src/platform/logger";
import {
  AsyncMemoryRateLimiter,
  RedisRateLimiter,
  type AsyncRateLimiter,
  type RedisEvalClient
} from "@/src/platform/rate-limit";

/**
 * Lazily creates Redis-backed limiters. ioredis is imported dynamically so the
 * Edge middleware bundle (which imports rate-limit.ts) never pulls in Node APIs.
 */

let requestLimiter: Promise<AsyncRateLimiter> | null = null;
let loginLimiter: Promise<AsyncRateLimiter> | null = null;

async function createLimiter(prefix: string): Promise<AsyncRateLimiter> {
  if (!PLATFORM_CONFIG.redisUrl) {
    return new AsyncMemoryRateLimiter();
  }
  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(PLATFORM_CONFIG.redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2_000
    });
    client.on("error", (error: Error) => {
      logger.warn("rate_limit.redis_error", { error: error.message });
    });
    logger.info("rate_limit.redis_enabled", { prefix });
    return new RedisRateLimiter(client as unknown as RedisEvalClient, prefix);
  } catch (error) {
    logger.warn("rate_limit.redis_unavailable", {
      error: error instanceof Error ? error.message : String(error)
    });
    return new AsyncMemoryRateLimiter();
  }
}

export function getRequestRateLimiter(): Promise<AsyncRateLimiter> {
  requestLimiter ??= createLimiter("studio:rl:");
  return requestLimiter;
}

export function getLoginRateLimiter(): Promise<AsyncRateLimiter> {
  loginLimiter ??= createLimiter("studio:login:");
  return loginLimiter;
}

/** Tests only: drop cached limiters so env changes take effect. */
export function __resetRedisLimitersForTests(): void {
  requestLimiter = null;
  loginLimiter = null;
}
