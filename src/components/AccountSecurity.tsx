"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { KeyRound, Laptop, ShieldCheck, UserRound } from "lucide-react";
import { apiFetch, formatApiError } from "@/src/lib/api-client";
import { useI18n } from "@/src/i18n/I18nProvider";
import styles from "./AccountSecurity.module.css";

export type AccountUser = {
  id: string;
  email: string;
  role: string;
};

type TwoFactorStatus = { enabled: boolean; recoveryCodesRemaining: number };

type ApiTokenView = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

type WebhookView = {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: string | null;
  createdAt: string;
};

type DeliveryView = {
  id: string;
  event: string;
  status: string;
  responseStatus: number | null;
  error: string | null;
  attempts: number;
  createdAt: string;
};

type SessionView = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

type PasswordPolicyError =
  | "account.passwordShort"
  | "account.passwordLong"
  | "account.passwordLetter"
  | "account.passwordDigit";

function validateNewPassword(password: string): PasswordPolicyError | undefined {
  if (password.length < 8) return "account.passwordShort";
  if (password.length > 72) return "account.passwordLong";
  if (!/[A-Za-z]/.test(password)) return "account.passwordLetter";
  if (!/\d/.test(password)) return "account.passwordDigit";
  return undefined;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "未知设备";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Safari\//.test(userAgent)
        ? "Safari"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : "浏览器";
  const os = /Mac OS X|Macintosh/.test(userAgent)
    ? "macOS"
    : /Windows/.test(userAgent)
      ? "Windows"
      : /Android/.test(userAgent)
        ? "Android"
        : /iPhone|iPad/.test(userAgent)
          ? "iOS"
          : "";
  return os ? `${browser} · ${os}` : browser;
}

/**
 * Self-service account page: password change, TOTP two-factor authentication
 * and device sessions. Password/2FA changes revoke sessions server-side.
 */
