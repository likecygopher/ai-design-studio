import { NextResponse } from "next/server";
import { requireUserId } from "@/src/platform/auth";
import { toErrorResponse } from "@/src/platform/http";
import { getBudgetSnapshot } from "@/src/platform/quotas";
import { createUserWorkspace } from "@/src/platform/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    const [records, budget] = await Promise.all([
      createUserWorkspace(userId).costLedger.readRecords(),
      getBudgetSnapshot(userId)
    ]);
    return NextResponse.json({ records, budget });
  } catch (error) {
    return toErrorResponse(error);
  }
}
