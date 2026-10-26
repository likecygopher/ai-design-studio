import { Suspense } from "react";
import { LoginForm } from "./LoginForm";
import { getSsoPublicInfo } from "@/src/platform/sso";
import { listPublicSsoProviders } from "@/src/platform/organization-sso";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  return (
    <Suspense fallback={<main style={{ padding: 40 }}>加载登录页...</main>}>
      <LoginForm
        sso={getSsoPublicInfo()}
        ssoProviders={await listPublicSsoProviders()}
      />
    </Suspense>
  );
}
