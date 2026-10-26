/**
 * Pluggable rate limiting.
 *
 * Default implementation is an in-process sliding window. It is correct for a
 * single web/worker replica (the documented deployment in docker-compose) and is
 * the extension point for a Redis-backed implementation when scaling out.
 */
import { RateLimitError } from "@/src/platform/errors";

export type RateLimitDecision =
  | { ok: true; remaining: number; resetAtMs: number }
  | { ok: false; remaining: 0; resetAtMs: number; retryAfterSec: number };

export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number, nowMs?: number): RateLimitDecision;
  reset(key?: string): void;
  /** Number of tracked keys (observability/tests). */
  size(): number;
}

const MAX_TRACKED_KEYS = 20_000;

export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  consume(key: string, limit: number, windowMs: number, nowMs = Date.now()): RateLimitDecision {
    if (limit <= 0) {
      return { ok: true, remaining: 0, resetAtMs: nowMs + windowMs };
    }

    const windowStart = nowMs - windowMs;
    let timestamps = this.hits.get(key);
    if (!timestamps) {
      timestamps = [];
      this.hits.set(key, timestamps);
    }

    // Drop entries that fell out of the window.
    let firstValid = 0;
    while (firstValid < timestamps.length && timestamps[firstValid] <= windowStart) {
      firstValid += 1;
    }
    if (firstValid > 0) {
      timestamps.splice(0, firstValid);
    }

    if (timestamps.length >= limit) {
      const oldest = timestamps[0] ?? nowMs;
      const resetAtMs = oldest + windowMs;
      return {
        ok: false,
        remaining: 0,
        resetAtMs,
        retryAfterSec: Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000))
      };
    }

    timestamps.push(nowMs);

    if (this.hits.size > MAX_TRACKED_KEYS) {
      this.evictStale(nowMs, windowMs);
    }

    return {
      ok: true,
      remaining: Math.max(0, limit - timestamps.length),
      resetAtMs: nowMs + windowMs
    };
  }

  reset(key?: string): void {
    if (key === undefined) {
      this.hits.clear();
      return;
    }
    this.hits.delete(key);
  }

  size(): number {
    return this.hits.size;
  }

  private evictStale(nowMs: number, windowMs: number): void {
    const cutoff = nowMs - windowMs;
    for (const [key, timestamps] of this.hits) {
      const last = timestamps[timestamps.length - 1];
      if (last === undefined || last <= cutoff) {
        this.hits.delete(key);
      }
    }
  }
}

/** Process-wide limiter used by `handleApi` and middleware. */
export const defaultRateLimiter: RateLimiter = new MemoryRateLimiter();

export type ConsumeOptions = {
  key: string;
  limit: number;
  windowMs: number;
  limiter?: RateLimiter;
  nowMs?: number;
  message?: string;
};

/** Consume one slot or throw `RateLimitError` (HTTP 429). */
export function consumeOrThrow(options: ConsumeOptions): RateLimitDecision {
  const limiter = options.limiter ?? defaultRateLimiter;
  const decision = limiter.consume(options.key, options.limit, options.windowMs, options.nowMs);
  if (!decision.ok) {
    throw new RateLimitError(decision.retryAfterSec, options.message);
  }
  return decision;
}

/** Stable rate-limit key helpers. */
export function userRateLimitKey(scope: string, userId: string): string {
  return `${scope}:user:${userId}`;
}

export function ipRateLimitKey(scope: string, ip: string): string {
  return `${scope}:ip:${ip}`;
}

/** Async limiter used by the API wrapper and login (memory or Redis-backed). */
export interface AsyncRateLimiter {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision>;
  reset(key?: string): Promise<void>;
  size(): number;
}

/** Minimal Redis client surface needed by the limiter (test-injectable). */
export type RedisEvalClient = {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  del?(key: string): Promise<unknown>;
};

const REDIS_RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}
`;

function parseRedisReply(raw: unknown): { count: number; ttlMs: number } {
  if (Array.isArray(raw) && raw.length >= 2) {
    return { count: Number(raw[0]) || 0, ttlMs: Math.max(0, Number(raw[1]) || 0) };
  }
  throw new Error("Unexpected Redis rate-limit reply");
}

/**
 * Redis fixed-window limiter with an in-process fallback when Redis is down.
 * Fixed windows are acceptable for abuse control; the memory limiter remains
 * the reference implementation for tests and single-replica deployments.
 */
export class RedisRateLimiter implements AsyncRateLimiter {
  constructor(
    private readonly client: RedisEvalClient,
    private readonly prefix = "studio:rl:",
    private readonly fallback: RateLimiter = new MemoryRateLimiter()
  ) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    if (limit <= 0) {
      return { ok: true, remaining: 0, resetAtMs: Date.now() + windowMs };
    }
    try {
      const reply = parseRedisReply(
        await this.client.eval(REDIS_RATE_LIMIT_SCRIPT, 1, `${this.prefix}${key}`, windowMs)
      );
      const resetAtMs = Date.now() + (reply.ttlMs > 0 ? reply.ttlMs : windowMs);
      if (reply.count > limit) {
        return {
          ok: false,
          remaining: 0,
          resetAtMs,
          retryAfterSec: Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000))
        };
      }
      return { ok: true, remaining: Math.max(0, limit - reply.count), resetAtMs };
    } catch {
      // Fail over to the per-process limiter rather than allowing unlimited traffic.
      return this.fallback.consume(key, limit, windowMs);
    }
  }

  async reset(key?: string): Promise<void> {
    try {
      if (key) {
        await this.client.del?.(`${this.prefix}${key}`);
      }
    } catch {
      // Ignore Redis reset failures; the fallback is reset below.
    }
    this.fallback.reset(key);
  }

  size(): number {
    return this.fallback.size();
  }
}

/** Adapt a synchronous limiter to the async interface (tests / overrides). */
export class AsyncMemoryRateLimiter implements AsyncRateLimiter {
  constructor(private readonly limiter: RateLimiter = new MemoryRateLimiter()) {}
  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    return this.limiter.consume(key, limit, windowMs);
  }
  async reset(key?: string): Promise<void> {
    this.limiter.reset(key);
  }
  size(): number {
    return this.limiter.size();
  }
}
