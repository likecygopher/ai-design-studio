import { handleApi } from "@/src/platform/api";
import { NotFoundError } from "@/src/platform/errors";
import { buildContentDisposition } from "@/src/platform/storage/download-headers";
import { createUserWorkspace } from "@/src/platform/workspace";

/**
 * Private asset streaming (spec R5.3, design §7).
 *
 * The storage root lives under `public/`, so files are technically reachable by
 * their static URL (kept for backwards compatibility, P1 will converge). This
 * route is the *authorised* access path: the lookup is scoped by `userId`, so a
 * cross-user id yields 404 (no existence disclosure — constitution §4).
 */
export const dynamic = "force-dynamic";

/** cuid/uuid-like ids; anything else can never match a row, so answer 404. */
const SAFE_ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "assets:file", limit: 300 } },
    async (ctx) => {
      const { id } = await context.params;
      if (typeof id !== "string" || !SAFE_ASSET_ID.test(id)) {
        throw new NotFoundError("资源不存在。");
      }

      const userId = ctx.userId as string;
      const store = createUserWorkspace(userId).imageStore;
      const file = await store.readAssetBytes(id);
      if (!file) {
        throw new NotFoundError("资源不存在。");
      }

      const contentType = file.contentType || "application/octet-stream";
      const headers = new Headers({
        "Content-Type": contentType,
        "Content-Length": String(file.bytes.byteLength),
        "Content-Disposition": buildContentDisposition(contentType, file.filename),
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff"
      });
      if (contentType === "image/svg+xml") {
        // Defence in depth: generated SVG assets are downloadable, never
        // executable documents on our origin.
        headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
      }

      return new Response(new Uint8Array(file.bytes), { status: 200, headers });
    }
  );
}
