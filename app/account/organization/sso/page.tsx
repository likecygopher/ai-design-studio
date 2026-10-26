import { AppShell } from "@/src/components/AppShell";
import { OrganizationSsoSettings } from "@/src/components/OrganizationSsoSettings";
import { requireServerWorkspace } from "@/src/platform/server-workspace";

export const dynamic = "force-dynamic";

export const metadata = { title: "企业 SSO 配置 · Midea AI Content Studio" };

export default async function OrganizationSsoPage() {
  await requireServerWorkspace();
  return (
    <AppShell>
      <OrganizationSsoSettings />
    </AppShell>
  );
}
