import { redirect } from "next/navigation";
import { AppShell } from "@/src/components/AppShell";
import { getSessionUser } from "@/src/platform/auth";
import { prisma } from "@/src/platform/db";
import { getBudgetSnapshot } from "@/src/platform/quotas";
import { translate, type Locale } from "@/src/i18n/core";
import { getLocale } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

type AggregateRow = { key: string; units: number; count: number };

function aggregate(rows: Array<{ estimatedUnits: number }>, pick: (row: { estimatedUnits: number; [key: string]: unknown }) => string | null | undefined): AggregateRow[] {
  const map = new Map<string, AggregateRow>();
  for (const row of rows) {
    const key = pick(row as { estimatedUnits: number; [key: string]: unknown });
    const label = key && key.trim() ? key : "__unlabeled__";
    const current = map.get(label) ?? { key: label, units: 0, count: 0 };
    current.units += row.estimatedUnits;
    current.count += 1;
    map.set(label, current);
  }
  return [...map.values()].toSorted((left, right) => right.units - left.units);
}

export default async function CostsPage() {
  const locale = await getLocale();
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(locale, key, params);
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  const [records, budget] = await Promise.all([
    prisma.costRecord.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 200
    }),
    getBudgetSnapshot(user.id)
  ]);

  const costRows = records.filter(
    (row) => !row.isFallback && !/mock|fallback/i.test(row.mode)
  );
  const byTask = aggregate(costRows, (row) => String(row.task));
  const byCountry = aggregate(costRows, (row) => String(row.country));
  const byLanguage = aggregate(costRows, (row) => String(row.language));
  const byMode = aggregate(costRows, (row) => String(row.mode));

  const budgetLabel =
    budget.budgetUnits === null
      ? t("costs.unlimited")
      : t("costs.units", { units: budget.budgetUnits });
  const budgetWidth = budget.percent === null ? 0 : Math.min(100, budget.percent);

  return (
    <AppShell>
      <h1 style={{ fontSize: 30, marginBottom: 18 }}>{t("costs.title")}</h1>

      <section
        aria-label={t("costs.budget")}
        style={{
          background: "var(--studio-glass-card, #ffffff)",
          border: "1px solid #d9e0e7",
          borderRadius: 8,
          padding: 16,
          marginBottom: 18
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
          <strong style={{ color: "var(--accent-strong)", fontSize: 13 }}>{t("costs.budget")}</strong>
          <span style={{ color: budget.exceeded ? "#7b2f2f" : "var(--muted)", fontSize: 12 }}>
            {budget.usedUnits} / {budgetLabel}
            {budget.exceeded
              ? ` · ${t("costs.exhausted")}`
              : budget.percent !== null
                ? ` · ${t("costs.usedPercent", { percent: budget.percent })}`
                : ""}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Budget usage"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={budgetWidth}
          style={{ height: 8, borderRadius: 999, background: "rgba(56,81,111,0.14)", overflow: "hidden" }}
        >
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${budgetWidth}%`,
              borderRadius: 999,
              background: budget.exceeded
                ? "#b06a6a"
                : budget.percent !== null && budget.percent >= 80
                  ? "#b8914b"
                  : "#4f6f8f"
            }}
          />
        </div>
      </section>

      <section
        aria-label="Usage summary"
        style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: 18 }}
      >
        <AggregateCard title={t("costs.byTask")} rows={byTask} locale={locale} />
        <AggregateCard title={t("costs.byCountry")} rows={byCountry} locale={locale} />
        <AggregateCard title={t("costs.byLanguage")} rows={byLanguage} locale={locale} />
        <AggregateCard title={t("costs.byMode")} rows={byMode} locale={locale} />
      </section>

      <h2 style={{ fontSize: 18, margin: "0 0 10px" }}>{t("costs.detail")}</h2>
      <table style={{ background: "var(--studio-glass-card, #ffffff)", borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {[
              t("costs.task"),
              t("costs.model"),
              t("costs.mode"),
              t("costs.country"),
              t("costs.language"),
              t("costs.unit"),
              t("costs.assets"),
              t("costs.time")
            ].map((head) => (
              <th key={head} style={{ border: "1px solid #d9e0e7", padding: 12, textAlign: "left" }}>{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {costRows.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ border: "1px solid #d9e0e7", padding: 12, color: "var(--muted)", textAlign: "center" }}>
                {t("costs.empty")}
              </td>
            </tr>
          ) : null}
          {costRows.map((row) => (
            <tr key={row.id}>
              <td style={cellStyle}>{row.task}</td>
              <td style={cellStyle}>{row.model}</td>
              <td style={cellStyle}>{row.mode}</td>
              <td style={cellStyle}>{row.country || "—"}</td>
              <td style={cellStyle}>{row.language || "—"}</td>
              <td style={cellStyle}>{row.estimatedUnits}</td>
              <td style={{ ...cellStyle, color: "var(--muted)" }}>
                {Array.isArray(row.sourceAssetIds) ? (row.sourceAssetIds as string[]).join(", ") || "—" : "—"}
              </td>
              <td style={{ ...cellStyle, color: "var(--muted)" }}>
                {row.createdAt.toISOString().replace("T", " ").slice(0, 19)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </AppShell>
  );
}

const cellStyle: React.CSSProperties = { border: "1px solid #d9e0e7", padding: 12 };

function AggregateCard({
  title,
  rows,
  locale
}: {
  title: string;
  rows: AggregateRow[];
  locale: Locale;
}) {
  return (
    <article style={{ background: "var(--studio-glass-card, #ffffff)", border: "1px solid #d9e0e7", borderRadius: 8, padding: 16 }}>
      <strong style={{ color: "var(--accent-strong)", display: "block", fontSize: 13, marginBottom: 10 }}>{title}</strong>
      <div style={{ display: "grid", gap: 6 }}>
        {rows.length === 0 ? (
          <span style={{ color: "var(--muted)" }}>{translate(locale, "costs.noData")}</span>
        ) : null}
        {rows.map((row) => (
          <div key={row.key} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ color: "#17202a" }}>
              {row.key === "__unlabeled__" ? translate(locale, "costs.uncategorized") : row.key}
            </span>
            <span style={{ color: "var(--muted)" }}>
              {translate(locale, "costs.summary", { units: row.units, count: row.count })}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}
