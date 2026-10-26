import { AppShell } from "@/src/components/AppShell";
import { AccountSecurity } from "@/src/components/AccountSecurity";
import { getSessionUser } from "@/src/platform/auth";
import { requireServerWorkspace } from "@/src/platform/server-workspace";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "账户设置 · Midea AI Content Studio"
};

export default async function AccountPage() {
  await requireServerWorkspace();
  const user = await getSessionUser();
  if (!user) {
    redirect("/api/auth/expire");
  }

  return (
    <AppShell>
      <AccountSecurity user={{ id: user.id, email: user.email ?? "", role: user.role }} />
    </AppShell>
  );
}
