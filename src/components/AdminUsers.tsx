"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Copy, KeyRound, Pencil, Plus, RefreshCw, Search, ShieldCheck, UserRound } from "lucide-react";
import { apiFetch, formatApiError } from "@/src/lib/api-client";
import { useI18n } from "@/src/i18n/I18nProvider";
import { StudioDialog } from "./StudioDialog";
import styles from "./AdminUsers.module.css";

export type AdminUserRecord = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  disabled: boolean;
  monthlyBudgetUnits: number | null;
  requiresJobApproval: boolean;
  planId: string | null;
  planName: string | null;
  createdAt: string;
  updatedAt: string;
  counts?: { products: number; assets: number; jobs: number };
};

type RoleFilter = "all" | "user" | "admin";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; user: AdminUserRecord }
  | { kind: "password"; user: AdminUserRecord }
  | { kind: "secret"; title: string; email: string; password: string }
  | null;

export function roleLabel(role: string, translate: (key: string) => string = (key) => key): string {
  return translate(role === "admin" ? "管理员" : "普通用户");
}

export function accountStatusLabel(
  user: Pick<AdminUserRecord, "disabled">,
  translate: (key: string) => string = (key) => key
): string {
  return translate(user.disabled ? "已禁用" : "正常");
}

export function formatAccountDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatUsage(
  used: number,
  userBudget: number | null,
  defaultBudget: number | null,
  translate: (key: string) => string
): string {
  if (userBudget === 0) {
    return `${used} / ${translate("不限")}`;
  }
  const budget = userBudget ?? defaultBudget;
  if (budget === null || budget === undefined) {
    return `${used} / ${translate("不限")}`;
  }
  return `${used} / ${budget}${userBudget === null ? translate("（默认）") : ""}`;
}

function buildListUrl(query: string, role: RoleFilter, cursor?: string): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (role !== "all") params.set("role", role);
  params.set("limit", "20");
  if (cursor) params.set("cursor", cursor);
  return `/api/admin/users?${params.toString()}`;
}

