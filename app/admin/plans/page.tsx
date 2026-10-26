import { AppShell } from "@/src/components/AppShell";
import { AdminPlans } from "@/src/components/AdminPlans";
import { requireAdminWorkspace } from "@/src/platform/server-workspace";

export const dynamic = "force-dynamic";

export const metadata = { title: "套餐管理 · Midea AI Content Studio" };

export default async function AdminPlansPage() {
  await requireAdminWorkspace();
  return (
    <AppShell>
      <AdminPlans />
    </AppShell>
  );
}
