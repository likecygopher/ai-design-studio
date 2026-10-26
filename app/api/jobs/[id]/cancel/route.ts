import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { cancelJob, serializeJob } from "@/src/platform/jobs";

export const dynamic = "force-dynamic";

/**
 * Cancel the caller's job (SDD T43).
 * - queued → cancelled immediately
 * - running → cancellation marker; the worker finalises at its next checkpoint
 * - terminal → 409 JOB_NOT_CANCELLABLE
 * - another user's / unknown id → 404
 */
export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "jobs:cancel", limit: 30, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      const { job, previousStatus } = await cancelJob(id, ctx.userId ?? "");

      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "job.cancel",
        targetType: "job",
        targetId: id,
        metadata: { previousStatus },
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      ctx.log.info("job.cancel", { jobId: id, previousStatus });

      return NextResponse.json({ job: serializeJob(job) });
    }
  );
}
