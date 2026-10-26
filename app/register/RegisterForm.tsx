"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiFetch, formatApiError } from "@/src/lib/api-client";
import { useI18n } from "@/src/i18n/I18nProvider";
import styles from "../login/login.module.css";
import { PASSWORD_RULE_HINT, validateEmail, validatePassword } from "./register-validation";

export type RegisterFormProps = {
  /** Where to land after successful registration + automatic sign-in. */
  callbackUrl?: string;
};

/**
 * Registration form (SPEC R8.1). Used by `/register` and embedded as the
 * register tab of the login page so both entry points share one behaviour:
 * client-side rules → POST /api/auth/register → automatic credentials sign-in
 * → redirect. Failures stay on the form and show `{ error, code, requestId }`.
 */
export function RegisterForm({ callbackUrl = "/studio-home" }: RegisterFormProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(undefined);

    const emailError = validateEmail(email);
    if (emailError) {
      setError(t(emailError));
      return;
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(t(passwordError));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.registerMismatch"));
      return;
    }

    setBusy(true);
    try {
      await apiFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          name: name.trim() || undefined
        })
      });

      const result = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false
      });
      if (result?.error) {
        throw new Error(t("auth.registerAutoLoginFailed"));
      }
      router.replace(callbackUrl);
      router.refresh();
    } catch (cause) {
      // Non-2xx errors from apiFetch already carry code/requestId.
      setError(formatApiError(cause, t("auth.registerFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
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
        {t("auth.nameOptional")}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="nickname"
          placeholder={t("auth.namePlaceholder")}
        />
      </label>
      <label>
        {t("auth.password")}
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      <p className={styles.ruleHint}>{t(PASSWORD_RULE_HINT)}</p>
      <label>
        {t("auth.confirmPassword")}
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
      <button className={styles.submit} disabled={busy} type="submit">
        {busy ? t("auth.registerBusy") : t("auth.registerSubmit")}
      </button>
      <p className={styles.footer}>
        {t("auth.haveAccount")} <Link href="/login">{t("auth.goLogin")}</Link>
      </p>
    </form>
  );
}
