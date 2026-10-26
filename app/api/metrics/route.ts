import { NextResponse } from "next/server";
import { getSessionUser } from "@/src/platform/auth";
import { PLATFORM_CONFIG } from "@/src/platform/config";
import { renderMetrics } from "@/src/platform/metrics";

export const dynamic = "force-dynamic";

/**
 * Prometheus scrape endpoint.
 *
 * - With `METRICS_TOKEN` configured, `Authorization: Bearer <token>` allows
 *   scrape agents without a session.
 * - Otherwise an authenticated admin session is required.
 */
export async function GET(request: Request) {
  const configuredToken = PLATFORM_CONFIG.metricsToken;
  const authorization = request.headers.get("authorization") ?? "";
  if (configuredToken && authorization === `Bearer ${configuredToken}`) {
    return new NextResponse(renderMetrics(), { headers: METRICS_HEADERS });
  }

  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json(
      { error: "需要管理员会话或有效的 Metrics Token。", code: "FORBIDDEN" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  return new NextResponse(renderMetrics(), { headers: METRICS_HEADERS });
}

const METRICS_HEADERS = {
  "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
  "Cache-Control": "no-store"
};
