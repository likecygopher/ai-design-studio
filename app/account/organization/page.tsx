import { AppShell } from "@/src/components/AppShell";
import { OrganizationSettings } from "@/src/components/OrganizationSettings";
import { requireServerWorkspace } from "@/src/platform/server-workspace";

export const dynamic = "force-dynamic";

export const metadata = { title: "组织与团队 · Midea AI Content Studio" };

export default async function OrganizationPage() {
  await requireServerWorkspace();
  return (
    <AppShell>
      <OrganizationSettings />
    </AppShell>
  );
}
