import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";

export const dynamic = "force-dynamic";

/**
 * Liveness probe: process is up and serving requests. No database access, so it
 * stays green during transient infrastructure problems.
 */
export function GET(request: Request) {
  return handleApi(request, { auth: "public", rateLimit: false }, async (ctx) => {
    return NextResponse.json({
      status: "ok",
      uptimeSec: Math.round(process.uptime()),
      version: process.env.APP_VERSION ?? process.env.npm_package_version ?? "0.1.0",
      timestamp: new Date().toISOString(),
      requestId: ctx.requestId
    });
  });
}
