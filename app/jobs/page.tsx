import { AppShell } from "@/src/components/AppShell";
import { JobsCenter } from "@/src/components/JobsCenter";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "任务中心 · Midea AI Content Studio"
};

export default function JobsPage() {
  return (
    <AppShell>
      <JobsCenter />
    </AppShell>
  );
}
