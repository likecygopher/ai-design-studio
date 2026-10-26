import { AppShell } from "@/src/components/AppShell";
import { AdminMarketplace } from "@/src/components/AdminMarketplace";
import { requireAdminWorkspace } from "@/src/platform/server-workspace";

export const dynamic = "force-dynamic";

export const metadata = { title: "市场审核 · Midea AI Content Studio" };

export default async function AdminMarketplacePage() {
  await requireAdminWorkspace();
  return (
    <AppShell>
      <AdminMarketplace />
    </AppShell>
  );
}
