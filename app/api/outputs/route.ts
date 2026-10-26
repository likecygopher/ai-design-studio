import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { createUserWorkspace } from "@/src/platform/workspace";

export const dynamic = "force-dynamic";

/**
 * Lists the current user's generated outputs only.
 *
 * Previously this scanned the whole `public/generated` directory, which leaked
 * every user's filenames. Ownership now comes from the per-user asset manifest.
 */
export function GET(request: Request) {
  return handleApi(request, { auth: "user" }, async (ctx) => {
    const manifest = await createUserWorkspace(ctx.userId!).imageStore.readAssetManifest();
    const outputs = manifest
      .filter((asset) => asset.source === "generated")
      .map((asset) => ({
        url: asset.url,
        filename: asset.filename,
        taskId: asset.metadata?.taskId ?? "",
        contentType: asset.metadata?.contentType ?? null
      }));

    return NextResponse.json({ outputs });
  });
}
