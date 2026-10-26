import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { PLATFORM_CONFIG } from "@/src/platform/config";
import { prisma } from "@/src/platform/db";
import { NotFoundError } from "@/src/platform/errors";
import { revokeAllSessions } from "@/src/platform/sessions";
import {
  ADMIN_USER_BASE_SELECT,
  generateTemporaryPassword,
  resetUserPasswordSchema,
  toAdminUserView
} from "@/src/platform/user-admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/users/{id}/password — reset another user's password (R11.4).
 *
 * Incrementing `authVersion` revokes every existing session for that user. When
 * the operator resets their own password the response asks the UI to sign out.
 */
export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:users:password", limit: 30, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      const body = await ctx.body(resetUserPasswordSchema);

      const target = await prisma.user.findUnique({
        where: { id },
        select: { ...ADMIN_USER_BASE_SELECT, passwordHash: true }
      });
      if (!target) {
        throw new NotFoundError("用户不存在。");
      }

      const generatedPassword = body.password ? undefined : generateTemporaryPassword();
      const password = body.password ?? generatedPassword!;
      const passwordHash = await hash(password, PLATFORM_CONFIG.bcryptCost);

      const user = await prisma.user.update({
        where: { id },
        data: {
          passwordHash,
          authVersion: { increment: 1 }
        },
        select: ADMIN_USER_BASE_SELECT
      });
      await revokeAllSessions(id);

      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "admin.user.password_reset",
        targetType: "user",
        targetId: id,
        metadata: { generatedPassword: Boolean(generatedPassword) },
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      ctx.log.info("admin.user.password_reset", { targetUserId: id });

      return NextResponse.json({
        user: toAdminUserView(user),
        ...(generatedPassword ? { temporaryPassword: generatedPassword } : {}),
        reauthRequired: target.id === ctx.userId
      });
    }
  );
}
