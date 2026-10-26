import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { listAuthSessions } from "@/src/platform/sessions";

export const dynamic = "force-dynamic";

/** List the caller's active device sessions. */
export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:sessions:read", limit: 60, windowMs: 60_000 } },
    async (ctx) => {
      const sessions = await listAuthSessions(ctx.userId as string, ctx.sessionId);
      return NextResponse.json({ sessions }, { headers: { "Cache-Control": "no-store" } });
    }
  );
}
