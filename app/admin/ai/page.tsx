import { AppShell } from "@/src/components/AppShell";
import { AdminAiConfig } from "@/src/components/AdminAiConfig";
import { requireAdminWorkspace } from "@/src/platform/server-workspace";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI 引擎配置 · Midea AI Content Studio"
};

export default async function AdminAiPage() {
  await requireAdminWorkspace();
  return (
    <AppShell>
      <AdminAiConfig />
    </AppShell>
  );
}