export function AccountSecurity({ user }: { user: AccountUser }) {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [twoFactor, setTwoFactor] = useState<TwoFactorStatus | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [licenseCode, setLicenseCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string>();
  const [twoFactorNotice, setTwoFactorNotice] = useState<string>();

  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [sessionsError, setSessionsError] = useState<string>();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [apiTokens, setApiTokens] = useState<ApiTokenView[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [tokenName, setTokenName] = useState("");
  const [createdToken, setCreatedToken] = useState<string>();
  const [tokenScope, setTokenScope] = useState<"read-write" | "read">("read-write");
  const [webhooks, setWebhooks] = useState<WebhookView[]>([]);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSucceeded, setWebhookSucceeded] = useState(true);
  const [webhookFailed, setWebhookFailed] = useState(true);
  const [createdWebhookSecret, setCreatedWebhookSecret] = useState<string>();
  const [openDeliveriesId, setOpenDeliveriesId] = useState<string>();
  const [deliveries, setDeliveries] = useState<Record<string, DeliveryView[]>>({});
  const [deliveryBusy, setDeliveryBusy] = useState<string>();
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState<string>();
  const [tokenNotice, setTokenNotice] = useState<string>();

  const roleLabel = user.role === "admin" ? t("account.roleAdmin") : t("account.roleUser");

  const loadTwoFactor = useCallback(async () => {
    try {
      const status = await apiFetch<TwoFactorStatus>("/api/account/2fa");
      setTwoFactor(status);
    } catch (cause) {
      setTwoFactorError(formatApiError(cause, t("common.error")));
    }
  }, []);

  const loadWebhooks = useCallback(async () => {
    try {
      const data = await apiFetch<{ webhooks?: WebhookView[] }>("/api/account/webhooks");
      setWebhooks(data.webhooks ?? []);
    } catch {
      // Optional card; keep the rest of the page usable.
    }
  }, []);

  const loadApiTokens = useCallback(async () => {
    try {
      const data = await apiFetch<{ tokens?: ApiTokenView[] }>("/api/account/api-tokens");
      setApiTokens(data.tokens ?? []);
    } catch {
      // The token card is optional; keep the rest of the page usable.
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const data = await apiFetch<{ sessions?: SessionView[] }>("/api/account/sessions");
      setSessions(data.sessions ?? []);
    } catch (cause) {
      setSessionsError(formatApiError(cause, t("common.error")));
    }
  }, []);

  useEffect(() => {
    void loadTwoFactor();
    void loadSessions();
    void loadApiTokens();
    void loadWebhooks();
  }, [loadTwoFactor, loadSessions, loadApiTokens, loadWebhooks]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(undefined);

    if (!currentPassword) {
      setError(t("account.missingCurrent"));
      return;
    }
    const policyError = validateNewPassword(newPassword);
    if (policyError) {
      setError(t(policyError));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("account.passwordMismatch"));
      return;
    }
    if (newPassword === currentPassword) {
      setError(t("account.passwordSame"));
      return;
    }

    setBusy(true);
    try {
      await apiFetch<{ reauthRequired?: boolean }>("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      await signOut({ callbackUrl: "/login?expired=1" });
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function startSetup() {
    if (twoFactorBusy) return;
    setTwoFactorBusy(true);
    setTwoFactorError(undefined);
    setTwoFactorNotice(undefined);
    setRecoveryCodes(null);
    try {
      const data = await apiFetch<{ secret: string; otpauthUri: string }>(
        "/api/account/2fa/setup",
        { method: "POST" }
      );
      setSetup(data);
      setLicenseCode("");
    } catch (cause) {
      setTwoFactorError(formatApiError(cause, t("common.error")));
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function enableTwoFactor() {
    if (twoFactorBusy) return;
    setTwoFactorBusy(true);
    setTwoFactorError(undefined);
    try {
      const data = await apiFetch<{ recoveryCodes: string[] }>("/api/account/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: licenseCode.trim() })
      });
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
      setLicenseCode("");
      setTwoFactorNotice(t("account.enabledNotice"));
      await loadTwoFactor();
    } catch (cause) {
      setTwoFactorError(formatApiError(cause, t("common.error")));
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function disableTwoFactor() {
    if (twoFactorBusy) return;
    setTwoFactorBusy(true);
    setTwoFactorError(undefined);
    setTwoFactorNotice(undefined);
    try {
      await apiFetch("/api/account/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: licenseCode.trim() })
      });
      setLicenseCode("");
      setRecoveryCodes(null);
      setTwoFactorNotice(t("account.disabledNotice"));
      await loadTwoFactor();
    } catch (cause) {
      setTwoFactorError(formatApiError(cause, t("common.error")));
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function regenerateRecovery() {
    if (twoFactorBusy) return;
    setTwoFactorBusy(true);
    setTwoFactorError(undefined);
    setTwoFactorNotice(undefined);
    try {
      const data = await apiFetch<{ recoveryCodes: string[] }>(
        "/api/account/2fa/recovery",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: licenseCode.trim() })
        }
      );
      setRecoveryCodes(data.recoveryCodes);
      setLicenseCode("");
      setTwoFactorNotice(t("account.regeneratedNotice"));
      await loadTwoFactor();
    } catch (cause) {
      setTwoFactorError(formatApiError(cause, t("common.error")));
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function createToken() {
    if (tokenBusy || !tokenName.trim()) return;
    setTokenBusy(true);
    setTokenError(undefined);
    setTokenNotice(undefined);
    setCreatedToken(undefined);
    try {
      const data = await apiFetch<{ token: string; apiToken: ApiTokenView }>(
        "/api/account/api-tokens",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: tokenName.trim(),
            scopes: tokenScope === "read" ? ["read"] : ["read", "write"]
          })
        }
      );
      setCreatedToken(data.token);
      setTokenName("");
      setTokenNotice(t("account.tokenNotice"));
      await loadApiTokens();
    } catch (cause) {
      setTokenError(formatApiError(cause, t("common.error")));
    } finally {
      setTokenBusy(false);
    }
  }

  async function revokeToken(token: ApiTokenView) {
    setTokenBusy(true);
    setTokenError(undefined);
    try {
      await apiFetch(`/api/account/api-tokens/${encodeURIComponent(token.id)}`, {
        method: "DELETE"
      });
      await loadApiTokens();
    } catch (cause) {
      setTokenError(formatApiError(cause, t("common.error")));
    } finally {
      setTokenBusy(false);
    }
  }

  async function copyCreatedToken() {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setTokenNotice(t("account.copied"));
    } catch {
      // Clipboard may be unavailable; the token stays visible for manual copy.
    }
  }

  async function deleteAccount() {
    if (deleteBusy || !deletePassword) return;
    setDeleteBusy(true);
    setDeleteError(undefined);
    try {
      await apiFetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword })
      });
      await signOut({ callbackUrl: "/login?expired=1" });
    } catch (cause) {
      setDeleteError(formatApiError(cause, t("common.error")));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function createWebhook() {
    if (tokenBusy || !webhookUrl.trim()) return;
    const events = [
      ...(webhookSucceeded ? ["job.succeeded"] : []),
      ...(webhookFailed ? ["job.failed"] : [])
    ];
    if (events.length === 0) return;
    setTokenBusy(true);
    setTokenError(undefined);
    setCreatedWebhookSecret(undefined);
    try {
      const data = await apiFetch<{ webhook: WebhookView; secret: string }>(
        "/api/account/webhooks",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: webhookUrl.trim(), events })
        }
      );
      setCreatedWebhookSecret(data.secret);
      setWebhookUrl("");
      setTokenNotice(t("account.webhookNotice"));
      await loadWebhooks();
    } catch (cause) {
      setTokenError(formatApiError(cause, t("common.error")));
    } finally {
      setTokenBusy(false);
    }
  }

  async function loadDeliveries(webhookId: string) {
    try {
      const data = await apiFetch<{ deliveries?: DeliveryView[] }>(
        `/api/account/webhooks/${encodeURIComponent(webhookId)}/deliveries`
      );
      setDeliveries((current) => ({ ...current, [webhookId]: data.deliveries ?? [] }));
    } catch (cause) {
      setTokenError(formatApiError(cause, t("common.error")));
    }
  }

  async function toggleDeliveries(webhookId: string) {
    if (openDeliveriesId === webhookId) {
      setOpenDeliveriesId(undefined);
      return;
    }
    setOpenDeliveriesId(webhookId);
    await loadDeliveries(webhookId);
  }

  async function retryDelivery(webhookId: string, delivery: DeliveryView) {
    setDeliveryBusy(delivery.id);
    setTokenError(undefined);
    try {
      await apiFetch(
        `/api/account/webhooks/${encodeURIComponent(webhookId)}/deliveries/${encodeURIComponent(delivery.id)}/retry`,
        { method: "POST" }
      );
      await loadDeliveries(webhookId);
      await loadWebhooks();
    } catch (cause) {
      setTokenError(formatApiError(cause, t("common.error")));
    } finally {
      setDeliveryBusy(undefined);
    }
  }

  async function deleteWebhook(webhook: WebhookView) {
    if (!window.confirm(t("account.webhookDeleteConfirm"))) return;
    setTokenBusy(true);
    setTokenError(undefined);
    try {
      await apiFetch(`/api/account/webhooks/${encodeURIComponent(webhook.id)}`, {
        method: "DELETE"
      });
      await loadWebhooks();
    } catch (cause) {
      setTokenError(formatApiError(cause, t("common.error")));
    } finally {
      setTokenBusy(false);
    }
  }

  async function revokeSession(session: SessionView) {
    if (revokingId) return;
    setRevokingId(session.id);
    setSessionsError(undefined);
    try {
      const data = await apiFetch<{ revokedCurrent?: boolean }>(
        `/api/account/sessions/${encodeURIComponent(session.id)}`,
        { method: "DELETE" }
      );
      if (data.revokedCurrent) {
        await signOut({ callbackUrl: "/login?expired=1" });
        return;
      }
      await loadSessions();
    } catch (cause) {
      setSessionsError(formatApiError(cause, t("common.error")));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section className={styles.page} aria-label={t("account.title")}>
      <header className={styles.header}>
        <div>
          <h1>{t("account.title")}</h1>
        </div>
      </header>

      <div className={styles.grid}>
        <section className={styles.card} aria-label={t("account.info")}>
          <h2>
            <UserRound size={15} aria-hidden />
            {t("account.info")}
          </h2>
          <dl className={styles.detailList}>
            <div>
              <dt>{t("account.email")}</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>{t("account.role")}</dt>
              <dd>
                <span className={styles.roleBadge} data-role={user.role}>
                  <ShieldCheck size={12} aria-hidden />
                  {roleLabel}
                </span>
              </dd>
            </div>
          </dl>
        </section>

        <section className={styles.card} aria-label={t("account.password")}>
          <h2>
            <KeyRound size={15} aria-hidden />
            {t("account.password")}
          </h2>
          <form className={styles.form} onSubmit={onSubmit} noValidate>
            <label>
              {t("account.currentPassword")}
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </label>
            <label>
              {t("account.newPassword")}
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </label>
            <p className={styles.ruleHint}>{t("account.ruleHint")}</p>
            <label>
              {t("account.confirmPassword")}
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </label>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
            <button className={styles.submit} data-account-action="primary" type="submit" disabled={busy}>
              {busy ? t("account.busy") : t("account.submitPassword")}
            </button>
          </form>
        </section>

        <section className={styles.card} aria-label={t("account.twoFactor")}>
          <h2>
            <ShieldCheck size={15} aria-hidden />
            {t("account.twoFactor")}
          </h2>
          <p className={styles.hint}>
            {twoFactor?.enabled
              ? t("account.twoFactorEnabled", { count: twoFactor.recoveryCodesRemaining })
              : t("account.twoFactorDisabled")}
          </p>

          {twoFactor?.enabled ? (
            <div className={styles.form}>
              <label>
                {t("account.codeOrRecovery")}
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={licenseCode}
                  onChange={(event) => setLicenseCode(event.target.value)}
                  placeholder={t("account.codePlaceholder")}
                />
              </label>
              <div className={styles.actionRow}>
                <button
                  type="button"
                  className={styles.secondary}
                  data-account-action="secondary"
                  onClick={() => void regenerateRecovery()}
                  disabled={twoFactorBusy || !licenseCode.trim()}
                >
                  {t("account.regenerateRecovery")}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  data-account-action="secondary"
                  onClick={() => void disableTwoFactor()}
                  disabled={twoFactorBusy || !licenseCode.trim()}
                >
                  {t("account.disableTwoFactor")}
                </button>
              </div>
            </div>
          ) : setup ? (
            <div className={styles.form}>
              <p className={styles.hint}>{t("account.setupHint")}</p>
              <code className={styles.codeBlock}>{setup.secret}</code>
              <code className={styles.codeBlock}>{setup.otpauthUri}</code>
              <label>
                {t("account.verifyCode")}
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={licenseCode}
                  onChange={(event) => setLicenseCode(event.target.value)}
                  placeholder={t("account.verifyCodePlaceholder")}
                />
              </label>
              <button
                type="button"
                className={styles.submit}
                data-account-action="primary"
                onClick={() => void enableTwoFactor()}
                disabled={twoFactorBusy || licenseCode.trim().length < 6}
              >
                {twoFactorBusy ? t("account.verifying") : t("account.enableVerify")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.submit}
              data-account-action="primary"
              onClick={() => void startSetup()}
              disabled={twoFactorBusy}
            >
              {twoFactorBusy ? t("account.generating") : t("account.startSetup")}
            </button>
          )}

          {recoveryCodes ? (
            <div className={styles.recoveryBox}>
              <strong>{t("account.recoveryOnce")}</strong>
              <ul>
                {recoveryCodes.map((code) => (
                  <li key={code}>
                    <code>{code}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {twoFactorNotice ? (
            <p className={styles.notice} role="status">
              {twoFactorNotice}
            </p>
          ) : null}
          {twoFactorError ? (
            <p className={styles.error} role="alert">
              {twoFactorError}
            </p>
          ) : null}
        </section>

        <section className={styles.card} aria-label={t("account.tokens")}>
          <h2>
            <KeyRound size={15} aria-hidden />
            {t("account.tokens")}
          </h2>
          {createdToken ? (
            <div className={styles.recoveryBox}>
              <strong>{t("account.tokenOnce")}</strong>
              <code className={styles.codeBlock}>{createdToken}</code>
              <button
                type="button"
                className={styles.secondary}
                data-account-action="secondary"
                onClick={() => void copyCreatedToken()}
              >
                {t("account.copy")}
              </button>
            </div>
          ) : null}
          <div className={styles.form}>
            <label>
              {t("account.tokenName")}
              <input
                value={tokenName}
                onChange={(event) => setTokenName(event.target.value)}
                placeholder={t("account.tokenNamePlaceholder")}
              />
            </label>
            <label>
              {t("account.tokenScope")}
              <select
                value={tokenScope}
                onChange={(event) =>
                  setTokenScope(event.target.value as "read-write" | "read")
                }
              >
                <option value="read-write">{t("account.scopeReadWrite")}</option>
                <option value="read">{t("account.scopeRead")}</option>
              </select>
            </label>
            <button
              type="button"
              className={styles.submit}
              data-account-action="primary"
              onClick={() => void createToken()}
              disabled={tokenBusy || !tokenName.trim()}
            >
              {t("account.createToken")}
            </button>
          </div>
          {apiTokens.length === 0 ? (
            <p className={styles.hint}>{t("account.tokensEmpty")}</p>
          ) : (
            <ul className={styles.sessionList}>
              {apiTokens.map((token) => (
                <li key={token.id} className={styles.sessionRow}>
                  <div>
                    <strong>{token.name}</strong>
                    <span className={styles.sessionMeta}>
                      {token.prefix}… ·{" "}
                      {token.lastUsedAt
                        ? t("account.lastUsed", { time: formatTime(token.lastUsedAt) })
                        : t("account.neverUsed")}
                    </span>
                  </div>
                  {token.revokedAt ? (
                    <span className={styles.currentTag}>{t("account.revoke")}</span>
                  ) : (
                    <button
                      type="button"
                      className={styles.secondary}
                      data-account-action="secondary"
                      onClick={() => void revokeToken(token)}
                      disabled={tokenBusy}
                    >
                      {t("account.revokeToken")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {tokenNotice ? (
            <p className={styles.notice} role="status">
              {tokenNotice}
            </p>
          ) : null}
          {tokenError ? (
            <p className={styles.error} role="alert">
              {tokenError}
            </p>
          ) : null}
        </section>

        <section className={styles.card} aria-label={t("account.webhooks")}>
          <h2>
            <KeyRound size={15} aria-hidden />
            {t("account.webhooks")}
          </h2>
          {createdWebhookSecret ? (
            <div className={styles.recoveryBox}>
              <strong>{t("account.webhookSecretOnce")}</strong>
              <code className={styles.codeBlock}>{createdWebhookSecret}</code>
            </div>
          ) : null}
          <div className={styles.form}>
            <label>
              {t("account.webhookUrl")}
              <input
                value={webhookUrl}
                onChange={(event) => setWebhookUrl(event.target.value)}
                placeholder={t("account.webhookUrlPlaceholder")}
              />
            </label>
            <div className={styles.actionRow}>
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={webhookSucceeded}
                  onChange={(event) => setWebhookSucceeded(event.target.checked)}
                />
                {t("account.webhookEventSucceeded")}
              </label>
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={webhookFailed}
                  onChange={(event) => setWebhookFailed(event.target.checked)}
                />
                {t("account.webhookEventFailed")}
              </label>
            </div>
            <button
              type="button"
              className={styles.submit}
              data-account-action="primary"
              onClick={() => void createWebhook()}
              disabled={tokenBusy || !webhookUrl.trim()}
            >
              {t("account.createWebhook")}
            </button>
          </div>
          {webhooks.length === 0 ? (
            <p className={styles.hint}>{t("account.webhooksEmpty")}</p>
          ) : (
            <ul className={styles.sessionList}>
              {webhooks.map((webhook) => (
                <li key={webhook.id} className={styles.sessionRow}>
                  <div>
                    <strong>{webhook.url}</strong>
                    <span className={styles.sessionMeta}>{webhook.events.join(" · ")}</span>
                  </div>
                  <div className={styles.actionRow}>
                    <button
                      type="button"
                      className={styles.secondary}
                      data-account-action="secondary"
                      onClick={() => void toggleDeliveries(webhook.id)}
                    >
                      {openDeliveriesId === webhook.id
                        ? t("account.hideDeliveries")
                        : t("account.deliveries")}
                    </button>
                    <button
                      type="button"
                      className={styles.secondary}
                      data-account-action="secondary"
                      onClick={() => void deleteWebhook(webhook)}
                      disabled={tokenBusy}
                    >
                      {t("account.deleteWebhook")}
                    </button>
                  </div>
                  {openDeliveriesId === webhook.id ? (
                    <div className={styles.deliveryList}>
                      {(deliveries[webhook.id] ?? []).length === 0 ? (
                        <p className={styles.hint}>{t("account.deliveriesEmpty")}</p>
                      ) : (
                        <ul>
                          {(deliveries[webhook.id] ?? []).map((delivery) => (
                            <li key={delivery.id} className={styles.deliveryRow}>
                              <span>{delivery.event}</span>
                              <span>
                                {delivery.status === "delivered"
                                  ? t("account.deliveryDelivered")
                                  : delivery.status === "failed"
                                    ? t("account.deliveryFailed")
                                    : t("account.deliveryPending")}
                                {" · "}
                                {t("account.deliveryAttempts", {
                                  count: delivery.attempts
                                })}
                              </span>
                              {delivery.error ? <span>{delivery.error}</span> : null}
                              {delivery.status === "failed" ? (
                                <button
                                  type="button"
                                  className={styles.secondary}
                                  disabled={deliveryBusy === delivery.id}
                                  onClick={() => void retryDelivery(webhook.id, delivery)}
                                >
                                  {deliveryBusy === delivery.id
                                    ? t("account.retrying")
                                    : t("account.retryDelivery")}
                                </button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.card} aria-label={t("account.data")}>
          <h2>
            <KeyRound size={15} aria-hidden />
            {t("account.data")}
          </h2>
          <p className={styles.hint}>{t("account.dataHint")}</p>
          <div className={styles.actionRow}>
            <a
              className={styles.secondary}
              href="/api/account/export"
              download
              data-account-action="secondary"
            >
              {t("account.exportData")}
            </a>
            <button
              type="button"
              className={styles.secondary}
              data-account-action="secondary"
              onClick={() => {
                setDeleteOpen((current) => !current);
                setDeleteError(undefined);
              }}
            >
              {t("account.deleteAccount")}
            </button>
          </div>
          {deleteOpen ? (
            <div className={styles.form}>
              <p className={styles.error} role="alert">
                {t("account.deleteWarning")}
              </p>
              <label>
                {t("account.deletePassword")}
                <input
                  type="password"
                  autoComplete="current-password"
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)}
                />
              </label>
              <button
                type="button"
                className={styles.submit}
                data-account-action="primary"
                onClick={() => void deleteAccount()}
                disabled={deleteBusy || !deletePassword}
              >
                {deleteBusy ? t("account.deleteBusy") : t("account.deleteConfirm")}
              </button>
              {deleteError ? (
                <p className={styles.error} role="alert">
                  {deleteError}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className={styles.card} aria-label={t("account.devices")}>
          <h2>
            <Laptop size={15} aria-hidden />
            {t("account.devices")}
          </h2>
          {sessions.length === 0 ? (
            <p className={styles.hint}>{t("account.noSessions")}</p>
          ) : (
            <ul className={styles.sessionList}>
              {sessions.map((session) => (
                <li key={session.id} className={styles.sessionRow}>
                  <div>
                    <strong>{describeDevice(session.userAgent)}</strong>
                    {session.current ? <span className={styles.currentTag}>{t("account.currentDevice")}</span> : null}
                    <span className={styles.sessionMeta}>
                      {session.ip?.replace(/^::ffff:/, "") ?? t("account.unknownIp")}{" · "}
                      {t("account.lastActive", { time: formatTime(session.lastSeenAt) })}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.secondary}
                    data-account-action="secondary"
                    onClick={() => void revokeSession(session)}
                    disabled={revokingId === session.id}
                  >
                    {revokingId === session.id ? t("account.revoking") : t("account.revoke")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {sessionsError ? (
            <p className={styles.error} role="alert">
              {sessionsError}
            </p>
          ) : null}
        </section>
      </div>
    </section>
  );
}
