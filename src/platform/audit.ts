/**
 * Audit trail for security-relevant actions.
 *
 * Writes are fire-and-forget: an audit failure must never break the request that
 * triggered it. Failures are logged so they can be alerted on.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/platform/db";
import { logger } from "@/src/platform/logger";

export type AuditAction =
  | "auth.register"
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "job.enqueue"
  | "job.retry"
  | "job.blocked_budget"
  | "job.cancel"
  | "job.complete"
  | "job.fail"
  | "asset.upload"
  | "asset.delete"
  | "product.create"
  | "product.delete"
  | "settings.update"
  | "admin.user.list"
  | "admin.user.create"
  | "admin.user.update"
  | "admin.user.password_reset"
  | "account.password_change"
  | "account.2fa_setup"
  | "account.2fa_enable"
  | "account.2fa_disable"
  | "account.2fa_recovery_regenerate"
  | "account.recovery_code_used"
  | "account.session_revoke"
  | "account.api_token_create"
  | "account.api_token_revoke"
  | "account.webhook_create"
  | "account.webhook_delete"
  | "account.data_export"
  | "account.data_delete"
  | "admin.audit_export"
  | "admin.plan_create"
  | "admin.plan_update"
  | "admin.plan_delete"
  | "marketplace.publish"
  | "marketplace.clone"
  | "admin.marketplace_review"
  | "organization.rename"
  | "organization.switch"
  | "organization.member_add"
  | "organization.member_update"
  | "organization.member_remove"
  | "organization.archive"
  | "organization.delete"
  | "organization.sso_update"
  | "organization.scim_token_rotate"
  | "organization.scim_sync"
  | "auth.sso_provision"
  | "admin.job.list"
  | "admin.job.cancel"
  | "admin.job.approve"
  | "admin.job.reject"
  | "admin.stats.read"
  | "admin.health.read"
  | "admin.ai_config.create"
  | "admin.ai_config.update"
  | "admin.ai_config.delete"
  | "admin.ai_config.activate"
  | "admin.ai_config.failover"
  | "admin.ai_config.test"
  | "admin.ai_config.reset"
  | "admin.audit.list"
  | "rate_limit.exceeded";

export type AuditInput = {
  userId?: string | null;
  actorRole?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string;
  requestId?: string;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: input.metadata ?? undefined,
        ip: input.ip ?? null,
        requestId: input.requestId ?? null
      }
    });
  } catch (error) {
    logger.error("audit.write_failed", error, { action: input.action });
  }
}
