import { hash } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { PLATFORM_CONFIG } from "@/src/platform/config";
import { prisma } from "@/src/platform/db";
import { ensurePersonalOrganization } from "@/src/platform/organizations";
import { ConflictError } from "@/src/platform/errors";

const registerSchema = z.object({
  email: z
    .string({ error: "请输入邮箱。" })
    .trim()
    .toLowerCase()
    .email("请输入有效邮箱。")
    .max(254),
  password: z
    .string({ error: "请输入密码。" })
    .min(8, "密码至少 8 位。")
    .max(72, "密码最多 72 位。")
    .regex(/[A-Za-z]/, "密码必须包含字母。")
    .regex(/\d/, "密码必须包含数字。"),
  name: z.string().trim().min(1).max(80).optional()
});

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleApi(
    request,
    {
      auth: "public",
      rateLimit: { name: "auth:register", key: "ip", limit: 10, windowMs: 60 * 60 * 1000 }
    },
    async (ctx) => {
      const body = await ctx.body(registerSchema);
      const email = body.email;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        throw new ConflictError("该邮箱已注册，请直接登录。", "EMAIL_TAKEN");
      }

      const passwordHash = await hash(body.password, PLATFORM_CONFIG.bcryptCost);

      let user;
      try {
        user = await prisma.user.create({
          data: {
            email,
            name: body.name?.trim() || email.split("@")[0],
            passwordHash,
            settings: {
              create: {
                country: "Mexico",
                language: "Spanish"
              }
            }
          },
          select: { id: true, email: true, name: true }
        });
        void ensurePersonalOrganization(user.id).catch(() => undefined);
      } catch (error) {
        // Concurrent registration: the unique constraint is the source of truth.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ConflictError("该邮箱已注册，请直接登录。", "EMAIL_TAKEN");
        }
        throw error;
      }

      await recordAudit({
        userId: user.id,
        actorRole: "user",
        action: "auth.register",
        targetType: "user",
        targetId: user.id,
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      ctx.log.info("auth.register", { userId: user.id });

      return NextResponse.json({ user }, { status: 201 });
    }
  );
}
