"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, formatApiError, isApiClientError } from "@/src/lib/api-client";
import { useI18n } from "@/src/i18n/I18nProvider";
import styles from "./JobsCenter.module.css";

export type JobListItem = {
  id: string;
  type: string;
  status: string;
  progress?: number;
  result?: unknown;
  error?: string | null;
  attempts?: number;
  requiresApproval?: boolean;
  approvedAt?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

type JobsResponse = {
  jobs?: JobListItem[];
  nextCursor?: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消"
};

const TYPE_LABELS: Record<string, string> = {
  "style-transfer": "风格迁移",
  "sku-replacement": "SKU 替换",
  "pop-scene": "POP 物料设计",
  "white-background": "白底图多角度",
  "phone-standardize": "手机图标准化",
  localize: "多语言环境适应",
  "icon-design": "Icon Design",
  "product-video": "产品视频"
};

export const STATUS_FILTERS = [
  "all",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
] as const;

const POLL_INTERVAL_MS = 3000;

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

function clampProgress(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatJobTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function isCancellable(job: JobListItem): boolean {
  return job.status === "queued" || job.status === "running";
}

function isRetryable(job: JobListItem): boolean {
  return job.status === "failed" || job.status === "cancelled";
}

/**
 * Task center (SPEC R8.2): lists the signed-in user's async generation jobs,
 * polls while something is queued/running (paused while the tab is hidden),
 * filters by status and cancels jobs when the backend supports
 * `POST /api/jobs/[id]/cancel` (404/409 degrade gracefully).
 */
export function JobsCenter({ pollIntervalMs = POLL_INTERVAL_MS }: { pollIntervalMs?: number } = {}) {
  const { t } = useI18n();
  const statusText = (status: string) => t(`job.status.${status}`);
  const typeText = (type: string) => t(`job.type.${type}`);
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string>();
  const [unauthorized, setUnauthorized] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [notice, setNotice] = useState<string>();
  const [cancelling, setCancelling] = useState<Record<string, boolean>>({});
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const [loadingMore, setLoadingMore] = useState(false);

  const mountedRef = useRef(true);
  const jobsRef = useRef<JobListItem[]>([]);
  jobsRef.current = jobs;

  const load = useCallback(async (options?: { cursor?: string; silent?: boolean }) => {
    if (!options?.silent) {
      setPhase((current) => (current === "ready" ? current : "loading"));
    }
    try {
      const query = new URLSearchParams({ limit: "20" });
      if (options?.cursor) query.set("cursor", options.cursor);
      const payload = await apiFetch<JobsResponse>(`/api/jobs?${query.toString()}`);
      if (!mountedRef.current) return;
      const list = Array.isArray(payload?.jobs) ? payload.jobs : [];
      setJobs((current) => (options?.cursor ? [...current, ...list] : list));
      setNextCursor(typeof payload?.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : undefined);
      setUnauthorized(false);
      setError(undefined);
      setPhase("ready");
    } catch (cause) {
      if (!mountedRef.current) return;
      const message = formatApiError(cause, t("jobs.readFailed"));
      if (options?.silent && jobsRef.current.length > 0) {
        // Keep showing the last known list when a background refresh fails.
        setNotice(message);
        return;
      }
      setUnauthorized(isApiClientError(cause) && cause.status === 401);
      setError(message);
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const hasActiveJobs = useMemo(
    () => jobs.some((job) => job.status === "queued" || job.status === "running"),
    [jobs]
  );

  useEffect(() => {
    if (!hasActiveJobs) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleNext = () => {
      timer = setTimeout(async () => {
        if (disposed) return;
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          // Pause polling while the tab is in the background, then retry later.
          scheduleNext();
          return;
        }
        await load({ silent: true });
        if (!disposed) scheduleNext();
      }, pollIntervalMs);
    };

    scheduleNext();

    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void load({ silent: true });
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hasActiveJobs, load, pollIntervalMs]);

  const visibleJobs = useMemo(
    () => (statusFilter === "all" ? jobs : jobs.filter((job) => job.status === statusFilter)),
    [jobs, statusFilter]
  );

  const cancelJob = useCallback(
    async (job: JobListItem) => {
      setCancelling((current) => ({ ...current, [job.id]: true }));
      setNotice(undefined);
      try {
        await apiFetch(`/api/jobs/${encodeURIComponent(job.id)}/cancel`, { method: "POST" });
        setNotice(t("jobs.cancelled", { id: shortId(job.id) }));
        await load({ silent: true });
      } catch (cause) {
        if (isApiClientError(cause) && cause.status === 404) {
          // Graceful degradation: the cancel endpoint may not be deployed yet.
          setNotice(t("jobs.cancelUnsupported"));
        } else if (isApiClientError(cause) && cause.status === 409) {
          setNotice(t("jobs.stateChanged"));
          await load({ silent: true });
        } else {
          setNotice(formatApiError(cause, t("jobs.cancelFailed")));
        }
      } finally {
        if (mountedRef.current) {
          setCancelling((current) => {
            const next = { ...current };
            delete next[job.id];
            return next;
          });
        }
      }
    },
    [load]
  );

  const retryJob = useCallback(
    async (job: JobListItem) => {
      setRetrying((current) => ({ ...current, [job.id]: true }));
      setNotice(undefined);
      try {
        await apiFetch(`/api/jobs/${encodeURIComponent(job.id)}/retry`, { method: "POST" });
        setNotice(t("jobs.retried", { id: shortId(job.id) }));
        await load({ silent: true });
      } catch (cause) {
        if (isApiClientError(cause) && cause.status === 409) {
          setNotice(t("jobs.retryStateChanged"));
          await load({ silent: true });
        } else if (isApiClientError(cause) && cause.status === 429) {
          setNotice(formatApiError(cause, t("jobs.quotaFull")));
        } else {
          setNotice(formatApiError(cause, t("jobs.retryFailed")));
        }
      } finally {
        if (mountedRef.current) {
          setRetrying((current) => {
            const next = { ...current };
            delete next[job.id];
            return next;
          });
        }
      }
    },
    [load]
  );

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await load({ cursor: nextCursor, silent: true });
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  }

  return (
    <section aria-labelledby="jobs-title" className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 id="jobs-title">{t("jobs.title")}</h1>
        </div>
        <div className={styles.controls}>
          <label className={styles.filter}>
            {t("jobs.filter")}
            <select
              aria-label={t("jobs.filter")}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? t("jobs.allStatuses") : statusText(value)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => void load()}
            disabled={phase === "loading"}
          >
            {t("common.refresh")}
          </button>
        </div>
      </header>

      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      {phase === "loading" ? (
        <p className={styles.loadingState} aria-busy="true">
          {t("jobs.loading")}
        </p>
      ) : null}

      {phase === "error" ? (
        <div className={styles.errorState} role="alert">
          <p>{error}</p>
          <div className={styles.errorActions}>
            <button type="button" onClick={() => void load()}>
              {t("jobs.retry")}
            </button>
            {unauthorized ? <Link href="/login">{t("jobs.relogin")}</Link> : null}
          </div>
        </div>
      ) : null}

      {phase === "ready" && visibleJobs.length === 0 ? (
        <div className={styles.emptyState}>
          <p>
            {statusFilter === "all"
              ? t("jobs.emptyAll")
              : t("jobs.emptyFiltered")}
          </p>
          <Link href="/studio-home">{t("jobs.backToStudio")}</Link>
        </div>
      ) : null}

      {phase === "ready" && visibleJobs.length > 0 ? (
        <ul aria-label={t("jobs.list")} className={styles.list}>
          {visibleJobs.map((job) => {
            const progress = clampProgress(job.progress);
            const busyCancelling = Boolean(cancelling[job.id]);
            const busyRetrying = Boolean(retrying[job.id]);
            return (
              <li className={styles.item} data-status={job.status} key={job.id}>
                <div className={styles.itemMain}>
                  <div className={styles.itemTitle}>
                    <span className={styles.type}>{typeText(job.type)}</span>
                    <span className={styles.status} data-status={job.status}>
                      {statusText(job.status)}
                    </span>
                    {job.requiresApproval && !job.approvedAt ? (
                      <span className={styles.status} data-status="pending-approval">
                        {t("jobs.pendingApproval")}
                      </span>
                    ) : null}
                  </div>
                  <div className={styles.progressRow}>
                    <span
                      aria-label={t("jobs.progress", { type: typeText(job.type) })}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={progress}
                      className={styles.progressTrack}
                      role="progressbar"
                    >
                      <span className={styles.progressFill} style={{ width: `${progress}%` }} />
                    </span>
                    <span className={styles.progressText}>{progress}%</span>
                  </div>
                  <p className={styles.meta}>
                    {t("jobs.createdAt", { time: formatJobTime(job.createdAt) })} ·{" "}
                    {t("jobs.jobId", { id: shortId(job.id) })}
                    {job.attempts && job.attempts > 1
                      ? ` · ${t("jobs.attempt", { n: job.attempts })}`
                      : ""}
                  </p>
                  {job.error ? (
                    <p className={styles.jobError}>{t("jobs.error", { error: job.error })}</p>
                  ) : null}
                </div>
                {isCancellable(job) || isRetryable(job) ? (
                  <div className={styles.actions}>
                    {isCancellable(job) ? (
                      <button
                        type="button"
                        className={styles.cancelButton}
                        disabled={busyCancelling}
                        onClick={() => void cancelJob(job)}
                      >
                        {busyCancelling ? t("jobs.cancelling") : t("jobs.cancel")}
                      </button>
                    ) : null}
                    {isRetryable(job) ? (
                      <button
                        type="button"
                        className={styles.cancelButton}
                        disabled={busyRetrying}
                        onClick={() => void retryJob(job)}
                      >
                        {busyRetrying ? t("jobs.retrying") : t("jobs.retryJob")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {phase === "ready" && nextCursor ? (
        <button
          type="button"
          className={styles.loadMore}
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? t("jobs.loadingMore") : t("jobs.loadMore")}
        </button>
      ) : null}
    </section>
  );
}
