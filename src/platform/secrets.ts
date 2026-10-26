import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Symmetric encryption for platform-managed secrets (AI provider keys).
 *
 * - AES-256-GCM with a random 96-bit IV and authentication tag.
 * - Key material is derived from `AI_CONFIG_SECRET` (preferred) or `AUTH_SECRET`.
 * - Stored format: `enc:v1:<iv b64>:<tag b64>:<ciphertext b64>`.
 * - Plaintext values written by earlier versions are returned unchanged, so the
 *   reader is backward compatible.
 */

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function encryptionKey(): Buffer {
  const secret =
    process.env.AI_CONFIG_SECRET?.trim() || process.env.AUTH_SECRET?.trim();

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AI_CONFIG_SECRET or AUTH_SECRET is required to encrypt platform secrets."
      );
    }
    // Development/test only: deterministic non-production key.
    return createHash("sha256").update("dev-only-ai-config-secret").digest();
  }

  return createHash("sha256").update(secret).digest();
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) {
    return "";
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX.slice(0, -1),
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64")
  ].join(":");
}

export function decryptSecret(payload: string): string {
  if (!isEncryptedSecret(payload)) {
    return payload;
  }

  const parts = payload.split(":");
  // enc:v1:<iv>:<tag>:<ciphertext>
  if (parts.length !== 5) {
    throw new Error("Invalid encrypted secret payload.");
  }

  const [, , ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Invalid encrypted secret payload.");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Mask a secret for read endpoints/logs: never return more than the last 4 chars. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const tail = value.slice(-4);
  return `••••••${tail}`;
}

/** Last four characters, used in field placeholders. */
export function secretHint(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return `末四位 ${value.slice(-4)}`;
}
