import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { approveJob, serializeJob } from "@/src/platform/jobs";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  note: z.string().trim().max(200).optional()
});

/** Approve a pending job so workers can claim it. */
export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:jobs:approve", limit: 60, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      const body = await ctx.body(bodySchema);
      const job = await approveJob({
        jobId: id,
        adminId: ctx.userId as string,
        actorRole: ctx.role,
        note: body.note,
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      ctx.log.info("admin.job.approve", { jobId: id });
      return NextResponse.json({ job: serializeJob(job) });
    }
  );
}
