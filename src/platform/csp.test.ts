import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, createCspNonce } from "./csp";

describe("CSP nonce", () => {
  it("creates a unique base64 nonce", () => {
    const first = createCspNonce();
    const second = createCspNonce();
    expect(first).not.toBe(second);
    expect(Buffer.from(first, "base64").byteLength).toBe(16);
  });

  it("allows the nonce without unsafe-inline scripts", () => {
    const nonce = "abc123";
    const policy = buildContentSecurityPolicy(nonce, true);
    expect(policy).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(policy).not.toContain("'unsafe-inline' 'unsafe");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("allows unsafe-eval only in development", () => {
    expect(buildContentSecurityPolicy("n", false)).toContain("'unsafe-eval'");
    expect(buildContentSecurityPolicy("n", true)).not.toContain("'unsafe-eval'");
  });
});
