import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { prisma } from "@/src/platform/db";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  action: z.string().trim().max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000)
});

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Admin audit-log CSV export (bounded, audited). */
export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:audit:export", limit: 10, windowMs: 60_000 } },
    async (ctx) => {
      const url = new URL(request.url);
      const parsed = querySchema.safeParse({
        action: url.searchParams.get("action") ?? undefined,
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined
      });
      if (!parsed.success) {
        return NextResponse.json(
          { error: "查询参数无效。", code: "VALIDATION_ERROR", requestId: ctx.requestId },
          { status: 400 }
        );
      }
      const { action, from, to, limit } = parsed.data;

      const rows = await prisma.auditLog.findMany({
        where: {
          ...(action ? { action } : {}),
          ...(from || to
            ? {
                createdAt: {
                  ...(from ? { gte: new Date(from) } : {}),
                  ...(to ? { lte: new Date(to) } : {})
                }
              }
            : {})
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        select: {
          id: true,
          createdAt: true,
          action: true,
          actorRole: true,
          userId: true,
          targetType: true,
          targetId: true,
          ip: true,
          requestId: true,
          metadata: true,
          user: { select: { email: true } }
        }
      });

      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "admin.audit_export",
        targetType: "platform",
        metadata: { rows: rows.length, action, from, to },
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      const header = [
        "createdAt",
        "action",
        "actorRole",
        "userEmail",
        "userId",
        "targetType",
        "targetId",
        "ip",
        "requestId",
        "metadata"
      ];
      const lines = [
        header.join(","),
        ...rows.map((row) =>
          [
            row.createdAt.toISOString(),
            row.action,
            row.actorRole,
            row.user?.email ?? "",
            row.userId,
            row.targetType,
            row.targetId,
            row.ip,
            row.requestId,
            row.metadata ? JSON.stringify(row.metadata) : ""
          ]
            .map(csvCell)
            .join(",")
        )
      ];
      const filename = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;

      return new NextResponse(`\uFEFF${lines.join("\n")}\n`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store"
        }
      });
    }
  );
}
