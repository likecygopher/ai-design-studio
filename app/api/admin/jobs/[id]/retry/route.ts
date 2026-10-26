import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { retryJobForActor, serializeJob } from "@/src/platform/jobs";

export const dynamic = "force-dynamic";

/** Admin retry for any user's failed/cancelled job. */
export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:jobs:retry", limit: 30, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      const job = await retryJobForActor({
        jobId: id,
        actorUserId: ctx.userId ?? "",
        actorRole: ctx.role,
        isAdmin: true,
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      ctx.log.info("admin.job.retry", { originalJobId: id, jobId: job.id });
      return NextResponse.json({ job: serializeJob(job) }, { status: 201 });
    }
  );
}
