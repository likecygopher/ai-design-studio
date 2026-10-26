"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, PlugZap, Plus, RefreshCw, Star, Trash2 } from "lucide-react";
import { apiFetch, formatApiError } from "@/src/lib/api-client";
import { useI18n } from "@/src/i18n/I18nProvider";
import {
  AI_CHANNELS,
  AI_PROVIDER_PRESETS,
  channelMeta,
  type AiChannelId,
  type AiProviderModels
} from "@/src/platform/ai-provider-meta";
import { StudioDialog } from "./StudioDialog";
import styles from "./AdminPanels.module.css";

type ProviderView = {
  id: string;
  name: string;
  channel: AiChannelId;
  channelLabel: string;
  baseUrl: string;
  proxyUrl: string | null;
  models: AiProviderModels;
  enabled: boolean;
  priority: number;
  hasApiKey: boolean;
  apiKeyMasked: string;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestNote: string | null;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  active: boolean;
};

type ProvidersView = {
  providers: ProviderView[];
  channels: Array<{ id: AiChannelId; label: string; hint: string }>;
};

type TestResult = {
  ok: boolean;
  status?: number;
  reason: string;
  latencyMs: number;
  modelCount?: number;
  message?: string;
};

type ProviderFormValues = {
  name: string;
  channel: AiChannelId;
  baseUrl: string;
  proxyUrl: string;
  apiKey?: string;
  clearApiKey?: boolean;
  models: AiProviderModels;
  enabled: boolean;
};

const REASON_LABEL: Record<string, string> = {
  OK: "连接正常",
  NO_KEY: "未配置 API Key",
  AUTH_FAILED: "凭据被拒绝",
  ENDPOINT_NOT_FOUND: "接口地址不存在",
  TIMEOUT: "连接超时",
  NETWORK_ERROR: "网络不可达"
};

function reasonLabel(reason: string, translate: (key: string) => string): string {
  return translate(REASON_LABEL[reason] ?? reason.replace(/^HTTP_/, "HTTP "));
}

