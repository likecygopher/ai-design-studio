import { resolve, sep } from "node:path";
import { unlink } from "node:fs/promises";
import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApi } from "@/src/platform/api";
import { recordAudit } from "@/src/platform/audit";
import { PLATFORM_CONFIG } from "@/src/platform/config";
import { prisma } from "@/src/platform/db";
import { ApiError, ConflictError, NotFoundError } from "@/src/platform/errors";
import { normalizeStorageKey } from "@/src/platform/storage/cleanup";

export const dynamic = "force-dynamic";

const deleteSchema = z.object({
  password: z.string({ error: "请输入当前密码。" }).min(1, "请输入当前密码。").max(200)
});

async function removeAssetFiles(storageKeys: string[]): Promise<void> {
  const root = resolve(PLATFORM_CONFIG.storageRoot);
  await Promise.all(
    storageKeys.map(async (key) => {
      try {
        const relative = normalizeStorageKey(key);
        const absolute = resolve(root, relative);
        if (!absolute.startsWith(root + sep)) {
          return;
        }
        await unlink(absolute);
      } catch {
        // Orphans are also handled by `pnpm cleanup`; deletion must not fail here.
      }
    })
  );
}

/**
 * Permanently delete the caller's account and owned data.
 * Requires the current password; the last active admin cannot be deleted.
 */
export function DELETE(request: Request) {
  return handleApi(
    request,
    { auth: "user", rateLimit: { name: "account:delete", limit: 3, windowMs: 15 * 60_000 } },
    async (ctx) => {
      const body = await ctx.body(deleteSchema);
      const userId = ctx.userId as string;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, disabled: true, passwordHash: true }
      });
      if (!user) {
        throw new NotFoundError("用户不存在。");
      }

      if (user.role === "admin") {
        const activeAdmins = await prisma.user.count({
          where: { role: "admin", disabled: false }
        });
        if (activeAdmins <= 1) {
          throw new ConflictError("至少需要保留一名可用的管理员，无法注销当前账号。", "LAST_ADMIN");
        }
      }

      const valid = await compare(body.password, user.passwordHash);
      if (!valid) {
        throw new ApiError(400, "VALIDATION_ERROR", "当前密码不正确。");
      }

      const assets = await prisma.asset.findMany({
        where: { userId },
        select: { storageKey: true }
      });

      // Cascades remove products/assets/jobs/costs/sessions/tokens/webhooks.
      await prisma.user.delete({ where: { id: userId } });
      await removeAssetFiles(assets.map((asset) => asset.storageKey));

      await recordAudit({
        userId: null,
        actorRole: ctx.role,
        action: "account.data_delete",
        targetType: "user",
        targetId: userId,
        metadata: { email: user.email, assets: assets.length },
        ip: ctx.ip,
        requestId: ctx.requestId
      });

      ctx.log.info("account.data_delete", { userId, assets: assets.length });
      return NextResponse.json({ deleted: true, reauthRequired: true });
    }
  );
}
