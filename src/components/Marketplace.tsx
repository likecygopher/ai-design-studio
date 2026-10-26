"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Plus, RefreshCw, Store } from "lucide-react";
import { apiFetch, formatApiError } from "@/src/lib/api-client";
import { useI18n } from "@/src/i18n/I18nProvider";
import { StudioDialog } from "./StudioDialog";
import styles from "./Marketplace.module.css";

type MarketplaceItem = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  prompt: string;
  coverUrl: string | null;
  clones: number;
  authorName: string;
  createdAt: string;
};

type UserTemplate = {
  id: string;
  title: string;
  prompt: string;
  category: string;
  itemId: string | null;
  createdAt: string;
};

const CATEGORIES = ["style", "pop", "pdp", "prompt"] as const;

export function Marketplace() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"market" | "mine">("market");
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [mine, setMine] = useState<UserTemplate[]>([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [publishOpen, setPublishOpen] = useState(false);
  const [busyId, setBusyId] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      if (tab === "mine") {
        const data = await apiFetch<{ templates?: UserTemplate[] }>(
          "/api/account/templates"
        );
        setMine(data.templates ?? []);
      } else {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (category) params.set("category", category);
        const data = await apiFetch<{ items?: MarketplaceItem[] }>(
          `/api/marketplace?${params.toString()}`
        );
        setItems(data.items ?? []);
      }
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setLoading(false);
    }
  }, [tab, q, category, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function clone(item: MarketplaceItem) {
    setBusyId(item.id);
    setError(undefined);
    try {
      await apiFetch(`/api/marketplace/${encodeURIComponent(item.id)}/clone`, {
        method: "POST"
      });
      setNotice(t("marketplace.cloned"));
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, clones: entry.clones + 1 } : entry
        )
      );
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusyId(undefined);
    }
  }

  async function publish(values: {
    title: string;
    description: string;
    category: string;
    prompt: string;
  }) {
    try {
      await apiFetch("/api/marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          description: values.description || null,
          category: values.category,
          prompt: values.prompt
        })
      });
      setPublishOpen(false);
      setNotice(t("marketplace.published"));
      await load();
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t("marketplace.title")}</h1>
          <p>{t("marketplace.subtitle")}</p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={13} aria-hidden /> {t("common.refresh")}
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => setPublishOpen(true)}
          >
            <Plus size={13} aria-hidden /> {t("marketplace.publish")}
          </button>
        </div>
      </header>

      <div className={styles.tabs}>
        <button
          type="button"
          className={tab === "market" ? styles.tabActive : styles.tab}
          onClick={() => setTab("market")}
        >
          {t("marketplace.market")}
        </button>
        <button
          type="button"
          className={tab === "mine" ? styles.tabActive : styles.tab}
          onClick={() => setTab("mine")}
        >
          {t("marketplace.myTemplates")}
        </button>
      </div>

      {tab === "market" ? (
        <div className={styles.toolbar}>
          <label>
            {t("marketplace.search")}
            <input value={q} onChange={(event) => setQ(event.target.value)} />
          </label>
          <label>
            {t("marketplace.allCategories")}
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">{t("marketplace.allCategories")}</option>
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(`marketplace.category.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={styles.secondary} onClick={() => void load()}>
            <Store size={13} aria-hidden /> {t("marketplace.search")}
          </button>
        </div>
      ) : null}

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {loading ? (
        <p className={styles.empty}>{t("marketplace.loading")}</p>
      ) : tab === "mine" ? (
        mine.length === 0 ? (
          <p className={styles.empty}>{t("marketplace.noMine")}</p>
        ) : (
          <div className={styles.grid}>
            {mine.map((template) => (
              <article key={template.id} className={styles.card}>
                <h2>{template.title}</h2>
                <div className={styles.meta}>
                  <span>{t(`marketplace.category.${template.category}`)}</span>
                </div>
                <pre className={styles.prompt}>{template.prompt}</pre>
              </article>
            ))}
          </div>
        )
      ) : items.length === 0 ? (
        <p className={styles.empty}>{t("marketplace.empty")}</p>
      ) : (
        <div className={styles.grid}>
          {items.map((item) => (
            <article key={item.id} className={styles.card}>
              <h2>{item.title}</h2>
              {item.description ? <p>{item.description}</p> : null}
              <div className={styles.meta}>
                <span>{t(`marketplace.category.${item.category}`)}</span>
                <span>{t("marketplace.clones", { count: item.clones })}</span>
                <span>{t("marketplace.byAuthor", { name: item.authorName })}</span>
              </div>
              <pre className={styles.prompt}>{item.prompt}</pre>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busyId === item.id}
                  onClick={() => void clone(item)}
                >
                  <Copy size={13} aria-hidden />
                  {busyId === item.id ? t("marketplace.cloning") : t("marketplace.clone")}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {publishOpen ? (
        <StudioDialog title={t("marketplace.publish")} onClose={() => setPublishOpen(false)}>
          <PublishForm onSubmit={publish} />
        </StudioDialog>
      ) : null}
    </main>
  );
}

function PublishForm({
  onSubmit
}: {
  onSubmit: (values: {
    title: string;
    description: string;
    category: string;
    prompt: string;
  }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("style");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    if (!title.trim() || !prompt.trim()) {
      setError(t("common.error"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit({ title, description, category, prompt });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.form}>
      <label>
        {t("marketplace.titleField")}
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        {t("marketplace.descriptionField")}
        <input value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <label>
        {t("marketplace.categoryField")}
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {t(`marketplace.category.${value}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("marketplace.promptField")}
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      </label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.dialogActions}>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void submit()}>
          {busy ? t("marketplace.publishing") : t("marketplace.publish")}
        </button>
      </div>
    </div>
  );
}
