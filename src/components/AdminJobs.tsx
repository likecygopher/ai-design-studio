"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, RotateCcw, Search, X, XCircle } from "lucide-react";
import { apiFetch, formatApiError } from "@/src/lib/api-client";
import { useI18n } from "@/src/i18n/I18nProvider";
import styles from "./AdminPanels.module.css";

type AdminJobRow = {
  id: string;
  userId: string;
  type: string;
  status: string;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  requiresApproval: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  approvalNote: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type JobsResponse = { jobs?: AdminJobRow[]; nextCursor?: string | null };

const STATUS_VALUES = ["", "queued", "running", "succeeded", "failed", "cancelled"] as const;

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 10) : id;
}

export function AdminJobs() {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<AdminJobRow[]>([]);
  const [status, setStatus] = useState("");
  const [approval, setApproval] = useState("");
  const [userId, setUserId] = useState("");
  const [appliedUserId, setAppliedUserId] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(
    async (cursor?: string) => {
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      setError(undefined);
      try {
        const query = new URLSearchParams({ limit: "30" });
        if (status) query.set("status", status);
        if (approval) query.set("approval", approval);
        if (appliedUserId.trim()) query.set("userId", appliedUserId.trim());
        if (cursor) query.set("cursor", cursor);
        const data = await apiFetch<JobsResponse>(`/api/admin/jobs?${query.toString()}`);
        const rows = data.jobs ?? [];
        setJobs((current) => (cursor ? [...current, ...rows] : rows));
        setNextCursor(data.nextCursor ?? null);
      } catch (cause) {
        setError(formatApiError(cause, t("common.error")));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [status, approval, appliedUserId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function act(job: AdminJobRow, action: "retry" | "cancel" | "approve" | "reject") {
    const key = `${action}:${job.id}`;
    if (busy[key]) return;
    setBusy((current) => ({ ...current, [key]: true }));
    setError(undefined);
    setNotice(undefined);
    try {
      await apiFetch(`/api/admin/jobs/${encodeURIComponent(job.id)}/${action}`, { method: "POST" });
      const id = shortId(job.id);
      setNotice(
        action === "retry"
          ? t("admin.retriedJob", { id })
          : action === "cancel"
            ? t("admin.cancelledJob", { id })
            : action === "approve"
              ? t("admin.approvedJob", { id })
              : t("admin.rejectedJob", { id })
      );
      await load();
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  return (
    <section className={styles.page} aria-label={t("admin.jobsTitle")}>
      <header className={styles.header}>
        <div>
          <h1>{t("admin.jobsTitle")}</h1>
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

      <div className={styles.toolbar}>
        <label>
          {t("admin.jobStatus")}
          <select
            aria-label="Job status filter"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {STATUS_VALUES.map((value) => (
              <option key={value || "all"} value={value}>
                {value ? t(`job.status.${value}`) : t("admin.allStatuses")}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("admin.approval")}
          <select
            aria-label="Approval filter"
            value={approval}
            onChange={(event) => setApproval(event.target.value)}
          >
            <option value="">{t("admin.all")}</option>
            <option value="pending">{t("admin.pendingApproval")}</option>
            <option value="approved">{t("admin.approved")}</option>
          </select>
        </label>
        <label className={styles.searchField}>
          {t("admin.userId")}
          <input
            aria-label={t("admin.userId")}
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder={t("admin.userIdPlaceholder")}
          />
        </label>
        <button
          type="button"
          data-admin-action="secondary"
          onClick={() => {
            setAppliedUserId(userId);
            if (userId === appliedUserId) void load();
          }}
        >
          <Search size={13} aria-hidden />
          {t("admin.query")}
        </button>
      </div>

      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className={styles.loading}>{t("admin.loadingJobs")}</p>
      ) : jobs.length === 0 ? (
        <div className={styles.empty}>
          <p>{t("admin.noJobs")}</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label="任务列表">
            <thead>
              <tr>
                <th scope="col">{t("admin.job")}</th>
                <th scope="col">{t("admin.jobUser")}</th>
                <th scope="col">{t("admin.jobType")}</th>
                <th scope="col">{t("admin.jobStatus")}</th>
                <th scope="col">{t("admin.jobAttempts")}</th>
                <th scope="col">{t("admin.jobError")}</th>
                <th scope="col">{t("admin.jobCreatedAt")}</th>
                <th scope="col">{t("admin.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const retryable = job.status === "failed" || job.status === "cancelled";
                const cancellable = job.status === "queued" || job.status === "running";
                return (
                  <tr key={job.id}>
                    <td>
                      <span className={styles.mono} title={job.id}>
                        {shortId(job.id)}
                      </span>
                    </td>
                    <td>
                      <span className={styles.mono} title={job.userId}>
                        {shortId(job.userId)}
                      </span>
                    </td>
                    <td>{t(`job.type.${job.type}`)}</td>
                    <td data-status={job.status}>
                      {t(`job.status.${job.status}`)}
                      {job.requiresApproval && !job.approvedAt ? (
                        <span className={styles.mutedBadge}>{t("admin.pendingApproval")}</span>
                      ) : null}
                    </td>
                    <td>
                      {job.attempts}/{job.maxAttempts}
                    </td>
                    <td>
                      <span className={styles.details} title={job.error ?? undefined}>
                        {job.error || "—"}
                      </span>
                    </td>
                    <td>{formatTime(job.createdAt)}</td>
                    <td>
                      <div className={styles.rowActions}>
                        {job.requiresApproval && !job.approvedAt && job.status === "queued" ? (
                          <>
                            <button
                              type="button"
                              className={styles.iconButton}
                              aria-label={t("admin.approveJob", { id: shortId(job.id) })}
                              title={t("admin.approve")}
                              disabled={busy[`approve:${job.id}`]}
                              onClick={() => void act(job, "approve")}
                            >
                              <Check size={12} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className={styles.iconButton}
                              aria-label={t("admin.rejectJob", { id: shortId(job.id) })}
                              title={t("admin.reject")}
                              disabled={busy[`reject:${job.id}`]}
                              onClick={() => void act(job, "reject")}
                            >
                              <X size={12} aria-hidden />
                            </button>
                          </>
                        ) : null}
                        {retryable ? (
                          <button
                            type="button"
                            className={styles.iconButton}
                            aria-label={`重试任务 ${shortId(job.id)}`}
                            title="重试"
                            disabled={busy[`retry:${job.id}`]}
                            onClick={() => void act(job, "retry")}
                          >
                            <RotateCcw size={12} aria-hidden />
                          </button>
                        ) : null}
                        {cancellable ? (
                          <button
                            type="button"
                            className={styles.iconButton}
                            aria-label={`取消任务 ${shortId(job.id)}`}
                            title="取消"
                            disabled={busy[`cancel:${job.id}`]}
                            onClick={() => void act(job, "cancel")}
                          >
                            <XCircle size={12} aria-hidden />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor ? (
        <button
          type="button"
          data-admin-action="secondary"
          onClick={() => void load(nextCursor)}
          disabled={loadingMore}
        >
          {loadingMore ? t("admin.loadingMore") : t("admin.loadMore")}
        </button>
      ) : null}
    </section>
  );
}
