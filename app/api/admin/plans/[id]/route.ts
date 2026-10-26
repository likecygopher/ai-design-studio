import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { deletePlan, updatePlan } from "@/src/platform/plans";

export const dynamic = "force-dynamic";

const planSchema = z.object({
  name: z.string().trim().min(1, "请输入套餐名称。").max(80),
  description: z.string().trim().max(300).nullable().optional(),
  monthlyBudgetUnits: z.number().int().min(0).max(1_000_000).nullable().optional(),
  maxActiveJobs: z.number().int().min(1).max(100).nullable().optional()
});

export function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:plans:update", limit: 30, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      const body = await ctx.body(planSchema);
      const plan = await updatePlan(id, body);
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "admin.plan_update",
        targetType: "plan",
        targetId: id,
        metadata: { name: plan.name },
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ plan });
    }
  );
}

export function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:plans:delete", limit: 20, windowMs: 60_000 } },
    async (ctx) => {
      const { id } = await context.params;
      await deletePlan(id);
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "admin.plan_delete",
        targetType: "plan",
        targetId: id,
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ deleted: true });
    }
  );
}
