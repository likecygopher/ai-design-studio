import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { prisma } from "@/src/platform/db";
import { getWorkerHealth } from "@/src/platform/worker-heartbeat";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleApi(request, { auth: "admin", rateLimit: { name: "admin:stats" } }, async (ctx) => {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [userCount, jobsByStatus, failedLast24h, queuedCount, runningCount, assetAggregate, topUsers, workers] =
      await Promise.all([
        prisma.user.count(),
        prisma.generationJob.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.generationJob.count({
          where: { status: "failed", updatedAt: { gte: since24h } }
        }),
        prisma.generationJob.count({ where: { status: "queued" } }),
        prisma.generationJob.count({ where: { status: "running" } }),
        prisma.asset.aggregate({ _sum: { sizeBytes: true }, _count: { _all: true } }),
        prisma.asset.groupBy({
          by: ["userId"],
          _sum: { sizeBytes: true },
          orderBy: { _sum: { sizeBytes: "desc" } },
          take: 5
        }),
        getWorkerHealth()
      ]);

    const jobStatusCounts: Record<string, number> = {};
    for (const row of jobsByStatus) {
      jobStatusCounts[row.status] = row._count._all;
    }

    const totalJobs = Object.values(jobStatusCounts).reduce((sum, count) => sum + count, 0);
    const failedJobs = jobStatusCounts.failed ?? 0;

    await recordAudit({
      userId: ctx.userId,
      actorRole: ctx.role,
      action: "admin.stats.read",
      targetType: "platform",
      ip: ctx.ip,
      requestId: ctx.requestId
    });

    return NextResponse.json({
      users: { total: userCount },
      jobs: {
        total: totalJobs,
        byStatus: jobStatusCounts,
        queued: queuedCount,
        running: runningCount,
        failedLast24h,
        failureRate: totalJobs > 0 ? Number((failedJobs / totalJobs).toFixed(4)) : 0
      },
      storage: {
        assets: assetAggregate._count._all,
        bytes: assetAggregate._sum.sizeBytes ?? 0,
        topUsers: topUsers.map((row) => ({
          userId: row.userId,
          bytes: row._sum.sizeBytes ?? 0
        }))
      },
      workers,
      generatedAt: new Date().toISOString()
    });
  });
}
