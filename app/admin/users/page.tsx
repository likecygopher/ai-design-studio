import { AppShell } from "@/src/components/AppShell";
import { AdminUsers } from "@/src/components/AdminUsers";
import { getSessionUser } from "@/src/platform/auth";
import { requireAdminWorkspace } from "@/src/platform/server-workspace";
import styles from "@/src/components/AdminUsers.module.css";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "用户管理 · Midea AI Content Studio"
};

export default async function AdminUsersPage() {
  await requireAdminWorkspace();
  const currentUser = await getSessionUser();
  if (!currentUser) {
    redirect("/api/auth/expire");
  }

  return (
    <AppShell>
      <div className={styles.page}>
        <AdminUsers currentUserId={currentUser.id} />
      </div>
    </AppShell>
  );
}
