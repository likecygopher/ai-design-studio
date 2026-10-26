import { AuthShell } from "../login/AuthShell";
import { RegisterForm } from "./RegisterForm";

export const metadata = {
  title: "注册账号 · Midea AI Content Studio"
};

export default function RegisterPage() {
  return (
    <AuthShell>
      <h1>注册</h1>
      <RegisterForm />
    </AuthShell>
  );
}
