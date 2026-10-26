import { AppShell } from "@/src/components/AppShell";
import { AssetLibrary } from "@/src/components/AssetLibrary";

export default function AssetsPage() {
  return (
    <AppShell>
      <h1 style={{ fontSize: 30, marginBottom: 18 }}>素材库</h1>
      <AssetLibrary />
    </AppShell>
  );
}
