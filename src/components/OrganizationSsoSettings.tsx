"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, RefreshCw, Save } from "lucide-react";
import { apiFetch, formatApiError } from "@/src/lib/api-client";
import { useI18n } from "@/src/i18n/I18nProvider";
import styles from "./AdminPanels.module.css";

type Config = {
  organizationId: string;
  enabled: boolean;
  protocol: "oidc" | "saml";
  displayName: string | null;
  oidcIssuer: string | null;
  oidcClientId: string | null;
  hasOidcClientSecret: boolean;
  samlEntryPoint: string | null;
  samlIssuer: string | null;
  samlCert: string | null;
  allowedDomains: string[];
  autoProvision: boolean;
  defaultRole: string;
  groupRoleMap: Record<string, string>;
  scimEnabled: boolean;
  hasScimToken: boolean;
  scimTokenPrefix: string | null;
};

export function OrganizationSsoSettings() {
  const { t } = useI18n();
  const [config, setConfig] = useState<Config>();
  const [protocol, setProtocol] = useState<"oidc" | "saml">("oidc");
  const [enabled, setEnabled] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [oidcIssuer, setOidcIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [entryPoint, setEntryPoint] = useState("");
  const [idpIssuer, setIdpIssuer] = useState("");
  const [idpCert, setIdpCert] = useState("");
  const [domains, setDomains] = useState("");
  const [autoProvision, setAutoProvision] = useState(true);
  const [defaultRole, setDefaultRole] = useState("member");
  const [groupMap, setGroupMap] = useState("{}");
  const [scimEnabled, setScimEnabled] = useState(false);
  const [scimToken, setScimToken] = useState("");
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const data = await apiFetch<{ config: Config | null }>("/api/account/organization/sso");
      setConfig(data.config ?? undefined);
      if (data.config) {
        setEnabled(data.config.enabled);
        setProtocol(data.config.protocol);
        setDisplayName(data.config.displayName ?? "");
        setOidcIssuer(data.config.oidcIssuer ?? "");
        setClientId(data.config.oidcClientId ?? "");
        setEntryPoint(data.config.samlEntryPoint ?? "");
        setIdpIssuer(data.config.samlIssuer ?? "");
        setIdpCert(data.config.samlCert ?? "");
        setDomains(data.config.allowedDomains.join(", "));
        setAutoProvision(data.config.autoProvision);
        setDefaultRole(data.config.defaultRole);
        setGroupMap(JSON.stringify(data.config.groupRoleMap, null, 2));
        setScimEnabled(data.config.scimEnabled);
      }
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
  }, [load]);

  async function save() {
    let map: Record<string, string>;
    try {
      map = JSON.parse(groupMap || "{}") as Record<string, string>;
    } catch {
      setError(t("ssoConfig.invalidMap"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const data = await apiFetch<{ config: Config }>("/api/account/organization/sso", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          protocol,
          displayName: displayName || null,
          oidcIssuer: oidcIssuer || null,
          oidcClientId: clientId || null,
          oidcClientSecret: clientSecret || null,
          samlEntryPoint: entryPoint || null,
          samlIssuer: idpIssuer || null,
          samlCert: idpCert || null,
          allowedDomains: domains
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          autoProvision,
          defaultRole,
          groupRoleMap: map,
          scimEnabled
        })
      });
      setConfig(data.config);
      setClientSecret("");
      setNotice(t("ssoConfig.saved"));
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function generateScimToken() {
    setBusy(true);
    setError(undefined);
    try {
      const data = await apiFetch<{ token: string }>(
        "/api/account/organization/sso/scim-token",
        { method: "POST" }
      );
      setScimToken(data.token);
      setScimEnabled(true);
      await load();
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  const slug = config?.organizationId ?? "";
  return (
    <section className={styles.page} aria-label={t("ssoConfig.title")}>
      <header className={styles.header}>
        <div>
          <h1>{t("ssoConfig.title")}</h1>
          <p className={styles.headerMeta}>{t("ssoConfig.subtitle")}</p>
        </div>
        <div className={styles.actions}>
          <button type="button" data-admin-action="secondary" onClick={() => void load()} disabled={busy}>
            <RefreshCw size={13} aria-hidden /> {t("common.refresh")}
          </button>
          <button type="button" data-admin-action="primary" onClick={() => void save()} disabled={busy}>
            <Save size={13} aria-hidden /> {t("ssoConfig.save")}
          </button>
        </div>
      </header>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.form}>
        <div className={styles.formGrid}>
          <label className={styles.formField}>
            {t("ssoConfig.enabled")}
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          </label>
          <label className={styles.formField}>
            {t("ssoConfig.protocol")}
            <select value={protocol} onChange={(event) => setProtocol(event.target.value as "oidc" | "saml")}>
              <option value="oidc">OIDC</option>
              <option value="saml">SAML 2.0</option>
            </select>
          </label>
          <label className={styles.formField}>
            {t("ssoConfig.displayName")}
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label className={styles.formField}>
            {t("ssoConfig.domains")}
            <input value={domains} onChange={(event) => setDomains(event.target.value)} placeholder="acme.com, example.com" />
          </label>
        </div>

        {protocol === "oidc" ? (
          <div className={styles.formGrid}>
            <label className={styles.formField}>
              {t("ssoConfig.oidcIssuer")}
              <input value={oidcIssuer} onChange={(event) => setOidcIssuer(event.target.value)} placeholder="https://idp.example.com" />
            </label>
            <label className={styles.formField}>
              {t("ssoConfig.clientId")}
              <input value={clientId} onChange={(event) => setClientId(event.target.value)} />
            </label>
            <label className={styles.formField}>
              {t("ssoConfig.clientSecret")}
              <input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} />
            </label>
          </div>
        ) : (
          <div className={styles.formGrid}>
            <label className={styles.formField}>
              {t("ssoConfig.entryPoint")}
              <input value={entryPoint} onChange={(event) => setEntryPoint(event.target.value)} placeholder="https://idp.example.com/sso/saml" />
            </label>
            <label className={styles.formField}>
              {t("ssoConfig.idpIssuer")}
              <input value={idpIssuer} onChange={(event) => setIdpIssuer(event.target.value)} />
            </label>
            <label className={styles.formField}>
              {t("ssoConfig.idpCert")}
              <textarea value={idpCert} onChange={(event) => setIdpCert(event.target.value)} rows={4} />
            </label>
          </div>
        )}

        <div className={styles.formGrid}>
          <label className={styles.formField}>
            {t("ssoConfig.autoProvision")}
            <input type="checkbox" checked={autoProvision} onChange={(event) => setAutoProvision(event.target.checked)} />
          </label>
          <label className={styles.formField}>
            {t("ssoConfig.defaultRole")}
            <select value={defaultRole} onChange={(event) => setDefaultRole(event.target.value)}>
              <option value="member">{t("org.role.member")}</option>
              <option value="admin">{t("org.role.admin")}</option>
            </select>
          </label>
          <label className={styles.formField}>
            {t("ssoConfig.scim")}
            <input type="checkbox" checked={scimEnabled} onChange={(event) => setScimEnabled(event.target.checked)} />
          </label>
        </div>

        <label className={styles.formField}>
          {t("ssoConfig.groupMap")}
          <textarea value={groupMap} onChange={(event) => setGroupMap(event.target.value)} rows={5} />
        </label>
        <p className={styles.hint}>{t("ssoConfig.groupMapHint")}</p>

        <div className={styles.actions}>
          <button type="button" data-admin-action="secondary" onClick={() => void generateScimToken()} disabled={busy}>
            <KeyRound size={13} aria-hidden /> {t("ssoConfig.scimGenerate")}
          </button>
        </div>
        {scimToken ? (
          <div className={styles.notice} role="status">
            <strong>{t("ssoConfig.scimOnce")}</strong>
            <code>{scimToken}</code>
          </div>
        ) : null}
        <p className={styles.hint}>{t("ssoConfig.scimHint")}</p>

        {slug ? (
          <div className={styles.hint}>
            <p>{t("ssoConfig.redirectUri")}: {origin}/api/auth/sso/oidc/callback</p>
            <p>{t("ssoConfig.acs")}: {origin}/api/auth/sso/saml/callback</p>
            <p>
              {t("ssoConfig.metadata")}:{" "}
              <a href={`/api/auth/sso/saml/metadata?org=${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer">
                /api/auth/sso/saml/metadata?org={slug}
              </a>
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
