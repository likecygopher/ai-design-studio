import { AppShell } from "@/src/components/AppShell";
import { PhoneStandardizeRunner } from "@/src/components/PhoneStandardizeRunner";

export default function Page() {
  return (
    <AppShell>
      <h1 style={{ fontSize: 30, marginBottom: 18 }}>手机图标准化</h1>
      <PhoneStandardizeRunner />
    </AppShell>
  );
}