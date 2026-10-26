import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { prisma } from "@/src/platform/db";

export const dynamic = "force-dynamic";

const MAX_ROWS = 1000;

/**
 * Machine-readable export of the caller's own data (GDPR-style portability).
 * Secrets (password hash, token hashes, webhook secrets) and storage keys are
 * never included.
 */
export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:export", limit: 3, windowMs: 15 * 60_000 } },
    async (ctx) => {
      const userId = ctx.userId as string;
      const [
        user,
        settings,
        products,
        assets,
        jobs,
        costs,
        audits,
        apiTokens,
        webhooks,
        sessions
      ] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            disabled: true,
            monthlyBudgetUnits: true,
            totpEnabled: true,
            createdAt: true,
            updatedAt: true
          }
        }),
        prisma.userSettings.findUnique({ where: { userId } }),
        prisma.product.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
        prisma.asset.findMany({
          where: { userId },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            productId: true,
            type: true,
            filename: true,
            url: true,
            contentType: true,
            sizeBytes: true,
            createdAt: true
          },
          take: MAX_ROWS
        }),
        prisma.generationJob.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: MAX_ROWS,
          select: {
            id: true,
            type: true,
            status: true,
            progress: true,
            attempts: true,
            error: true,
            createdAt: true,
            finishedAt: true
          }
        }),
        prisma.costRecord.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: MAX_ROWS
        }),
        prisma.auditLog.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: MAX_ROWS
        }),
        prisma.apiToken.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            prefix: true,
            scopes: true,
            lastUsedAt: true,
            expiresAt: true,
            revokedAt: true,
            createdAt: true
          }
        }),
        prisma.webhookEndpoint.findMany({
          where: { userId },
          select: {
            id: true,
            url: true,
            events: true,
            enabled: true,
            createdAt: true
          }
        }),
        prisma.authSession.findMany({
          where: { userId },
          select: {
            id: true,
            userAgent: true,
            ip: true,
            createdAt: true,
            lastSeenAt: true,
            revokedAt: true
          }
        })
      ]);

      await recordAudit({
        userId,
        actorRole: ctx.role,
        action: "account.data_export",
        targetType: "user",
        targetId: userId,
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      const payload = {
        format: "midea-ai-content-studio-export",
        version: 1,
        generatedAt: new Date().toISOString(),
        user,
        settings,
        products,
        assets,
        jobs,
        costs,
        auditLogs: audits,
        apiTokens,
        webhooks,
        sessions
      };

      const filename = `studio-data-export-${userId}.json`;
      return new NextResponse(JSON.stringify(payload, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store"
        }
      });
    }
  );
}
