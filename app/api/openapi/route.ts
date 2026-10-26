import { NextResponse } from "next/server";
import { OPENAPI_SPEC } from "@/src/platform/openapi";

export const dynamic = "force-static";

/** Public API description (contains no secrets). */
export function GET() {
  return NextResponse.json(OPENAPI_SPEC, {
    headers: { "Cache-Control": "public, max-age=300" }
  });
}
