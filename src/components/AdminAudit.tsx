"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, Search, ScrollText } from "lucide-react";
import { apiFetch, formatApiError } from "@/src/lib/api-client";
import { useI18n } from "@/src/i18n/I18nProvider";
import styles from "./AdminPanels.module.css";

type AuditLogRow = {
  id: string;
  action: string;
  actorRole: string | null;
  userId: string | null;
  userEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
};

const ACTION_LABELS: Record<string, string> = {
  "auth.register": "注册",
  "auth.login": "登录",
  "auth.login_failed": "登录失败",
  "auth.logout": "登出",
  "account.password_change": "自助改密",
  "account.2fa_setup": "开始设置两步验证",
  "account.2fa_enable": "启用两步验证",
  "account.2fa_disable": "停用两步验证",
  "account.2fa_recovery_regenerate": "重新生成恢复码",
  "account.recovery_code_used": "使用恢复码登录",
  "account.session_revoke": "吊销登录设备",
  "job.enqueue": "任务入队",
  "job.cancel": "取消任务",
  "job.complete": "任务完成",
  "job.fail": "任务失败",
  "asset.upload": "上传素材",
  "asset.delete": "删除素材",
  "product.create": "创建产品",
  "product.delete": "删除产品",
  "settings.update": "更新设置",
  "admin.user.list": "查看用户列表",
  "admin.user.create": "创建用户",
  "admin.user.update": "编辑用户",
  "admin.user.password_reset": "重置密码",
  "admin.job.list": "查看任务列表",
  "admin.stats.read": "查看统计",
  "admin.health.read": "查看健康",
  "admin.ai_config.update": "更新 AI 配置",
  "admin.ai_config.test": "测试 AI 连接",
  "admin.ai_config.reset": "回退 AI 配置",
  "admin.audit.list": "查看审计日志",
  "rate_limit.exceeded": "触发限流"
};

export function actionLabel(action: string, translate?: (key: string) => string): string {
  const label = ACTION_LABELS[action] ?? action;
  return translate ? translate(label) : label;
}

export function formatAuditTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDetails(metadata: unknown): string {
  if (metadata === null || metadata === undefined) return "—";
  try {
    const text = JSON.stringify(metadata);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  } catch {
    return "—";
  }
}

export function AdminAudit() {
  const { t } = useI18n();
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(30);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string>();

  const buildUrl = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      if (action) params.set("action", action);
      if (query.trim()) params.set("q", query.trim());
      params.set("limit", String(limit));
      if (cursor) params.set("cursor", cursor);
      return `/api/admin/audit?${params.toString()}`;
    },
    [action, query, limit]
  );

  const load = useCallback(
    async (cursor?: string) => {
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      setError(undefined);
      try {
        const data = await apiFetch<{
          logs?: AuditLogRow[];
          actions?: string[];
          nextCursor?: string | null;
        }>(buildUrl(cursor));
        const rows = data.logs ?? [];
        setLogs((current) => (cursor ? [...current, ...rows] : rows));
        setNextCursor(data.nextCursor ?? null);
        if (data.actions) setActions(data.actions);
      } catch (cause) {
        setError(formatApiError(cause, t("读取审计日志失败。")));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [buildUrl]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    setError(undefined);
    try {
      const params = new URLSearchParams();
      if (action) params.set("action", action);
      params.set("limit", "5000");
      const response = await fetch(`/api/admin/audit/export?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`${t("导出失败。")}（HTTP ${response.status}）`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("导出失败。"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className={styles.page} aria-label={t("审计日志")}>
      <header className={styles.header}>
        <div>
          <h1>{t("审计日志")}</h1>
          <p className={styles.headerMeta}>{t("安全与账户相关操作的追溯记录，最新在前。")}</p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            data-admin-action="secondary"
            onClick={() => void exportCsv()}
            disabled={exporting}
          >
            <Download size={13} aria-hidden />
            {exporting ? t("导出中…") : t("导出 CSV")}
          </button>
          <button
            type="button"
            data-admin-action="secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={13} aria-hidden />
            {t("刷新")}
          </button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <label>
          {t("操作类型")}
          <select aria-label={t("操作类型筛选")} value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">{t("全部操作")}</option>
            {actions.map((item) => (
              <option key={item} value={item}>
                {actionLabel(item, t)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.searchField}>
          {t("搜索")}
          <input
            aria-label={t("搜索审计日志")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("邮箱 / 操作 / 目标 ID")}
          />
        </label>
        <label>
          {t("每页")}
          <select
            aria-label={t("每页数量")}
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          >
            <option value={20}>20</option>
            <option value={30}>30</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className={styles.loading}>{t("正在读取审计日志…")}</p>
      ) : logs.length === 0 ? (
        <div className={styles.empty}>
          <ScrollText size={18} aria-hidden />
          <p>{t("暂无匹配的审计记录。")}</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label={t("审计日志列表")}>
            <thead>
              <tr>
                <th scope="col">{t("时间")}</th>
                <th scope="col">{t("操作")}</th>
                <th scope="col">{t("操作者")}</th>
                <th scope="col">{t("目标")}</th>
                <th scope="col">{t("请求编号")}</th>
                <th scope="col">{t("详情")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => (
                <tr key={row.id}>
                  <td>{formatAuditTime(row.createdAt)}</td>
                  <td>
                    <span className={styles.actionTag} title={row.action}>
                      {actionLabel(row.action, t)}
                    </span>
                  </td>
                  <td>
                    {row.userEmail ?? row.userId ?? row.actorRole ?? "—"}
                  </td>
                  <td>
                    {row.targetType || row.targetId ? (
                      <span className={styles.mono}>
                        {row.targetType ?? "—"}
                        {row.targetId ? ` · ${row.targetId}` : ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <span className={styles.mono}>{row.requestId ?? "—"}</span>
                  </td>
                  <td>
                    <span className={styles.details} title={formatDetails(row.metadata)}>
                      {formatDetails(row.metadata)}
                    </span>
                  </td>
                </tr>
              ))}
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
          {loadingMore ? t("加载中…") : t("加载更多")}
        </button>
      ) : null}
    </section>
  );
}