export function AdminUsers({ currentUserId }: { currentUserId: string }) {
  const { t } = useI18n();
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [defaultBudgetUnits, setDefaultBudgetUnits] = useState<number | null>(null);
  const [plans, setPlans] = useState<Array<{ id: string; name: string }>>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      if (cursor) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(undefined);
      try {
        const data = await apiFetch<{
          users?: AdminUserRecord[];
          nextCursor?: string | null;
          usage?: Record<string, number>;
          defaultBudgetUnits?: number | null;
        }>(buildListUrl(query, roleFilter, cursor));
        const rows = data.users ?? [];
        setUsers((current) => (cursor ? [...current, ...rows] : rows));
        setNextCursor(data.nextCursor ?? null);
        setUsage(data.usage ?? {});
        setDefaultBudgetUnits(data.defaultBudgetUnits ?? null);
      } catch (cause) {
        setError(formatApiError(cause, t("读取用户列表失败，请稍后重试。")));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [query, roleFilter]
  );

  useEffect(() => {
    let mounted = true;
    void apiFetch<{ plans?: Array<{ id: string; name: string }> }>("/api/admin/plans")
      .then((data) => {
        if (mounted) setPlans(data.plans ?? []);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  // Debounce search/role changes; abort the follow-up load when they change again.
  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 250);
    return () => clearTimeout(timer);
  }, [load]);

  function openCreate() {
    setNotice(undefined);
    setDialog({ kind: "create" });
  }

  function openEdit(user: AdminUserRecord) {
    setNotice(undefined);
    setDialog({ kind: "edit", user });
  }

  function openPassword(user: AdminUserRecord) {
    setNotice(undefined);
    setDialog({ kind: "password", user });
  }

  async function submitCreate(values: {
    email: string;
    name: string;
    role: string;
    password: string;
  }) {
    setBusy(true);
    setError(undefined);
    try {
      const data = await apiFetch<{
        user: AdminUserRecord;
        temporaryPassword?: string;
      }>("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.email.trim(),
          name: values.name.trim() || undefined,
          role: values.role,
          ...(values.password ? { password: values.password } : {})
        })
      });

      if (data.temporaryPassword) {
        setDialog({
          kind: "secret",
          title: "用户已创建",
          email: data.user.email,
          password: data.temporaryPassword
        });
      } else {
        setDialog(null);
        setNotice(t("已创建用户 {email}。", { email: data.user.email }));
      }
      await load();
    } catch (cause) {
      setError(formatApiError(cause, t("创建用户失败，请稍后重试。")));
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit(values: {
    name: string;
    role: string;
    disabled: boolean;
    monthlyBudgetUnits: string;
    requiresJobApproval: boolean;
    planId: string;
  }) {
    if (!dialog || dialog.kind !== "edit") return;
    setBusy(true);
    setError(undefined);
    try {
      const target = dialog.user;
      await apiFetch(`/api/admin/users/${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim() ? values.name.trim() : null,
          role: values.role,
          disabled: values.disabled,
          monthlyBudgetUnits: values.monthlyBudgetUnits.trim()
            ? Number(values.monthlyBudgetUnits)
            : null,
          requiresJobApproval: values.requiresJobApproval,
          planId: values.planId || null
        })
      });
      setDialog(null);
      setNotice(t("已更新 {email} 的账户信息。", { email: target.email }));
      await load();
    } catch (cause) {
      setError(formatApiError(cause, t("更新用户失败，请稍后重试。")));
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(password: string) {
    if (!dialog || dialog.kind !== "password") return;
    setBusy(true);
    setError(undefined);
    try {
      const target = dialog.user;
      const data = await apiFetch<{
        user: AdminUserRecord;
        temporaryPassword?: string;
        reauthRequired?: boolean;
      }>(`/api/admin/users/${encodeURIComponent(target.id)}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(password ? { password } : {})
      });

      if (data.reauthRequired) {
        // The operator reset their own password; the current session is revoked.
        await signOut({ callbackUrl: "/login?expired=1" });
        return;
      }

      if (data.temporaryPassword) {
        setDialog({
          kind: "secret",
          title: t("密码已重置"),
          email: data.user.email,
          password: data.temporaryPassword
        });
      } else {
        setDialog(null);
        setNotice(
        t("已重置 {email} 的密码，该用户需要重新登录。", { email: data.user.email })
      );
      }
      await load();
    } catch (cause) {
      setError(formatApiError(cause, t("重置密码失败，请稍后重试。")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.page} aria-label={t("用户管理")}>
      <header className={styles.header}>
        <div>
          <h1>{t("用户管理")}</h1>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            data-admin-action="secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={14} aria-hidden />
            {t("common.refresh")}
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            data-admin-action="primary"
            onClick={openCreate}
          >
            <Plus size={14} aria-hidden />
            {t("新建用户")}
          </button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <label className={styles.searchField}>
          <Search size={14} aria-hidden />
          <input
            aria-label="搜索用户"
            placeholder="搜索邮箱或昵称"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className={styles.filterField}>
          <span className={styles.srOnly}>{t("角色")}</span>
          <select
            aria-label={t("角色筛选")}
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
          >
            <option value="all">{t("全部角色")}</option>
            <option value="user">{t("普通用户")}</option>
            <option value="admin">{t("管理员")}</option>
          </select>
        </label>
        <span className={styles.count}>{loading ? "加载中…" : `共 ${users.length} 位用户`}</span>
      </div>

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
        <p className={styles.loading}>{t("正在读取用户列表…")}</p>
      ) : users.length === 0 ? (
        <div className={styles.empty}>
          <UserRound size={18} aria-hidden />
          <p>{t("没有匹配的用户。调整搜索条件，或新建一个账号。")}</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label={t("用户列表")}>
            <thead>
              <tr>
                <th scope="col">{t("用户")}</th>
                <th scope="col">{t("角色")}</th>
                <th scope="col">{t("状态")}</th>
                <th scope="col">{t("资源")}</th>
                <th scope="col">{t("本月用量")}</th>
                <th scope="col">{t("创建时间")}</th>
                <th scope="col">{t("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.id === currentUserId;
                return (
                  <tr key={user.id} data-disabled={user.disabled || undefined}>
                    <td>
                      <div className={styles.userCell}>
                        <strong>{user.name || user.email.split("@")[0]}</strong>
                        <span>{user.email}</span>
                        {isSelf ? <em className={styles.selfTag}>当前账号</em> : null}
                      </div>
                    </td>
                    <td>
                      <span className={styles.roleBadge} data-role={user.role}>
                        {user.role === "admin" ? (
                          <ShieldCheck size={12} aria-hidden />
                        ) : (
                          <UserRound size={12} aria-hidden />
                        )}
                        {roleLabel(user.role, t)}
                      </span>
                    </td>
                    <td>
                      <span
                        className={styles.statusBadge}
                        data-status={user.disabled ? "disabled" : "active"}
                      >
                        {accountStatusLabel(user, t)}
                      </span>
                    </td>
                    <td className={styles.counts}>
                      {user.counts
                        ? `产品 ${user.counts.products} · 素材 ${user.counts.assets} · 任务 ${user.counts.jobs}`
                        : "—"}
                      {user.planName ? t(" · 套餐 {name}", { name: user.planName }) : ""}
                    </td>
                    <td>
                      {formatUsage(
                        usage[user.id] ?? 0,
                        user.monthlyBudgetUnits,
                        defaultBudgetUnits,
                        t
                      )}
                    </td>
                    <td className={styles.date}>{formatAccountDate(user.createdAt)}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.rowButton}
                          data-admin-action="row"
                          onClick={() => openEdit(user)}
                          aria-label={t("编辑用户 {email}", { email: user.email })}
                        >
                          <Pencil size={13} aria-hidden />
                          {t("编辑")}
                        </button>
                        <button
                          type="button"
                          className={styles.rowButton}
                          data-admin-action="row"
                          onClick={() => openPassword(user)}
                          aria-label={t("重置 {email} 的密码", { email: user.email })}
                        >
                          <KeyRound size={13} aria-hidden />
                          {t("改密")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor ? (
        <button
          type="button"
          className={styles.secondaryButton}
          data-admin-action="secondary"
          onClick={() => void load(nextCursor)}
          disabled={loadingMore}
        >
          {loadingMore ? t("加载中…") : t("加载更多")}
        </button>
      ) : null}

      {dialog?.kind === "create" ? (
        <StudioDialog title={t("新建用户")} onClose={() => setDialog(null)} busy={busy}>
          <CreateUserForm busy={busy} onSubmit={submitCreate} onCancel={() => setDialog(null)} />
        </StudioDialog>
      ) : null}

      {dialog?.kind === "edit" ? (
        <StudioDialog title={t("adminUsers.editUser")} onClose={() => setDialog(null)} busy={busy}>
          <EditUserForm
            user={dialog.user}
            plans={plans}
            isSelf={dialog.user.id === currentUserId}
            busy={busy}
            onSubmit={submitEdit}
            onCancel={() => setDialog(null)}
          />
        </StudioDialog>
      ) : null}

      {dialog?.kind === "password" ? (
        <StudioDialog title={t("adminUsers.resetPassword")} onClose={() => setDialog(null)} busy={busy}>
          <ResetPasswordForm
            user={dialog.user}
            busy={busy}
            onSubmit={submitPassword}
            onCancel={() => setDialog(null)}
          />
        </StudioDialog>
      ) : null}

      {dialog?.kind === "secret" ? (
        <StudioDialog title={dialog.title} onClose={() => setDialog(null)}>
          <SecretPasswordPanel
            email={dialog.email}
            password={dialog.password}
            onClose={() => setDialog(null)}
          />
        </StudioDialog>
      ) : null}
    </section>
  );
}

/* ------------------------------ dialogs ------------------------------ */

function CreateUserForm({
  busy,
  onSubmit,
  onCancel
}: {
  busy: boolean;
  onSubmit: (values: { email: string; name: string; role: string; password: string }) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("user");
  const [password, setPassword] = useState("");
  const { t } = useI18n();

  return (
    <form
      className={styles.dialogForm}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ email, name, role, password });
      }}
    >
      <label>
        {t("邮箱")}
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@midea.com"
          required
        />
      </label>
      <label>
        {t("昵称")}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("用于任务记录展示（可选）")}
        />
      </label>
      <label>
        {t("角色")}
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="user">{t("普通用户")}</option>
          <option value="admin">{t("管理员")}</option>
        </select>
      </label>
      <label>
        初始密码
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          placeholder="留空则自动生成一次性密码"
        />
      </label>
      <p className={styles.dialogHint}>{t("8 位以上，含字母与数字；留空自动生成。")}</p>
      <div className={styles.dialogActions}>
        <button type="button" className={styles.secondaryButton} onClick={onCancel} disabled={busy}>
          {t("取消")}
        </button>
        <button type="submit" className={styles.primaryButton} disabled={busy}>
          {busy ? t("创建中…") : t("adminUsers.createUser")}
        </button>
      </div>
    </form>
  );
}

