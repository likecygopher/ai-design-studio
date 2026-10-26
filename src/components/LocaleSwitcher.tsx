"use client";

import { useRouter } from "next/navigation";
import { Locale, LOCALE_COOKIE, LOCALES } from "@/src/i18n/core";
import { useI18n } from "@/src/i18n/I18nProvider";
import styles from "./LocaleSwitcher.module.css";

/** Cookie-backed language switch; `router.refresh()` re-renders server content. */
export function LocaleSwitcher({ className }: { className?: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();

  function switchTo(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div
      className={[styles.switcher, className].filter(Boolean).join(" ")}
      role="group"
      aria-label={t("shell.switchLanguage")}
    >
      {LOCALES.map((item) => (
        <button
          key={item.id}
          type="button"
          className={styles.button}
          data-active={item.id === locale}
          aria-pressed={item.id === locale}
          onClick={() => switchTo(item.id)}
        >
          {item.id === "zh" ? "中文" : "EN"}
        </button>
      ))}
    </div>
  );
}
