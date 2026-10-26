import { AppShell } from "@/src/components/AppShell";
import { AdminAudit } from "@/src/components/AdminAudit";
import { requireAdminWorkspace } from "@/src/platform/server-workspace";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "审计日志 · Midea AI Content Studio"
};

export default async function AdminAuditPage() {
  await requireAdminWorkspace();
  return (
    <AppShell>
      <AdminAudit />
    </AppShell>
  );
}
