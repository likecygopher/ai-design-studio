"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

function SsoTicketConsumer() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string>();
  const ticket = searchParams.get("ticket") ?? "";
  const requestedReturnTo = searchParams.get("returnTo") || "/studio-home";
  const returnTo =
    requestedReturnTo.startsWith("/") && !requestedReturnTo.startsWith("//")
      ? requestedReturnTo
      : "/studio-home";

  useEffect(() => {
    if (!ticket) {
      setError("缺少登录票据。");
      return;
    }
    let cancelled = false;
    void signIn("sso-ticket", { ticket, redirect: false })
      .then((result) => {
        if (cancelled) return;
        if (result?.error) {
          setError("SSO 登录失败，请重新发起登录。");
          return;
        }
        window.location.replace(returnTo);
      })
      .catch(() => {
        if (!cancelled) setError("SSO 登录失败，请重新发起登录。");
      });
    return () => {
      cancelled = true;
    };
  }, [ticket, returnTo]);

  return (
    <main style={{ display: "grid", gap: 12, padding: 48, placeItems: "center" }}>
      <p>{error ?? "正在完成企业登录…"}</p>
      {error ? <Link href="/login">返回登录</Link> : null}
    </main>
  );
}

export default function SsoLoginPage() {
  return (
    <Suspense fallback={<main style={{ padding: 48 }}>正在完成企业登录…</main>}>
      <SsoTicketConsumer />
    </Suspense>
  );
}
