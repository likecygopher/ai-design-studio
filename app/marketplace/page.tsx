import { AppShell } from "@/src/components/AppShell";
import { Marketplace } from "@/src/components/Marketplace";
import { requireServerWorkspace } from "@/src/platform/server-workspace";

export const dynamic = "force-dynamic";

export const metadata = { title: "模板市场 · Midea AI Content Studio" };

export default async function MarketplacePage() {
  await requireServerWorkspace();
  return (
    <AppShell>
      <Marketplace />
    </AppShell>
  );
}
