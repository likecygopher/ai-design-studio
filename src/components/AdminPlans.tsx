"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { apiFetch, formatApiError } from "@/src/lib/api-client";
import { useI18n } from "@/src/i18n/I18nProvider";
import { StudioDialog } from "./StudioDialog";
import styles from "./AdminPanels.module.css";

type PlanView = {
  id: string;
  name: string;
  description: string | null;
  monthlyBudgetUnits: number | null;
  maxActiveJobs: number | null;
  usersCount: number;
};

type PlanFormValues = {
  name: string;
  description: string;
  monthlyBudgetUnits: string;
  maxActiveJobs: string;
};

export function AdminPlans() {
  const { t } = useI18n();
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; plan: PlanView } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const data = await apiFetch<{ plans?: PlanView[] }>("/api/admin/plans");
      setPlans(data.plans ?? []);
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(values: PlanFormValues) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const editing = dialog?.mode === "edit" ? dialog.plan : null;
      const payload = {
        name: values.name,
        description: values.description || null,
        monthlyBudgetUnits: values.monthlyBudgetUnits.trim()
          ? Number(values.monthlyBudgetUnits)
          : null,
        maxActiveJobs: values.maxActiveJobs.trim() ? Number(values.maxActiveJobs) : null
      };
      await apiFetch(editing ? `/api/admin/plans/${editing.id}` : "/api/admin/plans", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      setDialog(null);
      setNotice(editing ? t("admin.planUpdated") : t("admin.planCreated"));
      await load();
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  async function remove(plan: PlanView) {
    if (!window.confirm(t("admin.planDeleteConfirm", { name: plan.name }))) return;
    setBusy(true);
    setError(undefined);
    try {
      await apiFetch(`/api/admin/plans/${plan.id}`, { method: "DELETE" });
      setNotice(t("admin.planDeleted"));
      await load();
    } catch (cause) {
      setError(formatApiError(cause, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.page} aria-label={t("admin.plansTitle")}>
      <header className={styles.header}>
        <div>
          <h1>{t("admin.plansTitle")}</h1>
        </div>
        <div className={styles.actions}>
          <button type="button" data-admin-action="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={13} aria-hidden /> {t("common.refresh")}
          </button>
          <button
            type="button"
            data-admin-action="primary"
            onClick={() => {
              setNotice(undefined);
              setDialog({ mode: "create" });
            }}
          >
            <Plus size={13} aria-hidden /> {t("admin.newPlan")}
          </button>
        </div>
      </header>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {loading ? (
        <p className={styles.loading}>{t("admin.loadingPlans")}</p>
      ) : plans.length === 0 ? (
        <div className={styles.empty}><p>{t("admin.noPlans")}</p></div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label={t("admin.plansList")}>
            <thead>
              <tr>
                <th scope="col">{t("admin.plan")}</th>
                <th scope="col">{t("admin.planBudget")}</th>
                <th scope="col">{t("admin.planConcurrency")}</th>
                <th scope="col">{t("admin.planUsers")}</th>
                <th scope="col">{t("admin.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <div className={styles.providerName}>
                      <strong>{plan.name}</strong>
                      <span className={styles.channelText}>{plan.description || "—"}</span>
                    </div>
                  </td>
                  <td>
                    {plan.monthlyBudgetUnits === null
                      ? t("admin.planDefault")
                      : plan.monthlyBudgetUnits === 0
                        ? t("admin.planUnlimited")
                        : plan.monthlyBudgetUnits}
                  </td>
                  <td>{plan.maxActiveJobs === null ? t("admin.planDefault") : plan.maxActiveJobs}</td>
                  <td>{plan.usersCount}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={`${t("admin.editPlan")} ${plan.name}`}
                        title={t("admin.editPlan")}
                        onClick={() => setDialog({ mode: "edit", plan })}
                      >
                        <Pencil size={12} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={`${t("admin.deletePlan")} ${plan.name}`}
                        title={t("admin.deletePlan")}
                        disabled={busy || plan.usersCount > 0}
                        onClick={() => void remove(plan)}
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
          title={dialog.mode === "create" ? t("admin.newPlan") : t("admin.editPlan")}
          onClose={() => setDialog(null)}
          busy={busy}
        >
          <PlanForm
            plan={dialog.mode === "edit" ? dialog.plan : undefined}
            busy={busy}
            onSubmit={save}
            onCancel={() => setDialog(null)}
          />
        </StudioDialog>
      ) : null}
    </section>
  );
}

function PlanForm({
  plan,
  busy,
  onSubmit,
  onCancel
}: {
  plan?: PlanView;
  busy: boolean;
  onSubmit: (values: PlanFormValues) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [budget, setBudget] = useState(
    plan?.monthlyBudgetUnits === null || plan?.monthlyBudgetUnits === undefined
      ? ""
      : String(plan.monthlyBudgetUnits)
  );
  const [maxJobs, setMaxJobs] = useState(
    plan?.maxActiveJobs === null || plan?.maxActiveJobs === undefined
      ? ""
      : String(plan.maxActiveJobs)
  );
  const [error, setError] = useState<string>();

  return (
    <div className={styles.form}>
      <div className={styles.formGrid}>
        <label className={styles.formField}>
          {t("admin.planName")}
          <input aria-label={t("admin.planNameLabel")} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className={styles.formField}>
          {t("admin.planDescription")}
          <input
            aria-label={t("admin.planDescLabel")}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className={styles.formField}>
          {t("admin.planBudgetField")}
          <input
            aria-label={t("admin.planBudgetAria")}
            type="number"
            min={0}
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
          />
        </label>
        <label className={styles.formField}>
          {t("admin.planConcurrencyField")}
          <input
            aria-label={t("admin.planConcurrencyAria")}
            type="number"
            min={1}
            value={maxJobs}
            onChange={(event) => setMaxJobs(event.target.value)}
          />
        </label>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.dialogActions}>
        <button type="button" data-admin-action="secondary" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          data-admin-action="primary"
          disabled={busy}
          onClick={() => {
            if (!name.trim()) {
              setError(t("admin.planNameRequired"));
              return;
            }
            setError(undefined);
            onSubmit({ name, description, monthlyBudgetUnits: budget, maxActiveJobs: maxJobs });
          }}
        >
          {busy ? t("common.loading") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
