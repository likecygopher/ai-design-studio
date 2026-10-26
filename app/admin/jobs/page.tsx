import { AppShell } from "@/src/components/AppShell";
import { AdminJobs } from "@/src/components/AdminJobs";
import { requireAdminWorkspace } from "@/src/platform/server-workspace";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "任务管理 · Midea AI Content Studio"
};

export default async function AdminJobsPage() {
  await requireAdminWorkspace();
  return (
    <AppShell>
      <AdminJobs />
    </AppShell>
  );
}
