import { NextResponse } from "next/server";
import { requireUserId } from "@/src/platform/auth";
import { toErrorResponse } from "@/src/platform/http";
import { enqueueJob, serializeJob } from "@/src/platform/jobs";
import { createUserWorkspace } from "@/src/platform/workspace";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json().catch(() => null);
    if (!body?.templateId) {
      return NextResponse.json({ error: "缺少 POP 模板参数。" }, { status: 400 });
    }

    if (body.productId) {
      const workspace = createUserWorkspace(userId);
      const product = await workspace.productRegistry.getProduct(String(body.productId));
      if (!product) {
        return NextResponse.json({ error: "产品不存在，请先在素材库创建产品。" }, { status: 400 });
      }
    }

    const job = await enqueueJob({
      userId,
      type: "pop-scene",
      payload: body
    });

    return NextResponse.json({ job: serializeJob(job), async: true }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