function EditUserForm({
  user,
  plans,
  isSelf,
  busy,
  onSubmit,
  onCancel
}: {
  user: AdminUserRecord;
  plans: Array<{ id: string; name: string }>;
  isSelf: boolean;
  busy: boolean;
  onSubmit: (values: {
    name: string;
    role: string;
    disabled: boolean;
    monthlyBudgetUnits: string;
    requiresJobApproval: boolean;
    planId: string;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(user.name ?? "");
  const [role, setRole] = useState(user.role);
  const [disabled, setDisabled] = useState(user.disabled);
  const [budget, setBudget] = useState(
    user.monthlyBudgetUnits === null ? "" : String(user.monthlyBudgetUnits)
  );
  const [requiresJobApproval, setRequiresJobApproval] = useState(
    Boolean(user.requiresJobApproval)
  );
  const [planId, setPlanId] = useState(user.planId ?? "");
  const { t } = useI18n();

  return (
    <form
      className={styles.dialogForm}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          name,
          role,
          disabled,
          monthlyBudgetUnits: budget,
          requiresJobApproval,
          planId
        });
      }}
    >
      <p className={styles.dialogTarget}>{user.email}</p>
      <label>
        {t("昵称")}
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        {t("角色")}
        <select
          value={role}
          onChange={(event) => setRole(event.target.value)}
          disabled={isSelf}
        >
          <option value="user">{t("普通用户")}</option>
          <option value="admin">{t("管理员")}</option>
        </select>
      </label>
      <label>
        {t("月度 AI 预算（单位）")}
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={budget}
          onChange={(event) => setBudget(event.target.value)}
          placeholder={t("留空使用平台默认，0 表示不限制")}
        />
      </label>
      <p className={styles.dialogHint}>
        {t("按本月已记录的成本单位累计；用尽后新任务会被拦截。")}
      </p>
      <label>
        {t("套餐")}
        <select value={planId} onChange={(event) => setPlanId(event.target.value)}>
          <option value="">{t("无套餐（使用平台默认）")}</option>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.checkboxField}>
        <input
          type="checkbox"
          checked={requiresJobApproval}
          onChange={(event) => setRequiresJobApproval(event.target.checked)}
        />
        {t("该用户的新任务需要管理员审批")}
      </label>
      <label className={styles.checkboxField}>
        <input
          type="checkbox"
          checked={disabled}
          onChange={(event) => setDisabled(event.target.checked)}
          disabled={isSelf}
        />
        {t("禁用该账户（禁止登录并使现有会话失效）")}
      </label>
      {isSelf ? (
        <p className={styles.dialogHint}>{t("不能禁用或降级当前登录的管理员账号。")}</p>
      ) : null}
      <div className={styles.dialogActions}>
        <button type="button" className={styles.secondaryButton} onClick={onCancel} disabled={busy}>
          {t("取消")}
        </button>
        <button type="submit" className={styles.primaryButton} disabled={busy}>
          {busy ? "保存中…" : "保存修改"}
        </button>
      </div>
    </form>
  );
}

