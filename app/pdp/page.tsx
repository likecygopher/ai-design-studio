import { AppShell } from "@/src/components/AppShell";
import { PdpEditor } from "@/src/components/PdpEditor";
import { requireServerWorkspace } from "@/src/platform/server-workspace";

// Product list includes user-created products, so render per request.
export const dynamic = "force-dynamic";

export default async function PdpPage() {
  const products = await (await requireServerWorkspace()).productRegistry.listProducts();

  return (
    <AppShell>
      <h1 style={{ fontSize: 30, marginBottom: 16 }}>PDP 构建</h1>
      <PdpEditor products={products} />
    </AppShell>
  );
}
