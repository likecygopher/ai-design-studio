import type { ReactNode } from "react";
import styles from "./login.module.css";

/**
 * Shared visual shell for /login and /register.
 * Keeps only the product signal (brand + one-line statement) and the form.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className={styles.page}>
      <div aria-hidden="true" className={styles.background} />
      <section className={styles.shell}>
        <aside className={styles.visual} aria-hidden="true">
          {/* Existing brand scene render; no copy on the visual side. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/midea-ai/midea-finale-city.png" alt="" />
        </aside>
        <div className={styles.card}>
          <div className={styles.cardBrand}>
            <span>Midea Overseas</span>
            <strong>AI Content Studio</strong>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
