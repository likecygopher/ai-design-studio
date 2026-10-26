import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Dependency-free TOTP (RFC 6238) + recovery codes (RFC 4226 HOTP base).
 * Implementing this locally avoids adding a supply-chain dependency for ~80
 * lines of well-specified cryptography.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const normalized = input.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error("Invalid base32 character");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

type TotpOptions = {
  timestamp?: number;
  stepSeconds?: number;
  digits?: number;
};

function hotp(secret: Buffer, counter: number, digits: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function generateTotp(
  secret: string,
  { timestamp = Date.now(), stepSeconds = 30, digits = 6 }: TotpOptions = {}
): string {
  const counter = Math.floor(timestamp / 1000 / stepSeconds);
  return hotp(base32Decode(secret), counter, digits);
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Verify with a ±1 step window to tolerate clock skew. */
export function verifyTotp(
  secret: string,
  code: string,
  { timestamp = Date.now(), stepSeconds = 30, digits = 6, window = 1 }: TotpOptions & {
    window?: number;
  } = {}
): boolean {
  const normalized = code.replace(/\s/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) {
    return false;
  }
  const counter = Math.floor(timestamp / 1000 / stepSeconds);
  const secretBuffer = base32Decode(secret);
  for (let offset = -window; offset <= window; offset += 1) {
    if (safeEqual(hotp(secretBuffer, counter + offset, digits), normalized)) {
      return true;
    }
  }
  return false;
}

export function buildOtpauthUri(input: {
  secret: string;
  account: string;
  issuer?: string;
}): string {
  const issuer = input.issuer ?? "Midea AI Content Studio";
  const label = encodeURIComponent(`${issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30"
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    let code = "";
    for (let i = 0; i < 10; i += 1) {
      code += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    }
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

/** Consume a one-time recovery code; returns remaining hashes on success. */
export function consumeRecoveryCode(
  hashes: string[],
  code: string
): { ok: boolean; remaining: string[] } {
  const hash = hashRecoveryCode(code);
  const index = hashes.indexOf(hash);
  if (index === -1) {
    return { ok: false, remaining: hashes };
  }
  const remaining = [...hashes];
  remaining.splice(index, 1);
  return { ok: true, remaining };
}
