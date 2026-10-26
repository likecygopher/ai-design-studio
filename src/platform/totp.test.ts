// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  consumeRecoveryCode,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp
} from "./totp";

describe("base32", () => {
  it("round-trips arbitrary bytes without padding", () => {
    const buffer = Buffer.from("12345678901234567890", "ascii");
    const encoded = base32Encode(buffer);
    expect(encoded).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(encoded).toString("ascii")).toBe("12345678901234567890");
  });

  it("rejects invalid characters", () => {
    expect(() => base32Decode("GEZD!")).toThrow();
  });
});

describe("TOTP (RFC 6238 SHA1 vectors)", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const vectors: Array<[number, string]> = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"]
  ];

  it.each(vectors)("matches the RFC vector at t=%i", (seconds, expected) => {
    expect(generateTotp(secret, { timestamp: seconds * 1000, digits: 8 })).toBe(expected);
  });

  it("verifies the current code and rejects a wrong one", () => {
    const timestamp = 1_700_000_000_000;
    const code = generateTotp(secret, { timestamp });
    expect(verifyTotp(secret, code, { timestamp })).toBe(true);
    expect(verifyTotp(secret, "000000", { timestamp })).toBe(false);
  });

  it("tolerates one step of clock skew but not two", () => {
    const timestamp = 1_700_000_000_000;
    const previous = generateTotp(secret, { timestamp: timestamp - 30_000 });
    expect(verifyTotp(secret, previous, { timestamp })).toBe(true);
    const farPrevious = generateTotp(secret, { timestamp: timestamp - 90_000 });
    expect(verifyTotp(secret, farPrevious, { timestamp })).toBe(false);
  });

  it("generates unique secrets and an otpauth URI", () => {
    const first = generateTotpSecret();
    const second = generateTotpSecret();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(32);

    const uri = buildOtpauthUri({ secret: first, account: "demo@midea.local" });
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("secret=" + first);
    expect(uri).toContain("issuer=Midea");
  });
});

describe("recovery codes", () => {
  it("generates readable one-time codes and consumes them exactly once", () => {
    const codes = generateRecoveryCodes(3);
    expect(codes).toHaveLength(3);
    expect(codes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

    const hashes = codes.map(hashRecoveryCode);
    const consumed = consumeRecoveryCode(hashes, codes[1]);
    expect(consumed.ok).toBe(true);
    expect(consumed.remaining).toHaveLength(2);
    expect(consumeRecoveryCode(consumed.remaining, codes[1]).ok).toBe(false);

    // Case and separators are normalized.
    expect(consumeRecoveryCode(hashes, codes[0].toLowerCase()).ok).toBe(true);
    expect(consumeRecoveryCode(hashes, "AAAAA-AAAAA").ok).toBe(false);
  });
});