function formatDate(value: string | null, translate: (key: string) => string): string {
  if (!value) return translate("未测试");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function modelsSummary(
  provider: ProviderView,
  translate: (key: string) => string
): string {
  const meta = channelMeta(provider.channel);
  const parts = meta.modelFields
    .map((field) => {
      const value = provider.models[field.key as keyof AiProviderModels];
      return value
        ? `${translate(field.label).replace(translate("模型"), "")} ${value}`
        : null;
    })
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : translate("未配置模型");
}

export function AdminAiConfig() {
  const { t } = useI18n();
  const [view, setView] = useState<ProvidersView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; provider: ProviderView } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const applyView = useCallback((next: ProvidersView) => {
    setView(next);
  }, []);

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!options.silent) setLoading(true);
      setError(undefined);
      try {
        const data = await apiFetch<ProvidersView>("/api/admin/ai/providers");
        applyView(data);
      } catch (cause) {
        setError(formatApiError(cause, t("读取 AI 供应商失败。")));
      } finally {
        if (!options.silent) setLoading(false);
      }
    },
    [applyView]
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function save(values: ProviderFormValues) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const editing = dialog?.mode === "edit" ? dialog.provider : null;
      const url = editing
        ? `/api/admin/ai/providers/${encodeURIComponent(editing.id)}`
        : "/api/admin/ai/providers";
      const data = await apiFetch<ProvidersView>(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          channel: values.channel,
          baseUrl: values.baseUrl,
          proxyUrl: values.proxyUrl,
          models: values.models,
          enabled: values.enabled,
          ...(values.clearApiKey ? { clearApiKey: true } : {}),
          ...(values.apiKey ? { apiKey: values.apiKey } : {})
        })
      });
      applyView(data);
      setDialog(null);
      setNotice(
        editing
          ? t("供应商已更新并生效到新请求。")
          : t("已新增供应商「{name}」。", { name: values.name })
      );
    } catch (cause) {
      setError(formatApiError(cause, t("保存 AI 供应商失败。")));
    } finally {
      setBusy(false);
    }
  }

  async function testProvider(provider: ProviderView) {
    if (testingId) return;
    setTestingId(provider.id);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await apiFetch<TestResult>(
        `/api/admin/ai/providers/${encodeURIComponent(provider.id)}/test`,
        { method: "POST" }
      );
      await load({ silent: true });
      const suffix = [
        result.status ? `${result.status}` : null,
        `${result.latencyMs}ms`,
        typeof result.modelCount === "number"
          ? `${result.modelCount} ${t("个模型")}`
          : null,
        result.message ?? null
      ]
        .filter(Boolean)
        .join(" · ");
      setNotice(
        `「${provider.name}」${reasonLabel(result.reason, t)}${suffix ? ` · ${suffix}` : ""}`
      );
    } catch (cause) {
      setError(formatApiError(cause, t("连接测试失败。")));
    } finally {
      setTestingId(null);
    }
  }

  async function activate(provider: ProviderView) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const data = await apiFetch<ProvidersView>(
        `/api/admin/ai/providers/${encodeURIComponent(provider.id)}/default`,
        { method: "POST" }
      );
      applyView(data);
      setNotice(t("「{name}」已设为当前生效供应商。", { name: provider.name }));
    } catch (cause) {
      setError(formatApiError(cause, t("设置生效供应商失败。")));
    } finally {
      setBusy(false);
    }
  }

  async function remove(provider: ProviderView) {
    if (deletingId) return;
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(
            t("确认删除供应商「{name}」？该操作不可撤销。", { name: provider.name })
          );
    if (!confirmed) return;

    setDeletingId(provider.id);
    setError(undefined);
    setNotice(undefined);
    try {
      const data = await apiFetch<ProvidersView>(
        `/api/admin/ai/providers/${encodeURIComponent(provider.id)}`,
        { method: "DELETE" }
      );
      applyView(data);
      setNotice(t("已删除供应商「{name}」。", { name: provider.name }));
    } catch (cause) {
      setError(formatApiError(cause, t("删除供应商失败。")));
    } finally {
      setDeletingId(null);
    }
  }

  const providers = view?.providers ?? [];

  return (
    <section className={styles.page} aria-label={t("AI 引擎配置")}>
      <header className={styles.header}>
        <div>
          <h1>{t("AI 引擎")}</h1>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            data-admin-action="secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={13} aria-hidden />
            {t("刷新")}
          </button>
          <button
            type="button"
            data-admin-action="primary"
            onClick={() => {
              setNotice(undefined);
              setDialog({ mode: "create" });
            }}
          >
            <Plus size={13} aria-hidden />
            {t("新增供应商")}
          </button>
        </div>
      </header>

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
        <p className={styles.loading}>{t("正在读取供应商…")}</p>
      ) : providers.length === 0 ? (
        <div className={styles.empty}>
          <p>{t("还没有配置 AI 供应商。")}</p>
          <button
            type="button"
            data-admin-action="primary"
            onClick={() => setDialog({ mode: "create" })}
          >
            <Plus size={13} aria-hidden />
            {t("新增供应商")}
          </button>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label={t("AI 供应商列表")}>
            <thead>
              <tr>
                <th scope="col">{t("供应商")}</th>
                <th scope="col">{t("模型")}</th>
                <th scope="col">{t("状态")}</th>
                <th scope="col">{t("最近测试")}</th>
                <th scope="col">{t("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <td>
                    <div className={styles.providerName}>
                      <strong>{provider.name}</strong>
                      <span className={styles.channelText}>{provider.channelLabel}</span>
                      <span
                        className={styles.providerUsage}
                        title={provider.lastFailureReason ?? undefined}
                      >
                        {t("调用 {success} 成功 · {failure} 失败", {
                          success: provider.successCount,
                          failure: provider.failureCount
                        })}
                        {provider.consecutiveFailures > 0
                          ? t(" · 连续失败 {count}", { count: provider.consecutiveFailures })
                          : ""}
                      </span>
                      <div className={styles.badgeRow}>
                        {provider.active ? (
                          <span className={styles.activeBadge}>
                            <Star size={10} aria-hidden /> {t("生效中")}
                          </span>
                        ) : null}
                        {provider.consecutiveFailures >= 2 ? (
                          <span className={styles.failBadge}>{t("连续失败 · 已切换")}</span>
                        ) : null}
                        {!provider.enabled ? (
                          <span className={styles.mutedBadge}>{t("已停用")}</span>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={styles.modelsCell}>{modelsSummary(provider, t)}</span>
                  </td>
                  <td>
                    {provider.enabled ? t("已启用") : t("已停用")}
                    {provider.hasApiKey ? "" : t(" · 缺少 Key")}
                  </td>
                  <td>
                    <span
                      className={styles.testCell}
                      data-ok={provider.lastTestOk ?? undefined}
                      title={provider.lastTestNote ?? undefined}
                    >
                      <span>{formatDate(provider.lastTestAt, t)}</span>
                      <span>
                        {provider.lastTestAt
                          ? provider.lastTestOk
                            ? t("正常 · {note}", { note: provider.lastTestNote ?? "" })
                            : t("失败 · {note}", { note: provider.lastTestNote ?? "" })
                          : t("未测试")}
                      </span>
                    </span>
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={t("编辑 {name}", { name: provider.name })}
                        title={t("编辑")}
                        onClick={() => {
                          setNotice(undefined);
                          setDialog({ mode: "edit", provider });
                        }}
                      >
                        <Pencil size={12} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={t("测试连接 {name}", { name: provider.name })}
                        title={t("测试连接")}
                        onClick={() => void testProvider(provider)}
                        disabled={testingId === provider.id}
                      >
                        <PlugZap size={12} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={t("设为生效 {name}", { name: provider.name })}
                        title={t("设为生效")}
                        onClick={() => void activate(provider)}
                        disabled={provider.active || busy}
                      >
                        <Star size={12} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={t("删除 {name}", { name: provider.name })}
                        title={t("删除")}
                        onClick={() => void remove(provider)}
                        disabled={deletingId === provider.id}
                      >
                        <Trash2 size={12} aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog ? (
        <StudioDialog
          title={
            dialog.mode === "create" ? t("新增 AI 供应商") : t("编辑 AI 供应商")
          }
          onClose={() => setDialog(null)}
          busy={busy}
        >
          <ProviderForm
            channels={view?.channels ?? AI_CHANNELS.map((channel) => ({
              id: channel.id,
              label: channel.label,
              hint: channel.hint
            }))}
            provider={dialog.mode === "edit" ? dialog.provider : undefined}
            busy={busy}
            onSubmit={save}
            onCancel={() => setDialog(null)}
          />
        </StudioDialog>
      ) : null}
    </section>
  );
}

function ProviderForm({
  channels,
  provider,
  busy,
  onSubmit,
  onCancel
}: {
  channels: Array<{ id: AiChannelId; label: string; hint: string }>;
  provider?: ProviderView;
  busy: boolean;
  onSubmit: (values: ProviderFormValues) => void;
  onCancel: () => void;
}) {
  const [presetId, setPresetId] = useState("custom");
  const [name, setName] = useState(provider?.name ?? "");
  const [channel, setChannel] = useState<AiChannelId>(provider?.channel ?? "openai-compatible");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [proxyUrl, setProxyUrl] = useState(provider?.proxyUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [models, setModels] = useState<AiProviderModels>({ ...(provider?.models ?? {}) });
  const { t } = useI18n();
  const [localError, setLocalError] = useState<string>();

  const editing = Boolean(provider);
  const meta = channelMeta(channel);

  function applyPreset(id: string) {
    setPresetId(id);
    const preset = AI_PROVIDER_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setName(preset.name === "自定义 OpenAI 兼容" ? "" : preset.name);
    setChannel(preset.channel as AiChannelId);
    setBaseUrl(preset.baseUrl);
    setModels({ ...preset.models });
  }

  function submit() {
    if (!name.trim()) {
      setLocalError(t("请输入供应商名称。"));
      return;
    }
    setLocalError(undefined);
    onSubmit({
      name: name.trim(),
      channel,
      baseUrl,
      proxyUrl,
      models,
      enabled,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(clearApiKey ? { clearApiKey: true } : {})
    });
  }

  return (
    <div className={styles.form}>
      {!editing ? (
        <>
          <div className={styles.presetRow} role="group" aria-label={t("预设")}>
            {AI_PROVIDER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={styles.presetButton}
                data-active={presetId === preset.id}
                onClick={() => applyPreset(preset.id)}
              >
                {preset.name}
              </button>
            ))}
          </div>
          <p className={styles.formHint}>{t("预设只填写默认值，保存前可自由修改。")}</p>
        </>
      ) : null}

      <div className={styles.formGrid}>
        <label className={styles.formField}>
          {t("名称")}
          <input
            aria-label={t("供应商名称")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("例如：OpenAI 生产 / DeepSeek")}
          />
        </label>
        <label className={styles.formField}>
          {t("渠道")}
          <select
            aria-label={t("供应商渠道")}
            value={channel}
            onChange={(event) => setChannel(event.target.value as AiChannelId)}
          >
            {channels.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.formField}>
          Base URL
          <input
            aria-label={t("供应商 Base URL")}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={meta.id === "ark" ? "https://ark.cn-beijing.volces.com/api/v3" : "https://api.openai.com/v1"}
          />
        </label>
        <label className={styles.formField}>
          {t("代理")}
          <input
            aria-label={t("供应商代理")}
            value={proxyUrl}
            onChange={(event) => setProxyUrl(event.target.value)}
            placeholder={t("http://127.0.0.1:10808（可选）")}
          />
        </label>
      </div>

      <div className={styles.formGrid}>
        <label className={styles.formField}>
          API Key
          <input
            aria-label={t("供应商 API Key")}
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              if (event.target.value) setClearApiKey(false);
            }}
            placeholder={
              clearApiKey
                ? t("保存后清除平台密钥")
                : provider?.apiKeyMasked
                  ? t("{masked}（留空保持不变）", { masked: provider.apiKeyMasked })
                  : t("未配置")
            }
          />
        </label>
        {provider?.hasApiKey ? (
          <span className={styles.checkboxField}>
            <input
              aria-label={t("清除已保存的 API Key")}
              type="checkbox"
              checked={clearApiKey}
              onChange={(event) => {
                setClearApiKey(event.target.checked);
                if (event.target.checked) setApiKey("");
              }}
            />
            {t("清除已保存的 API Key")}
          </span>
        ) : null}
      </div>

      <div className={styles.formGrid}>
        {meta.modelFields.map((field) => (
          <label className={styles.formField} key={field.key}>
            {t(field.label)}
            <input
              aria-label={t("模型 · {label}", { label: t(field.label) })}
              value={models[field.key as keyof AiProviderModels] ?? ""}
              onChange={(event) =>
                setModels((current) => ({ ...current, [field.key]: event.target.value }))
              }
              placeholder={field.placeholder}
            />
          </label>
        ))}
      </div>

      <span className={styles.checkboxField}>
        <input
          aria-label={t("启用该供应商")}
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        {t("启用（同渠道优先使用最靠前的启用项）")}
      </span>

      {localError ? (
        <p className={styles.error} role="alert">
          {localError}
        </p>
      ) : null}

      <div className={styles.dialogActions}>
        <button type="button" data-admin-action="secondary" onClick={onCancel} disabled={busy}>
          {t("取消")}
        </button>
        <button type="button" data-admin-action="primary" onClick={submit} disabled={busy}>
          {busy
            ? t("保存中…")
            : editing
              ? t("保存修改")
              : t("新增供应商")}
        </button>
      </div>
    </div>
  );
}
