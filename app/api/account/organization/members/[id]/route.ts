import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import {
  ORG_ROLES,
  removeOrganizationMember,
  updateOrganizationMemberRole
} from "@/src/platform/organizations";

export const dynamic = "force-dynamic";

const schema = z.object({ role: z.enum(ORG_ROLES) });

export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "organization:member-update", limit: 60 } },
    async (ctx) => {
      const { id } = await context.params;
      const body = await ctx.body(schema);
      await updateOrganizationMemberRole(ctx.userId as string, id, body.role);
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "organization.member_update",
        targetType: "organization_member",
        targetId: id,
        metadata: { role: body.role },
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ ok: true });
    }
  );
}

export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "organization:member-remove", limit: 30 } },
    async (ctx) => {
      const { id } = await context.params;
      await removeOrganizationMember(ctx.userId as string, id);
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "organization.member_remove",
        targetType: "organization_member",
        targetId: id,
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ ok: true });
    }
  );
}
