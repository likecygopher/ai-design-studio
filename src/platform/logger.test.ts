import { describe, expect, it } from "vitest";
import { createLogger, redactFields } from "./logger";

describe("redactFields", () => {
  it("masks sensitive keys at any depth", () => {
    const redacted = redactFields({
      userId: "u1",
      password: "p@ss",
      nested: {
        apiKey: "sk-123",
        authorization: "Bearer abc",
        keep: "ok",
        deeper: { authSecret: "secret" }
      }
    });

    expect(redacted).toMatchObject({
      userId: "u1",
      password: "[redacted]",
      nested: {
        apiKey: "[redacted]",
        authorization: "[redacted]",
        keep: "ok",
        deeper: { authSecret: "[redacted]" }
      }
    });
  });

  it("masks cookie-ish keys case-insensitively", () => {
    expect(redactFields({ "Set-Cookie": "a=b", COOKIE: "c=d" })).toEqual({
      "Set-Cookie": "[redacted]",
      COOKIE: "[redacted]"
    });
  });

  it("serializes errors and dates for structured logs", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    const redacted = redactFields({
      err: new Error("boom"),
      at: date,
      big: BigInt(10)
    });

    expect(redacted.err).toMatchObject({ name: "Error", message: "boom" });
    expect(redacted.at).toBe("2026-01-01T00:00:00.000Z");
    expect(redacted.big).toBe("10");
  });

  it("bounds recursion depth and array length", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 10; i += 1) {
      const next: Record<string, unknown> = {};
      cursor[nextKey(i)] = next;
      cursor = next;
    }

    const redacted = redactFields({ deep });
    expect(JSON.stringify(redacted)).toContain("[max-depth]");

    const longArray = redactFields({ items: Array.from({ length: 80 }, (_, i) => i) });
    expect((longArray.items as number[]).length).toBe(50);
  });
});

function nextKey(index: number): string {
  return `k${index}`;
}

describe("createLogger", () => {
  it("returns a child logger that keeps base fields", () => {
    const logger = createLogger({ requestId: "req_1" });
    const child = logger.child({ userId: "u1" });
    // Smoke test: none of these calls should throw.
    expect(() => child.info("hello", { path: "/api/x" })).not.toThrow();
  });

  it("does not throw on circular structures", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => redactFields({ circular })).not.toThrow();
  });
});
