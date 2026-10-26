import { NextResponse } from "next/server";
import { listPublicSsoProviders } from "@/src/platform/organization-sso";

export const dynamic = "force-dynamic";

export async function GET() {
  const providers = await listPublicSsoProviders();
  return NextResponse.json({ providers });
}
