import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  maskSecret,
  secretHint
} from "./secrets";

describe("secret encryption", () => {
  it("round-trips plaintext with a versioned payload", () => {
    const payload = encryptSecret("sk-test-1234567890");

    expect(payload.startsWith("enc:v1:")).toBe(true);
    expect(payload).not.toContain("sk-test-1234567890");
    expect(isEncryptedSecret(payload)).toBe(true);
    expect(decryptSecret(payload)).toBe("sk-test-1234567890");
  });

  it("produces different ciphertexts for the same plaintext", () => {
    const first = encryptSecret("same-secret");
    const second = encryptSecret("same-secret");
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe("same-secret");
    expect(decryptSecret(second)).toBe("same-secret");
  });

  it("rejects tampered payloads", () => {
    const payload = encryptSecret("secret-value");
    const parts = payload.split(":");
    const tampered = [...parts];
    tampered[4] = Buffer.from("different").toString("base64");
    expect(() => decryptSecret(tampered.join(":"))).toThrow();
  });

  it("passes through plaintext values written before encryption existed", () => {
    expect(decryptSecret("legacy-plain-key")).toBe("legacy-plain-key");
    expect(isEncryptedSecret("legacy-plain-key")).toBe(false);
  });

  it("handles empty values", () => {
    expect(encryptSecret("")).toBe("");
    expect(maskSecret("")).toBe("");
    expect(secretHint("")).toBe("");
  });
});

describe("secret masking", () => {
  it("only reveals the last four characters", () => {
    expect(maskSecret("sk-abcdefgh1234")).toBe("••••••1234");
    expect(maskSecret("sk-abcdefgh1234")).not.toContain("abcdefgh");
    expect(secretHint("sk-abcdefgh1234")).toBe("末四位 1234");
  });
});
