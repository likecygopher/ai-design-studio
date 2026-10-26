import { join } from "node:path";
import { getSessionUser } from "@/src/platform/auth";
import { serveOwnedRuntimeFile } from "@/src/platform/runtime-file-response";

const UPLOADS_ROOT = join(process.cwd(), "public", "uploads");

// Serves files uploaded after `next build`; static public/ serving only covers
// files that existed at build time. Ownership is enforced per path segment.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json(
      { error: "请先登录后再访问文件。", code: "AUTH_REQUIRED" },
      { status: 401 }
    );
  }

  const { path } = await params;
  return serveOwnedRuntimeFile(UPLOADS_ROOT, path, user);
}
