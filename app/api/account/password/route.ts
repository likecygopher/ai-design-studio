import { compare, hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { PLATFORM_CONFIG } from "@/src/platform/config";
import { prisma } from "@/src/platform/db";
import { ApiError, NotFoundError, ValidationError } from "@/src/platform/errors";
import { revokeAllSessions } from "@/src/platform/sessions";
import { selfPasswordSchema } from "@/src/platform/user-admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/password — self-service password change (R12).
 *
 * Requires the current password, bumps `authVersion` so the old session cannot
 * be reused, and tells the UI to force a fresh login.
 */
export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:password", limit: 5, windowMs: 15 * 60 * 1000 } },
    async (ctx) => {
      const body = await ctx.body(selfPasswordSchema);
      const userId = ctx.userId as string;

      const row = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, passwordHash: true }
      });
      if (!row) {
        throw new NotFoundError("用户不存在。");
      }

      const valid = await compare(body.currentPassword, row.passwordHash);
      if (!valid) {
        throw new ApiError(400, "VALIDATION_ERROR", "当前密码不正确。");
      }

      const same = await compare(body.newPassword, row.passwordHash);
      if (same) {
        throw new ValidationError("新密码不能与当前密码相同。");
      }

      const passwordHash = await hash(body.newPassword, PLATFORM_CONFIG.bcryptCost);
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash, authVersion: { increment: 1 } }
      });
      await revokeAllSessions(userId);

      await recordAudit({
        userId,
        actorRole: ctx.role,
        action: "account.password_change",
        targetType: "user",
        targetId: userId,
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      ctx.log.info("account.password_change", { userId });

      return NextResponse.json({ reauthRequired: true });
    }
  );
}
