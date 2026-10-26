import { AppShell } from "@/src/components/AppShell";
import { ProductProfilePanel } from "@/src/components/ProductProfilePanel";

export default function ProductsPage() {
  return (
    <AppShell>
      <h1 style={{ fontSize: 30, marginBottom: 18 }}>产品档案</h1>
      <ProductProfilePanel />
    </AppShell>
  );
}
