// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  recordAudit: vi.fn()
}));

vi.mock("@/src/platform/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/src/platform/db", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique, create: mocks.create }
  }
}));

import { defaultRateLimiter } from "@/src/platform/rate-limit";
import { POST } from "./route";

function request(body: unknown, ip = "10.0.0.1") {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  defaultRateLimiter.reset();
  mocks.findUnique.mockReset().mockResolvedValue(null);
  mocks.create.mockReset().mockResolvedValue({ id: "u1", email: "new@example.com", name: "New" });
  mocks.recordAudit.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/auth/register", () => {
  it("rejects weak passwords with a validation error", async () => {
    const response = await POST(request({ email: "new@example.com", password: "short" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details.issues.some((issue: { path: string }) => issue.path === "password")).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("requires both letters and digits in the password", async () => {
    const lettersOnly = await POST(request({ email: "a@example.com", password: "abcdefgh" }));
    expect(lettersOnly.status).toBe(400);

    const digitsOnly = await POST(request({ email: "b@example.com", password: "12345678" }));
    expect(digitsOnly.status).toBe(400);

    const valid = await POST(request({ email: "c@example.com", password: "abcdefg1" }));
    expect(valid.status).toBe(201);
  });

  it("rejects an invalid email", async () => {
    const response = await POST(request({ email: "not-an-email", password: "abcdefg1" }));
    expect(response.status).toBe(400);
  });

  it("normalizes the email to lower case before lookup", async () => {
    const response = await POST(request({ email: "  MixedCase@Example.COM ", password: "abcdefg1" }));

    expect(response.status).toBe(201);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { email: "mixedcase@example.com" }
    });
  });

  it("returns 409 EMAIL_TAKEN when the email already exists", async () => {
    mocks.findUnique.mockResolvedValue({ id: "existing" });

    const response = await POST(request({ email: "dupe@example.com", password: "abcdefg1" }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("EMAIL_TAKEN");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates the user, default settings and an audit entry", async () => {
    const response = await POST(request({ email: "new@example.com", password: "abcdefg1", name: "New" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.user).toEqual({ id: "u1", email: "new@example.com", name: "New" });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "new@example.com",
          settings: { create: { country: "Mexico", language: "Spanish" } }
        })
      })
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.register", targetId: "u1" })
    );
  });

  it("rate limits registration attempts per IP", async () => {
    for (let i = 0; i < 10; i += 1) {
      await POST(request({ email: `u${i}@example.com`, password: "abcdefg1" }, "10.9.9.9"));
    }

    const response = await POST(
      request({ email: "blocked@example.com", password: "abcdefg1" }, "10.9.9.9")
    );

    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe("RATE_LIMITED");
    expect(response.headers.get("retry-after")).toBeTruthy();
  });
});
