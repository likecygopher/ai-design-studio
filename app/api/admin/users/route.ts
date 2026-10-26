import { hash } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { currentMonthStart } from "@/src/platform/quotas";
import { recordAudit } from "@/src/platform/audit";
import { PLATFORM_CONFIG } from "@/src/platform/config";
import { prisma } from "@/src/platform/db";
import { ensurePersonalOrganization } from "@/src/platform/organizations";
import { ConflictError, ValidationError } from "@/src/platform/errors";
import {
  ADMIN_USER_LIST_SELECT,
  ADMIN_USER_BASE_SELECT,
  createAdminUserSchema,
  generateTemporaryPassword,
  toAdminUserView,
  userRoleSchema
} from "@/src/platform/user-admin";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  role: userRoleSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).optional()
});

export function GET(request: Request) {
  return handleApi(request, { auth: "admin", rateLimit: { name: "admin:users" } }, async (ctx) => {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      role: url.searchParams.get("role") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined
    });

    if (!parsed.success) {
      throw new ValidationError("查询参数无效。", {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    const { q, role, limit, cursor } = parsed.data;
    const where = {
      ...(role ? { role } : {}),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" as const } },
              { name: { contains: q, mode: "insensitive" as const } }
            ]
          }
        : {})
    };

    const rows = await prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: ADMIN_USER_LIST_SELECT
    });

    const hasMore = rows.length > limit;
    const users = hasMore ? rows.slice(0, limit) : rows;

    const usageRows = users.length
      ? await prisma.costRecord.groupBy({
          by: ["userId"],
          where: {
            userId: { in: users.map((user) => user.id) },
            createdAt: { gte: currentMonthStart() }
          },
          _sum: { estimatedUnits: true }
        })
      : [];
    const usage: Record<string, number> = {};
    for (const row of usageRows) {
      usage[row.userId] = row._sum.estimatedUnits ?? 0;
    }

    await recordAudit({
      userId: ctx.userId,
      actorRole: ctx.role,
      action: "admin.user.list",
      targetType: "user",
      ip: ctx.ip,
      requestId: ctx.requestId
    });

    return NextResponse.json({
      users: users.map((user) => toAdminUserView(user)),
      usage,
      defaultBudgetUnits: PLATFORM_CONFIG.defaultMonthlyBudgetUnits,
      nextCursor: hasMore ? users[users.length - 1]?.id ?? null : null
    });
  });
}

export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:users:create", limit: 20, windowMs: 60_000 } },
    async (ctx) => {
      const body = await ctx.body(createAdminUserSchema);
      const email = body.email;

      const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true }
      });
      if (existing) {
        throw new ConflictError("该邮箱已注册，请直接编辑现有账号。", "EMAIL_TAKEN");
      }

      const generatedPassword = body.password ? undefined : generateTemporaryPassword();
      const password = body.password ?? generatedPassword!;
      const passwordHash = await hash(password, PLATFORM_CONFIG.bcryptCost);

      let user;
      try {
        user = await prisma.user.create({
          data: {
            email,
            name: body.name?.trim() || email.split("@")[0],
            role: body.role,
            passwordHash,
            settings: {
              create: { country: "Mexico", language: "Spanish" }
            }
          },
          select: ADMIN_USER_BASE_SELECT
        });
        void ensurePersonalOrganization(user.id).catch(() => undefined);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ConflictError("该邮箱已注册，请直接编辑现有账号。", "EMAIL_TAKEN");
        }
        throw error;
      }

      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "admin.user.create",
        targetType: "user",
        targetId: user.id,
        // Never persist the plaintext password; only how it was produced.
        metadata: { role: user.role, generatedPassword: Boolean(generatedPassword) },
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      ctx.log.info("admin.user.create", { targetUserId: user.id, role: user.role });

      return NextResponse.json(
        {
          user: toAdminUserView(user),
          ...(generatedPassword ? { temporaryPassword: generatedPassword } : {})
        },
        { status: 201 }
      );
    }
  );
}
