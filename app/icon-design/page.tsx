import { AppShell } from "@/src/components/AppShell";
import { IconDesignStudio } from "@/src/components/IconDesignStudio";

export default function Page() {
  return (
    <AppShell>
      <h1 style={{ fontSize: 30, marginBottom: 18 }}>Icon Design VI 套用</h1>
      <IconDesignStudio />
    </AppShell>
  );
}