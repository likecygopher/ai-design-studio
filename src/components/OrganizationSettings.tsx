"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Users } from "lucide-react";
import { apiFetch, formatApiError } from "@/src/lib/api-client";
import { useI18n } from "@/src/i18n/I18nProvider";
import styles from "./AdminPanels.module.css";

type Member = {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
};

type Overview = {
  organization: { id: string; name: string; slug: string } | null;
  role: string | null;
  members: Member[];
  organizations: Array<{ id: string; name: string; slug: string; role: string }>;
  personalOrganizationId: string;
  canDelete: boolean;
};

export function OrganizationSettings() {
  const { t } = useI18n();
  const router = useRouter();
  const [overview, setOverview] = useState<Overview>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setOverview(await apiFetch<Overview>("/api/account/organization"));
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const canManage = overview?.role === "owner" || overview?.role === "admin";

  async function archive() {
    if (!window.confirm(t("org.archiveConfirm"))) return;
    setBusy(true);
    setError(undefined);
    try {
      await apiFetch("/api/account/organization/archive", { method: "POST" });
      setNotice(t("org.archived"));
      await load();
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function removeOrganization() {
    if (!overview?.organization) return;
    const name = window.prompt(t("org.deleteConfirm"), "");
    if (!name?.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await apiFetch("/api/account/organization/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: name.trim() })
      });
      setNotice(t("org.deleted"));
      router.replace("/studio-home");
      router.refresh();
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function switchOrg(organizationId: string) {
    setBusy(true);
    setError(undefined);
    try {
      await apiFetch("/api/account/organization/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId })
      });
      await load();
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function rename() {
    if (!overview?.organization) return;
    const name = window.prompt(t("org.name"), overview.organization.name);
    if (!name?.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await apiFetch("/api/account/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() })
      });
      setNotice(t("org.saved"));
      await load();
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function addMember() {
    if (!email.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await apiFetch("/api/account/organization/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role })
      });
      setEmail("");
      setNotice(t("org.added"));
      await load();
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function updateRole(member: Member, nextRole: string) {
    setBusy(true);
    setError(undefined);
    try {
      await apiFetch(`/api/account/organization/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole })
      });
      await load();
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(t("org.confirmRemove"))) return;
    setBusy(true);
    setError(undefined);
    try {
      await apiFetch(`/api/account/organization/members/${member.id}`, {
        method: "DELETE"
      });
      await load();
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.page} aria-label={t("org.title")}>
      <header className={styles.header}>
        <div>
          <h1>{t("org.title")}</h1>
          <p className={styles.headerMeta}>{t("org.subtitle")}</p>
        </div>
        <button type="button" data-admin-action="secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={13} aria-hidden /> {t("common.refresh")}
        </button>
      </header>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {loading ? <p className={styles.loading}>{t("org.loading")}</p> : null}

      {overview ? (
        <>
          <section className={styles.card} style={{ display: "grid", gap: 10 }}>
            <div className={styles.actions} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <strong>{overview.organization?.name}</strong>
              <button type="button" data-admin-action="secondary" onClick={() => void rename()} disabled={busy || !canManage}>
                {t("org.rename")}
              </button>
              {canManage ? (
                <a className={styles.secondary} href="/account/organization/sso">
                  {t("ssoConfig.title")}
                </a>
              ) : null}
              {overview.canDelete ? (
                <>
                  <button
                    type="button"
                    data-admin-action="secondary"
                    onClick={() => void archive()}
                    disabled={busy}
                  >
                    {t("org.archive")}
                  </button>
                  <button
                    type="button"
                    data-admin-action="secondary"
                    onClick={() => void removeOrganization()}
                    disabled={busy}
                  >
                    {t("org.delete")}
                  </button>
                </>
              ) : null}
              {overview.organizations.length > 1 ? (
                <label>
                  {t("org.switch")}
                  <select
                    value={overview.organization?.id ?? ""}
                    onChange={(event) => void switchOrg(event.target.value)}
                    disabled={busy}
                  >
                    {overview.organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name} ({t(`org.role.${org.role}`)})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            {!canManage ? <p className={styles.hint}>{t("org.noPermission")}</p> : null}
          </section>

          <section className={styles.card} style={{ display: "grid", gap: 10 }}>
            <h2><Users size={15} aria-hidden /> {t("org.members")}</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table} aria-label={t("org.members")}>
                <thead>
                  <tr>
                    <th scope="col">{t("org.email")}</th>
                    <th scope="col">{t("org.role")}</th>
                    <th scope="col">{t("org.remove")}</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.members.map((member) => (
                    <tr key={member.id}>
                      <td>{member.name ? `${member.name} · ${member.email}` : member.email}</td>
                      <td>
                        <select
                          value={member.role}
                          disabled={busy || !canManage}
                          onChange={(event) => void updateRole(member, event.target.value)}
                        >
                          {["owner", "admin", "member"].map((value) => (
                            <option key={value} value={value}>
                              {t(`org.role.${value}`)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={styles.iconButton}
                          disabled={busy || !canManage}
                          onClick={() => void removeMember(member)}
                          aria-label={t("org.remove")}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {canManage ? (
              <div className={styles.actions} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
                <label>
                  {t("org.email")}
                  <input value={email} onChange={(event) => setEmail(event.target.value)} />
                </label>
                <label>
                  {t("org.role")}
                  <select value={role} onChange={(event) => setRole(event.target.value as "admin" | "member")}>
                    <option value="member">{t("org.role.member")}</option>
                    <option value="admin">{t("org.role.admin")}</option>
                  </select>
                </label>
                <button type="button" data-admin-action="primary" onClick={() => void addMember()} disabled={busy || !email.trim()}>
                  <Plus size={13} aria-hidden /> {t("org.addMember")}
                </button>
                <span className={styles.hint}>{t("org.existingOnly")}</span>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </section>
  );
}
