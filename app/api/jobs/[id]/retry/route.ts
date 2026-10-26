import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { serializeJob, retryJobForActor } from "@/src/platform/jobs";

export const dynamic = "force-dynamic";

/**
 * Retry one of the caller's failed/cancelled jobs as a new job
 * (`POST /api/jobs/{id}/retry`). Budget/quota checks apply to the new job.
 */
export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "jobs:retry", limit: 20, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      const job = await retryJobForActor({
        jobId: id,
        actorUserId: ctx.userId ?? "",
        actorRole: ctx.role,
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      ctx.log.info("job.retry", { originalJobId: id, jobId: job.id });
      return NextResponse.json({ job: serializeJob(job) }, { status: 201 });
    }
  );
}
