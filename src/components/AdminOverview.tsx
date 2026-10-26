"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { apiFetch, formatApiError } from "@/src/lib/api-client";
import { useI18n } from "@/src/i18n/I18nProvider";
import styles from "./AdminPanels.module.css";

type Stats = {
  users: { total: number };
  jobs: {
    total: number;
    byStatus: Record<string, number>;
    queued: number;
    running: number;
    failedLast24h: number;
    failureRate: number;
  };
  storage: { assets: number; bytes: number };
};

type HealthAlert = { id: string; severity: "critical" | "warning"; message: string };

type Health = {
  status: string;
  database: { ok: boolean };
  queue: { queued: number; running: number; failed: number; failureRate24h?: number };
  workers: { total: number; alive: number };
  process: { uptimeSec: number };
  alerts?: HealthAlert[];
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function AdminOverview() {
  const { t } = useI18n();
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [statsData, healthData] = await Promise.all([
        apiFetch<Stats>("/api/admin/stats"),
        apiFetch<Health>("/api/admin/health")
      ]);
      setStats(statsData);
      setHealth(healthData);
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const workersAlive = health?.workers.alive ?? 0;
  const healthy = health?.status === "ok";
  const alerts = health?.alerts ?? [];

  return (
    <section className={styles.page} aria-label={t("admin.overview")}>
      <header className={styles.header}>
        <div>
          <h1>{t("admin.overview")}</h1>
          <p className={styles.headerMeta}>{t("admin.overviewHint")}</p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            data-admin-action="secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={13} aria-hidden />
            {t("common.refresh")}
          </button>
        </div>
      </header>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {loading && !stats ? <p className={styles.loading}>{t("common.loading")}</p> : null}

      {stats && health ? (
        <>
          {alerts.length > 0 ? (
            <div className={styles.alerts} aria-label={t("admin.alerts")}>
              {alerts.map((alert) => (
                <p
                  key={alert.id}
                  className={styles.alertItem}
                  data-severity={alert.severity}
                  role={alert.severity === "critical" ? "alert" : "status"}
                >
                  {alert.severity === "critical"
                    ? t("admin.severity.critical")
                    : t("admin.severity.warning")}{" "}
                  · {alert.message}
                </p>
              ))}
            </div>
          ) : null}

          <div className={styles.health} role="status">
            <Activity size={14} aria-hidden />
            <span>
              {t("admin.serviceStatus")}：{healthy ? t("admin.serviceOk") : t("admin.serviceAttention")}{" "}
              · {t("admin.database")}{" "}
              {health.database.ok ? t("admin.dbConnected") : t("admin.dbDown")} · Worker{" "}
              {t("admin.workersOnline", { alive: workersAlive, total: health.workers.total })} ·{" "}
              {t("admin.uptime", { uptime: formatUptime(health.process.uptimeSec) })}
            </span>
          </div>

          <div className={styles.stats}>
            <article className={styles.stat}>
              <span className={styles.statLabel}>{t("admin.users")}</span>
              <strong className={styles.statValue}>{stats.users.total}</strong>
              <span className={styles.statMeta}>{t("admin.usersMeta")}</span>
            </article>
            <article className={styles.stat}>
              <span className={styles.statLabel}>{t("admin.jobs")}</span>
              <strong className={styles.statValue}>{stats.jobs.total}</strong>
              <span className={styles.statMeta}>
                {t("admin.jobsMeta", {
                  failed: stats.jobs.failedLast24h,
                  rate: (stats.jobs.failureRate * 100).toFixed(1)
                })}
              </span>
            </article>
            <article className={styles.stat}>
              <span className={styles.statLabel}>{t("admin.queue")}</span>
              <strong className={styles.statValue}>
                {stats.jobs.queued}/{stats.jobs.running}
              </strong>
              <span className={styles.statMeta}>{t("admin.queueMeta")}</span>
            </article>
            <article className={styles.stat}>
              <span className={styles.statLabel}>{t("admin.storage")}</span>
              <strong className={styles.statValue}>{formatBytes(stats.storage.bytes)}</strong>
              <span className={styles.statMeta}>
                {t("admin.storageMeta", { count: stats.storage.assets })}
              </span>
            </article>
          </div>

          <div className={styles.links}>
            <Link className={styles.linkCard} href="/admin/users">
              <strong>{t("admin.link.users")}</strong>
              <span>{t("admin.link.usersDesc")}</span>
            </Link>
            <Link className={styles.linkCard} href="/admin/ai">
              <strong>{t("admin.link.ai")}</strong>
              <span>{t("admin.link.aiDesc")}</span>
            </Link>
            <Link className={styles.linkCard} href="/admin/audit">
              <strong>{t("admin.link.audit")}</strong>
              <span>{t("admin.link.auditDesc")}</span>
            </Link>
            <Link className={styles.linkCard} href="/jobs">
              <strong>{t("admin.link.jobs")}</strong>
              <span>{t("admin.link.jobsDesc")}</span>
            </Link>
            <Link className={styles.linkCard} href="/costs">
              <strong>{t("admin.link.costs")}</strong>
              <span>{t("admin.link.costsDesc")}</span>
            </Link>
          </div>
        </>
      ) : null}
    </section>
  );
}