function ResetPasswordForm({
  user,
  busy,
  onSubmit,
  onCancel
}: {
  user: AdminUserRecord;
  busy: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const { t } = useI18n();

  return (
    <form
      className={styles.dialogForm}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(password);
      }}
    >
      <p className={styles.dialogTarget}>{user.email}</p>
      <label>
        新密码
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          placeholder="留空则自动生成一次性密码"
        />
      </label>
      <p className={styles.dialogHint}>
        {t("重置后该用户需重新登录；8 位以上，含字母与数字。")}
      </p>
      <div className={styles.dialogActions}>
        <button type="button" className={styles.secondaryButton} onClick={onCancel} disabled={busy}>
          {t("取消")}
        </button>
        <button type="submit" className={styles.primaryButton} disabled={busy}>
          {busy ? "重置中…" : "重置密码"}
        </button>
      </div>
    </form>
  );
}

function SecretPasswordPanel({
  email,
  password,
  onClose
}: {
  email: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={styles.secretPanel}>
      <p className={styles.dialogHint}>
        {t("请把下面的一次性密码安全地交给")} <strong>{email}</strong>
        {t("，该密码仅显示这一次。")}
      </p>
      <div className={styles.secretRow}>
        <code aria-label={t("一次性密码")}>{password}</code>
        <button type="button" className={styles.secondaryButton} onClick={() => void copy()}>
          <Copy size={13} aria-hidden />
          {copied ? t("已复制") : t("复制密码")}
        </button>
      </div>
      <div className={styles.dialogActions}>
        <button type="button" className={styles.primaryButton} onClick={onClose}>
          {t("我已保存")}
        </button>
      </div>
    </div>
  );
}
