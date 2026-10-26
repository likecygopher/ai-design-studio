import { AppShell } from "@/src/components/AppShell";
import { SkuReplacementStudio } from "@/src/components/SkuReplacementStudio";

export default function Page() {
  return (
    <AppShell>
      <h1 style={{ fontSize: 30, marginBottom: 18 }}>SKU 局部替换</h1>
      <SkuReplacementStudio />
    </AppShell>
  );
}