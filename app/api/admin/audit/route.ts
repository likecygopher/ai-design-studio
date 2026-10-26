import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { prisma } from "@/src/platform/db";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  action: z.string().trim().max(80).optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().trim().min(1).max(120).optional()
});

export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:audit", limit: 60, windowMs: 60_000 } },
    async (ctx) => {
      const url = new URL(request.url);
      const parsed = querySchema.safeParse({
        action: url.searchParams.get("action") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
        cursor: url.searchParams.get("cursor") ?? undefined
      });

      if (!parsed.success) {
        return NextResponse.json(
          { error: "查询参数无效。", code: "VALIDATION_ERROR", requestId: ctx.requestId },
          { status: 400 }
        );
      }

      const { action, q, limit, cursor } = parsed.data;
      const where = {
        ...(action ? { action } : {}),
        ...(q
          ? {
              OR: [
                { user: { email: { contains: q, mode: "insensitive" as const } } },
                { action: { contains: q, mode: "insensitive" as const } },
                { targetId: { contains: q, mode: "insensitive" as const } },
                { targetType: { contains: q, mode: "insensitive" as const } }
              ]
            }
          : {})
      };

      const [rows, actionRows] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: {
            id: true,
            action: true,
            actorRole: true,
            userId: true,
            targetType: true,
            targetId: true,
            metadata: true,
            ip: true,
            requestId: true,
            createdAt: true,
            user: { select: { email: true } }
          }
        }),
        prisma.auditLog.findMany({
          distinct: ["action"],
          select: { action: true },
          orderBy: { action: "asc" }
        })
      ]);

      const hasMore = rows.length > limit;
      const logs = hasMore ? rows.slice(0, limit) : rows;

      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "admin.audit.list",
        targetType: "platform",
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      return NextResponse.json({
        logs: logs.map((row) => ({
          id: row.id,
          action: row.action,
          actorRole: row.actorRole,
          userId: row.userId,
          userEmail: row.user?.email ?? null,
          targetType: row.targetType,
          targetId: row.targetId,
          metadata: row.metadata,
          ip: row.ip,
          requestId: row.requestId,
          createdAt: row.createdAt.toISOString()
        })),
        nextCursor: hasMore ? logs[logs.length - 1]?.id ?? null : null,
        actions: actionRows.map((row) => row.action)
      });
    }
  );
}
