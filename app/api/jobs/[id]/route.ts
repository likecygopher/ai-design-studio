import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { NotFoundError } from "@/src/platform/errors";
import { getJobForUser, serializeJob } from "@/src/platform/jobs";

export const dynamic = "force-dynamic";

export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "jobs:status", limit: 180, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      const job = await getJobForUser(id, ctx.userId ?? "");
      if (!job) {
        // Cross-user access is indistinguishable from a missing job (spec R2.3).
        throw new NotFoundError("任务不存在。");
      }
      return NextResponse.json(
        { job: serializeJob(job) },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
  );
}
