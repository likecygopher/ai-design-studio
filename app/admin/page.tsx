import { AppShell } from "@/src/components/AppShell";
import { AdminOverview } from "@/src/components/AdminOverview";
import { requireAdminWorkspace } from "@/src/platform/server-workspace";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "系统概览 · Midea AI Content Studio"
};

export default async function AdminPage() {
  await requireAdminWorkspace();
  return (
    <AppShell>
      <AdminOverview />
    </AppShell>
  );
}
