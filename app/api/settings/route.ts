import { NextResponse } from "next/server";
import { requireUserId } from "@/src/platform/auth";
import { toErrorResponse } from "@/src/platform/http";
import { createUserWorkspace } from "@/src/platform/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    const settings = await createUserWorkspace(userId).settingsStore.read();
    return NextResponse.json({ settings });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json().catch(() => null);

    if (!body?.country || !body?.language) {
      return NextResponse.json({ error: "缺少 country 或 language。" }, { status: 400 });
    }

    const settings = await createUserWorkspace(userId).settingsStore.save({
      country: String(body.country),
      language: String(body.language)
    });

    return NextResponse.json({ settings });
  } catch (error) {
    return toErrorResponse(error);
  }
}
