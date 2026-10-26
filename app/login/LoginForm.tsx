"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { LocaleSwitcher } from "@/src/components/LocaleSwitcher";
import { useI18n } from "@/src/i18n/I18nProvider";
import { RegisterForm } from "../register/RegisterForm";
import { AuthShell } from "./AuthShell";
import styles from "./login.module.css";

const DEMO_EMAIL = "demo@midea.local";
const DEMO_PASSWORD = "demo1234";

export function LoginForm({
  sso,
  ssoProviders = []
}: {
  sso?: { enabled: boolean; name: string };
  ssoProviders?: Array<{ slug: string; name: string; protocol: string }>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = useMemo(
    () => searchParams.get("callbackUrl") || "/studio-home",
    [searchParams]
  );
  const expired = searchParams.get("expired") === "1";
  // Demo credentials are only pre-filled for local development; production and
  // tests must start from an empty form (SPEC R8.1).
  const isDevelopment = process.env.NODE_ENV === "development";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState(isDevelopment ? DEMO_EMAIL : "");
  const [password, setPassword] = useState(isDevelopment ? DEMO_PASSWORD : "");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(undefined);

    if (!email.trim() || !password) {
      setError(t("auth.missingFields"));
      return;
    }

    setBusy(true);
    try {
      const result = await signIn("credentials", {
        email: email.trim(),
        password,
        ...(totp.trim() ? { totp: totp.trim() } : {}),
        redirect: false
      });
      if (result?.error) {
        throw new Error(t("auth.invalidCredentials"));
      }
      router.replace(callbackUrl);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1>{mode === "login" ? t("auth.login") : t("auth.register")}</h1>
      <div className={styles.localeRow}>
        <LocaleSwitcher />
      </div>
      {expired ? (
        <p className={styles.notice} role="status">
          {t("auth.expired")}
        </p>
      ) : null}
      <div className={styles.tabs}>
        <button
          type="button"
          className={mode === "login" ? styles.tabActive : styles.tab}
          aria-pressed={mode === "login"}
          onClick={() => {
            setMode("login");
            setError(undefined);
          }}
        >
          {t("auth.login")}
        </button>
        <button
          type="button"
          className={mode === "register" ? styles.tabActive : styles.tab}
          aria-pressed={mode === "register"}
          onClick={() => {
            setMode("register");
            setError(undefined);
          }}
        >
          {t("auth.register")}
        </button>
      </div>
      {mode === "login" ? (
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <label>
            {t("auth.email")}
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@midea.com"
              required
            />
          </label>
          <label>
            {t("auth.password")}
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <label>
            {t("auth.totp")}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totp}
              onChange={(event) => setTotp(event.target.value)}
              placeholder={t("auth.totpPlaceholder")}
            />
          </label>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <button className={styles.submit} disabled={busy} type="submit">
            {busy ? t("auth.busy") : t("auth.submit")}
          </button>
          {sso?.enabled ? (
            <>
              <p className={styles.footer}>{t("auth.ssoOr")}</p>
              <button
                className={styles.secondary ?? styles.submit}
                type="button"
                onClick={() => void signIn("enterprise-sso", { callbackUrl })}
              >
                {t("auth.ssoLogin")} · {sso.name}
              </button>
            </>
          ) : null}
          {ssoProviders.length ? (
            <>
              <p className={styles.footer}>{t("auth.orgSsoOr")}</p>
              <div style={{ display: "grid", gap: 8 }}>
                {ssoProviders.map((provider) => (
                  <a
                    key={provider.slug}
                    className={styles.secondary ?? styles.submit}
                    href={`/api/auth/sso/start?org=${encodeURIComponent(provider.slug)}&returnTo=${encodeURIComponent(callbackUrl)}`}
                  >
                    {provider.name} · {provider.protocol.toUpperCase()}
                  </a>
                ))}
              </div>
            </>
          ) : null}
          <p className={styles.footer}>
            {t("auth.noAccount")} <Link href="/register">{t("auth.createAccount")}</Link>
          </p>
        </form>
      ) : (
        <RegisterForm callbackUrl={callbackUrl} />
      )}
    </AuthShell>
  );
}
