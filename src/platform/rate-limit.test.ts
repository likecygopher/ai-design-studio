import { describe, expect, it, vi } from "vitest";
import { MemoryRateLimiter, RedisRateLimiter, consumeOrThrow, ipRateLimitKey, userRateLimitKey } from "./rate-limit";
import { RateLimitError } from "./errors";

describe("MemoryRateLimiter", () => {
  it("allows requests up to the limit inside the window", () => {
    const limiter = new MemoryRateLimiter();
    const now = 1_000_000;

    const first = limiter.consume("k", 3, 10_000, now);
    const second = limiter.consume("k", 3, 10_000, now + 1000);
    const third = limiter.consume("k", 3, 10_000, now + 2000);

    expect(first).toMatchObject({ ok: true, remaining: 2 });
    expect(second).toMatchObject({ ok: true, remaining: 1 });
    expect(third).toMatchObject({ ok: true, remaining: 0 });
  });

  it("rejects requests over the limit and reports retry-after", () => {
    const limiter = new MemoryRateLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) {
      limiter.consume("k", 3, 10_000, now);
    }

    const decision = limiter.consume("k", 3, 10_000, now + 2000);

    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.remaining).toBe(0);
      expect(decision.retryAfterSec).toBe(8);
    }
  });

  it("slides the window as old hits expire", () => {
    const limiter = new MemoryRateLimiter();
    const now = 1_000_000;
    limiter.consume("k", 2, 10_000, now);
    limiter.consume("k", 2, 10_000, now + 1000);

    expect(limiter.consume("k", 2, 10_000, now + 2000).ok).toBe(false);
    // First hit falls out of the window at now + 10000.
    expect(limiter.consume("k", 2, 10_000, now + 10_001).ok).toBe(true);
  });

  it("isolates different keys", () => {
    const limiter = new MemoryRateLimiter();
    limiter.consume("a", 1, 1000, 0);
    expect(limiter.consume("a", 1, 1000, 1).ok).toBe(false);
    expect(limiter.consume("b", 1, 1000, 1).ok).toBe(true);
  });

  it("resets one key or all keys", () => {
    const limiter = new MemoryRateLimiter();
    limiter.consume("a", 1, 1000, 0);
    limiter.consume("b", 1, 1000, 0);

    limiter.reset("a");
    expect(limiter.consume("a", 1, 1000, 1).ok).toBe(true);
    expect(limiter.consume("b", 1, 1000, 1).ok).toBe(false);

    limiter.reset();
    expect(limiter.size()).toBe(0);
  });

  it("never rejects when the limit is disabled", () => {
    const limiter = new MemoryRateLimiter();
    expect(limiter.consume("k", 0, 1000, 0).ok).toBe(true);
  });
});

describe("consumeOrThrow", () => {
  it("throws RateLimitError with retry-after once exhausted", () => {
    const limiter = new MemoryRateLimiter();
    consumeOrThrow({ key: "k", limit: 1, windowMs: 5000, limiter, nowMs: 0 });

    let caught: unknown;
    try {
      consumeOrThrow({ key: "k", limit: 1, windowMs: 5000, limiter, nowMs: 1000 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RateLimitError);
    expect((caught as RateLimitError).status).toBe(429);
    expect((caught as RateLimitError).retryAfterSec).toBe(4);
  });
});

describe("rate limit keys", () => {
  it("builds stable scoped keys", () => {
    expect(userRateLimitKey("jobs:create", "u1")).toBe("jobs:create:user:u1");
    expect(ipRateLimitKey("auth:register", "1.2.3.4")).toBe("auth:register:ip:1.2.3.4");
  });
});

describe("RedisRateLimiter", () => {
  it("uses the Redis counter and TTL for decisions", async () => {
    const client = {
      eval: vi.fn().mockResolvedValue([3, 12_000]),
      del: vi.fn()
    };
    const limiter = new RedisRateLimiter(client);
    const decision = await limiter.consume("scope:key", 5, 60_000);
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.remaining).toBe(2);
    }
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("INCR"),
      1,
      "studio:rl:scope:key",
      60_000
    );
  });

  it("rejects once the counter exceeds the limit", async () => {
    const limiter = new RedisRateLimiter({ eval: vi.fn().mockResolvedValue([6, 5_000]) });
    const decision = await limiter.consume("scope:key", 5, 60_000);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.retryAfterSec).toBeGreaterThanOrEqual(1);
    }
  });

  it("falls back to the in-process limiter when Redis fails", async () => {
    const limiter = new RedisRateLimiter({
      eval: vi.fn().mockRejectedValue(new Error("connection refused"))
    });
    const first = await limiter.consume("fallback", 2, 60_000);
    const second = await limiter.consume("fallback", 2, 60_000);
    const third = await limiter.consume("fallback", 2, 60_000);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(false);
  });

  it("resets the Redis key and the fallback", async () => {
    const client = { eval: vi.fn().mockResolvedValue([1, 1000]), del: vi.fn().mockResolvedValue(1) };
    const limiter = new RedisRateLimiter(client);
    await limiter.reset("scope:key");
    expect(client.del).toHaveBeenCalledWith("studio:rl:scope:key");
  });
});
