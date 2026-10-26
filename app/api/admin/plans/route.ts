import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { createPlan, listPlans } from "@/src/platform/plans";

export const dynamic = "force-dynamic";

const planSchema = z.object({
  name: z.string().trim().min(1, "请输入套餐名称。").max(80),
  description: z.string().trim().max(300).nullable().optional(),
  monthlyBudgetUnits: z.number().int().min(0).max(1_000_000).nullable().optional(),
  maxActiveJobs: z.number().int().min(1).max(100).nullable().optional()
});

export function GET(request: Request) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:plans:read", limit: 120, windowMs: 60_000 } },
    async () => {
      const plans = await listPlans();
      return NextResponse.json({ plans }, { headers: { "Cache-Control": "no-store" } });
    }
  );
}

export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "admin", rateLimit: { name: "admin:plans:create", limit: 30, windowMs: 60_000 } },
    async (ctx) => {
      const body = await ctx.body(planSchema);
      const plan = await createPlan(body);
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "admin.plan_create",
        targetType: "plan",
        targetId: plan.id,
        metadata: { name: plan.name },
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ plan }, { status: 201 });
    }
  );
}
