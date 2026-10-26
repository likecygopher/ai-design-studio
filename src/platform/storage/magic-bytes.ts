/**
 * File signature (magic bytes) validation for user uploads.
 *
 * Constitution §2.3: never trust the client `content-type`; a file must be
 * probed by its leading bytes. The five allowed families are PNG, JPEG, WebP,
 * PDF and MP4 (spec R5.1 / design §7).
 *
 * SVG is never accepted from clients: it is an XML document that can carry
 * scripts and is a well-known stored-XSS vector on same-origin static paths
 * (constitution §4). Server-generated SVG (deterministic template engines) does
 * not go through this module.
 */
import { UnsupportedMediaTypeError } from "@/src/platform/errors";

export type SupportedMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "application/pdf"
  | "video/mp4";

export const SUPPORTED_MIME_TYPES: readonly SupportedMimeType[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "video/mp4"
];

const SUPPORTED_MIME_TYPE_SET: ReadonlySet<string> = new Set(SUPPORTED_MIME_TYPES);

/** Common client aliases for the same canonical media type. */
const MIME_ALIASES: Readonly<Record<string, SupportedMimeType>> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg"
};

/**
 * Declared types clients send when they could not infer anything. The magic
 * bytes decision stands in that case (we never trust the declared value).
 */
const UNKNOWN_DECLARED_TYPES: ReadonlySet<string> = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream"
]);

const EXTENSION_BY_MIME: Readonly<Record<SupportedMimeType, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "video/mp4": ".mp4"
};

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG_SIGNATURE = Uint8Array.of(0xff, 0xd8, 0xff);
const RIFF_ASCII = "RIFF";
const WEBP_ASCII = "WEBP";
const PDF_ASCII = "%PDF";
const FTYP_ASCII = "ftyp";
const SVG_SNIFF_BYTES = 1024;

const SUPPORTED_LIST_LABEL = "PNG/JPEG/WebP/PDF/MP4";

function matchesAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.byteLength < offset + text.length) {
    return false;
  }
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

function startsWithSignature(bytes: Uint8Array, signature: Uint8Array): boolean {
  if (bytes.byteLength < signature.byteLength) {
    return false;
  }
  for (let index = 0; index < signature.byteLength; index += 1) {
    if (bytes[index] !== signature[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Cheap heuristic used only to produce a precise error message when an SVG (or
 * XML document wrapping an SVG) is uploaded. It never *accepts* anything.
 */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, SVG_SNIFF_BYTES);
  let text = "";
  try {
    text = Buffer.from(head).toString("utf8").trimStart().toLowerCase();
  } catch {
    return false;
  }
  if (text.startsWith("<svg")) {
    return true;
  }
  return text.startsWith("<?xml") && text.includes("<svg");
}

export function isSupportedMimeType(value: string): value is SupportedMimeType {
  return SUPPORTED_MIME_TYPE_SET.has(value);
}

export function isSvgMimeType(mime: string | null | undefined): boolean {
  if (!mime) {
    return false;
  }
  const normalized = normalizeDeclaredMimeType(mime);
  return normalized === "image/svg+xml" || normalized === "image/svg" || normalized === "text/svg+xml";
}

/**
 * Lowercases a declared media type and drops parameters (`; charset=...`).
 * Returns `null` for empty/missing declarations.
 */
export function normalizeDeclaredMimeType(declared?: string | null): string | null {
  if (typeof declared !== "string") {
    return null;
  }
  const normalized = declared.split(";")[0]?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

/**
 * Probes the leading bytes and returns the canonical media type, or `null` when
 * the payload is empty or is not one of the supported families.
 */
export function detectSupportedMimeType(bytes: Uint8Array): SupportedMimeType | null {
  if (!bytes || bytes.byteLength === 0) {
    return null;
  }

  if (startsWithSignature(bytes, PNG_SIGNATURE)) {
    return "image/png";
  }
  if (startsWithSignature(bytes, JPEG_SIGNATURE)) {
    return "image/jpeg";
  }
  if (matchesAscii(bytes, 0, RIFF_ASCII) && matchesAscii(bytes, 8, WEBP_ASCII)) {
    return "image/webp";
  }
  if (matchesAscii(bytes, 0, PDF_ASCII)) {
    return "application/pdf";
  }
  // ISO base media files (MP4/MOV) carry the `ftyp` box brand at offset 4.
  if (matchesAscii(bytes, 4, FTYP_ASCII)) {
    return "video/mp4";
  }
  return null;
}

export function extensionForMimeType(mime: SupportedMimeType): string {
  return EXTENSION_BY_MIME[mime];
}

export type ValidatedUploadContent = {
  /** Canonical type decided by the magic bytes — not by the client. */
  contentType: SupportedMimeType;
  extension: string;
};

function canonicalDeclaredMimeType(declared: string): string {
  return MIME_ALIASES[declared] ?? declared;
}

/**
 * Validates an uploaded file and returns the trustworthy media type.
 *
 * Rules:
 * - SVG is always rejected (415), no matter what is declared.
 * - Empty / unrecognized payloads are rejected (415).
 * - A declared type must be supported and must match the detected bytes (415).
 * - Missing / generic declared types (`""`, `application/octet-stream`) fall
 *   back to the detected type instead of failing.
 */
export function assertSupportedUploadContent(
  bytes: Uint8Array,
  declaredMimeType?: string | null
): ValidatedUploadContent {
  const declared = normalizeDeclaredMimeType(declaredMimeType);

  if (isSvgMimeType(declared)) {
    throw new UnsupportedMediaTypeError(
      "出于安全原因，不支持上传 SVG 文件。请先导出为 PNG/JPEG/WebP 后再上传。"
    );
  }

  const detected = detectSupportedMimeType(bytes);
  if (!detected) {
    if (looksLikeSvg(bytes)) {
      throw new UnsupportedMediaTypeError(
        "出于安全原因，不支持上传 SVG 文件。请先导出为 PNG/JPEG/WebP 后再上传。"
      );
    }
    throw new UnsupportedMediaTypeError(
      `无法识别上传文件的内容，仅支持 ${SUPPORTED_LIST_LABEL}。`
    );
  }

  if (declared && !UNKNOWN_DECLARED_TYPES.has(declared)) {
    const canonical = canonicalDeclaredMimeType(declared);
    if (!isSupportedMimeType(canonical)) {
      throw new UnsupportedMediaTypeError(
        `不支持的文件类型：${declared}。仅支持 ${SUPPORTED_LIST_LABEL}。`
      );
    }
    if (canonical !== detected) {
      throw new UnsupportedMediaTypeError(
        `文件内容（${detected}）与声明类型（${canonical}）不一致，请检查文件是否被伪装。`
      );
    }
  }

  return { contentType: detected, extension: EXTENSION_BY_MIME[detected] };
}
