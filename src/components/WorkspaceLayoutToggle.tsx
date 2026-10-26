"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useI18n } from "@/src/i18n/I18nProvider";
import { useWorkspaceLayout } from "./useWorkspaceLayout";
import styles from "./WorkspaceLayoutToggle.module.css";

export function WorkspaceLayoutToggle() {
  const { t } = useI18n();
  const { compact, toggle } = useWorkspaceLayout();
  return (
    <button
      type="button"
      className={styles.toggle}
      data-layout={compact ? "compact" : "comfortable"}
      aria-pressed={compact}
      title={compact ? t("layout.switchToComfortable") : t("layout.switchToCompact")}
      aria-label={compact ? t("layout.switchToComfortable") : t("layout.switchToCompact")}
      onClick={toggle}
    >
      {compact ? <Maximize2 size={15} aria-hidden /> : <Minimize2 size={15} aria-hidden />}
      <span>{compact ? t("layout.compact") : t("layout.comfortable")}</span>
    </button>
  );
}
