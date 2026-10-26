import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { prisma } from "@/src/platform/db";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]).optional(),
  approval: z.enum(["pending", "approved"]).optional(),
  userId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).optional()
});

export function GET(request: Request) {
  return handleApi(request, { auth: "admin", rateLimit: { name: "admin:jobs" } }, async (ctx) => {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      userId: url.searchParams.get("userId") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "查询参数无效。", code: "VALIDATION_ERROR", requestId: ctx.requestId },
        { status: 400 }
      );
    }

    const { status, userId, approval, limit, cursor } = parsed.data;
    const rows = await prisma.generationJob.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(userId ? { userId } : {}),
        ...(approval === "pending"
          ? { requiresApproval: true, approvedAt: null }
          : approval === "approved"
            ? { approvedAt: { not: null } }
            : {})
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        userId: true,
        type: true,
        status: true,
        progress: true,
        attempts: true,
        maxAttempts: true,
        error: true,
        requiresApproval: true,
        approvedAt: true,
        approvedBy: true,
        approvalNote: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true
      }
    });

    const hasMore = rows.length > limit;
    const jobs = hasMore ? rows.slice(0, limit) : rows;

    await recordAudit({
      userId: ctx.userId,
      actorRole: ctx.role,
      action: "admin.job.list",
      targetType: "job",
      ip: ctx.ip,
      requestId: ctx.requestId
    });

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        userId: job.userId,
        type: job.type,
        status: job.status,
        progress: job.progress,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        error: job.error,
        requiresApproval: job.requiresApproval,
        approvedAt: job.approvedAt?.toISOString() ?? null,
        approvedBy: job.approvedBy,
        approvalNote: job.approvalNote,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null
      })),
      nextCursor: hasMore ? jobs[jobs.length - 1]?.id ?? null : null
    });
  });
}
