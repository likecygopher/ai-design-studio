import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { addOrganizationMember } from "@/src/platform/organizations";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["admin", "member"]).default("member")
});

export function POST(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "organization:member-add", limit: 30 } },
    async (ctx) => {
      const body = await ctx.body(schema);
      const member = await addOrganizationMember(
        ctx.userId as string,
        body.email,
        body.role
      );
      await recordAudit({
        userId: ctx.userId,
        actorRole: ctx.role,
        action: "organization.member_add",
        targetType: "organization_member",
        targetId: member.id,
        metadata: { email: member.email, role: member.role },
        ip: ctx.ip,
        requestId: ctx.requestId
      });
      return NextResponse.json({ member }, { status: 201 });
    }
  );
}
