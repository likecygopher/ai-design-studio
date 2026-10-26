import { NextResponse } from "next/server";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { prisma } from "@/src/platform/db";
import { ApiError, ConflictError, NotFoundError } from "@/src/platform/errors";
import {
  ADMIN_USER_BASE_SELECT,
  toAdminUserView,
  updateAdminUserSchema
} from "@/src/platform/user-admin";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/users/{id} — edit nickname, role, or enabled state (R11.3).
 *
 * Guardrails:
 * - an admin cannot disable/demote their own account (self-lockout);
 * - the last enabled admin cannot be demoted or disabled (platform lockout).
 */
export function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:users:update", limit: 60, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      const body = await ctx.body(updateAdminUserSchema);

      const target = await prisma.user.findUnique({
        where: { id },
        select: ADMIN_USER_BASE_SELECT
      });
      if (!target) {
        throw new NotFoundError("用户不存在。");
      }

      const updates: {
        name?: string | null;
        role?: string;
        disabled?: boolean;
        monthlyBudgetUnits?: number | null;
        requiresJobApproval?: boolean;
        planId?: string | null;
      } = {};

      if (body.name !== undefined) {
        updates.name = body.name === null ? null : body.name.trim();
      }
      if (body.role !== undefined && body.role !== target.role) {
        updates.role = body.role;
      }
      if (body.disabled !== undefined && body.disabled !== target.disabled) {
        updates.disabled = body.disabled;
      }
      if (body.monthlyBudgetUnits !== undefined) {
        updates.monthlyBudgetUnits = body.monthlyBudgetUnits;
      }
      if (body.requiresJobApproval !== undefined) {
        updates.requiresJobApproval = body.requiresJobApproval;
      }
      if (body.planId !== undefined) {
        updates.planId = body.planId;
      }

      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ user: toAdminUserView(target) });
      }

      const isSelf = target.id === ctx.userId;
      if (isSelf) {
        if (updates.disabled === true) {
          throw new ApiError(400, "CANNOT_MODIFY_SELF", "不能禁用当前登录的管理员账号。");
        }
        if (updates.role === "user") {
          throw new ApiError(400, "CANNOT_MODIFY_SELF", "不能降级当前登录的管理员账号。");
        }
      }

      const removesActiveAdmin =
        target.role === "admin" &&
        !target.disabled &&
        (updates.role === "user" || updates.disabled === true);

      if (removesActiveAdmin) {
        const activeAdmins = await prisma.user.count({
          where: { role: "admin", disabled: false }
        });
        if (activeAdmins <= 1) {
          throw new ConflictError("至少需要保留一名可用的管理员。", "LAST_ADMIN");
        }
      }

      const user = await prisma.user.update({
        where: { id },
        data: updates,
        select: ADMIN_USER_BASE_SELECT
      });

      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "admin.user.update",
        targetType: "user",
        targetId: id,
        metadata: {
          changed: Object.keys(updates),
          role: updates.role,
          disabled: updates.disabled,
          monthlyBudgetUnits: updates.monthlyBudgetUnits,
          requiresJobApproval: updates.requiresJobApproval,
          planId: updates.planId
        },
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      ctx.log.info("admin.user.update", { targetUserId: id, changed: Object.keys(updates) });

      return NextResponse.json({ user: toAdminUserView(user) });
    }
  );
}
