import { readRuntimeFile } from "@/src/services/runtime-files";

export type RuntimeFileUser = {
  id: string;
  role: string;
};

/**
 * Serve a user-owned runtime file (uploads/generated) with ownership enforcement.
 *
 * Storage layout is `/<dir>/<userId>/<...>/<file>`; only the owner (or an admin)
 * may read it. Cross-user access returns 404 so resource existence is not leaked.
 */
export async function serveOwnedRuntimeFile(
  baseDir: string,
  segments: string[],
  user: RuntimeFileUser
): Promise<Response> {
  const ownerSegment = segments[0];
  const isOwner = ownerSegment === user.id;
  const isAdmin = user.role === "admin";

  if (!ownerSegment || (!isOwner && !isAdmin)) {
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
    });
  }

  const file = await readRuntimeFile(baseDir, segments);
  if (!file) {
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": file.contentType,
    "Content-Length": String(file.bytes.byteLength),
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'"
  };

  if (isAdmin && !isOwner) {
    // Admin debugging access must never be cached by shared proxies.
    headers["Cache-Control"] = "private, no-store";
  }

  return new Response(new Uint8Array(file.bytes), { headers });
}
