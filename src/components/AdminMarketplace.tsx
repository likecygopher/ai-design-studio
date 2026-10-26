"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { apiFetch, formatApiError } from "@/src/lib/api-client";
import { useI18n } from "@/src/i18n/I18nProvider";
import styles from "./AdminPanels.module.css";

type Item = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  prompt: string;
  status: string;
  clones: number;
  authorName: string;
  reviewNote: string | null;
  createdAt: string;
};

export function AdminMarketplace() {
  const { t } = useI18n();
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busyId, setBusyId] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const data = await apiFetch<{ items?: Item[] }>(
        `/api/admin/marketplace?status=${encodeURIComponent(status)}`
      );
      setItems(data.items ?? []);
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setLoading(false);
    }
  }, [status, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(item: Item, next: "approved" | "rejected") {
    const reviewNote =
      next === "rejected"
        ? window.prompt(t("admin.marketplaceRejectNote")) ?? undefined
        : undefined;
    setBusyId(item.id);
    setError(undefined);
    try {
      await apiFetch(`/api/admin/marketplace/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, reviewNote: reviewNote ?? null })
      });
      setNotice(t("admin.marketplaceReviewed"));
      await load();
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <section className={styles.page} aria-label={t("admin.marketplaceTitle")}>
      <header className={styles.header}>
        <div>
          <h1>{t("admin.marketplaceTitle")}</h1>
        </div>
        <div className={styles.actions}>
          <select
            aria-label={t("admin.marketplaceTitle")}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="pending">{t("admin.marketplacePending")}</option>
            <option value="approved">{t("admin.marketplaceApprove")}</option>
            <option value="rejected">{t("admin.marketplaceReject")}</option>
            <option value="all">{t("admin.marketplaceAll")}</option>
          </select>
          <button type="button" data-admin-action="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={13} aria-hidden /> {t("common.refresh")}
          </button>
        </div>
      </header>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {loading ? (
        <p className={styles.loading}>{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <div className={styles.empty}><p>{t("admin.marketplaceEmpty")}</p></div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label={t("admin.marketplaceTitle")}>
            <thead>
              <tr>
                <th scope="col">{t("marketplace.titleField")}</th>
                <th scope="col">{t("marketplace.categoryField")}</th>
                <th scope="col">{t("marketplace.byAuthor", { name: "" })}</th>
                <th scope="col">{t("marketplace.clones", { count: "" })}</th>
                <th scope="col">{t("admin.marketplacePending")}</th>
                <th scope="col">{t("admin.marketplaceApprove")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className={styles.providerName}>
                      <strong>{item.title}</strong>
                      <span className={styles.channelText}>{item.description || item.prompt.slice(0, 80)}</span>
                    </div>
                  </td>
                  <td>{t(`marketplace.category.${item.category}`)}</td>
                  <td>{item.authorName}</td>
                  <td>{item.clones}</td>
                  <td>{item.status}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={t("admin.marketplaceApprove")}
                        title={t("admin.marketplaceApprove")}
                        disabled={busyId === item.id || item.status === "approved"}
                        onClick={() => void review(item, "approved")}
                      >
                        <Check size={12} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={t("admin.marketplaceReject")}
                        title={t("admin.marketplaceReject")}
                        disabled={busyId === item.id || item.status === "rejected"}
                        onClick={() => void review(item, "rejected")}
                      >
                        <X size={12} aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
