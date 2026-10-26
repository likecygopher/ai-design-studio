"use client";

import type { CSSProperties, ReactNode } from "react";
import { signOut, useSession } from "next-auth/react";
import styles from "./AppShell.module.css";
import { getGlassTunerStyle, useGlassTunerSettings } from "./GlassTuner";
import { useStudioBackground } from "./useStudioBackground";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { StudioNavigation } from "./StudioNavigation";
import { useI18n } from "@/src/i18n/I18nProvider";
import { StudioSettings } from "./StudioSettings";
import { WorkspaceLayoutToggle } from "./WorkspaceLayoutToggle";
import { useWorkspaceLayout } from "./useWorkspaceLayout";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { data: session } = useSession();
  const { backgroundUrl } = useStudioBackground();
  const glass = useGlassTunerSettings();
  const { compact } = useWorkspaceLayout();
  // Legacy JWT sessions may not carry a role yet; treat them as regular users.
  const role = session?.user?.role ?? "user";
  const roleLabel = role === "admin" ? t("shell.roleAdmin") : t("shell.roleUser");
  const stageStyle = {
    ...getGlassTunerStyle(glass.settings),
    "--studio-background": 'url("' + backgroundUrl + '")'
  } as CSSProperties;
  return (
    <main
      className={styles.stage}
      data-layout={compact ? "compact" : "comfortable"}
      style={stageStyle}
    >
      <div aria-hidden="true" className={styles.background} />
      <section
        aria-label={t("shell.workspaceAria")}
        className={styles.workbench}
        data-layout={compact ? "compact" : "comfortable"}
      >
        <aside className={styles.sidebar}>
          <div className={styles.brand}><span>Midea Overseas</span><strong>AI Content Studio</strong></div>
          <StudioNavigation className={styles.navigation} isAdmin={role === "admin"} />
          <div className={styles.sidebarFooter}>
            <span className={styles.onlineDot} />
            <span className={styles.userEmail}>{session?.user?.email ?? t("shell.asyncMode")}</span>
            {session?.user ? (
              <span
                className={styles.roleBadge}
                data-role={role}
                title={t("shell.roleTitle", { role: roleLabel, code: role })}
              >
                {roleLabel}
              </span>
            ) : null}
            {session?.user ? (
              <button
                type="button"
                className={styles.logoutButton}
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                {t("shell.logout")}
              </button>
            ) : null}
          </div>
        </aside>
        <div className={styles.settingsDock}>
          <WorkspaceLayoutToggle />
          <StudioSettings glass={glass} />
        </div>
        <section className={styles.main}>{children}</section>
      </section>
    </main>
  );
}
