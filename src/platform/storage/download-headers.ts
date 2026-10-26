/**
 * Download-header helpers for the private asset route (spec R5.3).
 *
 * Extracted from the route module because Next.js rejects non-handler exports
 * from `route.ts` files, and these are unit-tested directly.
 */

const INLINE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  // PDF is rendered inline by design; served with `nosniff` + `private`.
  "application/pdf"
]);

/**
 * Builds a header-safe filename: path components and control characters are
 * stripped so a crafted `Asset.filename` cannot inject headers.
 */
export function sanitizeDownloadFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/["\\]/g, "_")
    .trim()
    .slice(0, 180);
  if (cleaned.replace(/[_\s.]+/g, "").length === 0) {
    return "asset";
  }
  return cleaned;
}

export function buildContentDisposition(contentType: string, filename: string): string {
  const safeName = sanitizeDownloadFilename(filename);
  const disposition = INLINE_CONTENT_TYPES.has(contentType) ? "inline" : "attachment";
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}
