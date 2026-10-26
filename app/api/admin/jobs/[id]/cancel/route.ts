import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { cancelJobForAdmin, serializeJob } from "@/src/platform/jobs";

export const dynamic = "force-dynamic";

/** Admin cancellation for a job owned by another account. */
export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:jobs:cancel", limit: 30, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      const { job, previousStatus } = await cancelJobForAdmin({
        jobId: id,
        actorUserId: ctx.userId ?? "",
        actorRole: ctx.role,
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      ctx.log.info("admin.job.cancel", { jobId: id, previousStatus });
      return NextResponse.json({ job: serializeJob(job), previousStatus });
    }
  );
}
