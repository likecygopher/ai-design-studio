import { redirect } from "next/navigation";
import { auth } from "@/src/platform/auth";
import { getSessionUser } from "@/src/platform/auth";
import { createUserWorkspace, type UserWorkspace } from "@/src/platform/workspace";

/**
 * Page-level guard. Distinguishes "not signed in" (plain /login redirect) from
 * "signed in but the session is no longer valid" (disabled account, password
 * reset elsewhere) — the latter goes through /api/auth/expire so the stale
 * cookie is cleared, otherwise middleware would bounce /login back to the studio.
 */
export async function requireServerWorkspace(): Promise<UserWorkspace> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await getSessionUser();
  if (!user) {
    redirect("/api/auth/expire");
  }

  return createUserWorkspace(user.id);
}

/** Page-level admin guard: non-admins are sent back to the studio home. */
export async function requireAdminWorkspace(): Promise<UserWorkspace> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await getSessionUser();
  if (!user) {
    redirect("/api/auth/expire");
  }
  if (user.role !== "admin") {
    redirect("/studio-home");
  }

  return createUserWorkspace(user.id);
}
