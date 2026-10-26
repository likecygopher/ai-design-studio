"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Play, RefreshCcw } from "lucide-react";
import {
  getCompetitionTaskSpec,
  type CompetitionTaskId
} from "@/src/domain/competition-tasks";
import type { ProductWithProfile } from "@/src/domain/types";
import { DEFAULT_IMAGE_MODEL_CHOICE, type ImageModelChoice } from "@/src/domain/generation-models";
import { useI18n } from "@/src/i18n/I18nProvider";
import { ImageModelSelector } from "./ImageModelSelector";
import { mapWithConcurrency } from "@/src/lib/concurrency";
import type { CompetitionOutputArtifact } from "@/src/services/competition-runner";

const CLIENT_CONCURRENCY = 4;

type RunState = {
  state: "idle" | "running" | "done" | "failed";
  completed: number;
  outputs: CompetitionOutputArtifact[];
  error?: string;
};

/** One generation capability as a standalone page: pick a product, generate, watch progress. */
export function CapabilityRunner({ taskId }: { taskId: CompetitionTaskId }) {
  const { t } = useI18n();
  const task = getCompetitionTaskSpec(taskId);
  const [products, setProducts] = useState<ProductWithProfile[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [productId, setProductId] = useState("");
  const [imageModel, setImageModel] = useState<ImageModelChoice>(DEFAULT_IMAGE_MODEL_CHOICE);
  const [run, setRun] = useState<RunState>({ state: "idle", completed: 0, outputs: [] });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/products")
      .then((response) => (response.ok ? response.json() : { products: [] }))
      .then((payload) => {
        if (cancelled || !Array.isArray(payload.products)) {
          return;
        }
        setProducts(payload.products);
        setProductsLoaded(true);
        if (payload.products[0]) {
          setProductId((current) => current || payload.products[0].id);
        }
      })
      .catch(() => setProductsLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const total = task.outputs.length;
  const progressPercent = total ? Math.round((run.completed / total) * 100) : 0;

  async function generate() {
    if (!productId) {
      return;
    }
    setRun({ state: "running", completed: 0, outputs: [] });
    const errors: string[] = [];

    await mapWithConcurrency(task.outputs, CLIENT_CONCURRENCY, async (spec) => {
      try {
        const response = await fetch("/api/competition/run-output", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, outputId: spec.id, productId, imageModel })
        });
        const payload = await response.json();
        if (!response.ok || payload.error) {
          throw new Error(payload.error ?? `Request failed with ${response.status}`);
        }
        setRun((current) => {
          const outputs = [...current.outputs, payload.output as CompetitionOutputArtifact];
          const order = task.outputs.map((item) => item.id);
          outputs.sort((a, b) => order.indexOf(a.spec.id) - order.indexOf(b.spec.id));
          return { ...current, completed: current.completed + 1, outputs };
        });
      } catch (error) {
        errors.push(
          `${spec.label}: ${error instanceof Error ? error.message : t("失败")}`
        );
        setRun((current) => ({ ...current, completed: current.completed + 1 }));
      }
    });

    setRun((current) => ({
      ...current,
      state: errors.length ? "failed" : "done",
      error: errors.length ? errors.join("; ") : undefined
    }));
  }

  if (productsLoaded && products.length === 0) {
    return (
      <section style={panelStyle}>
        <p style={{ margin: 0 }}>
          {t("还没有产品。请先到")}{" "}
          <a href="/assets" style={{ color: "var(--accent-strong)" }}>
            {t("素材库")}
          </a>{" "}
          {t("创建产品并上传素材,再回到本页生成。")}
        </p>
      </section>
    );
  }

  const selectedProduct = products.find((product) => product.id === productId);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section style={{ ...panelStyle, alignItems: "center", display: "flex", gap: 16, justifyContent: "space-between" }}>
        <div>
          <p style={{ color: "#17202a", margin: "0 0 6px" }}>{task.requirement}</p>
          <p style={{ color: "var(--muted)", margin: 0 }}>{task.summary}</p>
        </div>
        <div style={{ display: "grid", gap: 8, minWidth: 280 }}>
          <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
            {t("目标产品")}
            <select value={productId} onChange={(event) => setProductId(event.target.value)}>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.displayName ?? product.id}
                </option>
              ))}
            </select>
          </label>
          <ImageModelSelector
            disabled={run.state === "running"}
            onChange={setImageModel}
            value={imageModel}
          />
          {selectedProduct ? (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              {t("素材 {count} 项 · 卖点 {features} 条", {
                count: selectedProduct.assets.length,
                features: selectedProduct.profile.detectedFeatures.length
              })}
            </span>
          ) : null}
          <button
            data-generate-action="true"
            disabled={run.state === "running" || !productId}
            onClick={generate}
            style={primaryButtonStyle}
            type="button"
          >
            {run.state === "running" ? (
              <Loader2 aria-hidden size={16} />
            ) : run.state === "done" ? (
              <RefreshCcw aria-hidden size={16} />
            ) : (
              <Play aria-hidden size={16} />
            )}
            {run.state === "running"
              ? t("生成中…")
              : run.state === "done"
                ? t("重新生成")
                : t("开始生成")}
          </button>
        </div>
      </section>

      {run.state === "running" ? (
        <section aria-label="生成进度" style={panelStyle}>
          <div style={{ color: "var(--accent-strong)", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
            {t("并行生成中 {completed}/{total}", { completed: run.completed, total })}
          </div>
          <div style={{ background: "#e5e8ec", borderRadius: 999, height: 8, overflow: "hidden" }}>
            <div
              style={{
                background: "var(--accent-strong)",
                borderRadius: 999,
                height: "100%",
                transition: "width 0.3s",
                width: `${progressPercent}%`
              }}
            />
          </div>
        </section>
      ) : null}

      {run.error ? (
        <section style={{ ...panelStyle, background: "#fdecec", color: "#8f1f1f" }}>
          {t("部分输出失败:")}
          {run.error}
        </section>
      ) : null}

      {run.outputs.length ? (
        <div style={{ display: "grid", gap: 10 }}>
          {run.outputs.map((output) => (
            <OutputCard key={output.id} output={output} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OutputCard({ output }: { output: CompetitionOutputArtifact }) {
  const previewable = /\.(svg|png|jpe?g|webp)$/i.test(output.url);

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e5e8ec",
        borderRadius: 8,
        display: "grid",
        gap: 12,
        gridTemplateColumns: previewable ? "200px minmax(0, 1fr)" : "1fr",
        padding: 12
      }}
    >
      {previewable ? (
        <div style={{ background: "#f6f7f9", border: "1px solid #e5e8ec", minHeight: 120, overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={output.spec.label} src={output.url} style={{ display: "block", width: "100%" }} />
        </div>
      ) : null}
      <div>
        <div style={{ alignItems: "center", display: "flex", gap: 8, marginBottom: 6 }}>
          <CheckCircle2 aria-hidden color="#0049bb" size={16} />
          <strong>{output.spec.label}</strong>
          <span style={modelPillStyle}>{output.provenance.model}</span>
        </div>
        <p style={{ color: "var(--muted)", margin: "0 0 8px" }}>
          {output.label.productName} / {output.label.country} / {output.label.language}
        </p>
        <a href={output.url} style={linkStyle} target="_blank">
          <ExternalLink aria-hidden size={14} />
          {output.url}
        </a>
      </div>
    </div>
  );
}

const panelStyle = {
  background: "#ffffff",
  border: "1px solid #d9e0e7",
  borderRadius: 8,
  padding: 18
} as const;

const primaryButtonStyle = {
  alignItems: "center",
  background: "var(--accent-strong)",
  border: "1px solid var(--accent-strong)",
  borderRadius: 8,
  color: "#ffffff",
  cursor: "pointer",
  display: "inline-flex",
  fontWeight: 800,
  gap: 8,
  justifyContent: "center",
  padding: "10px 12px"
} as const;

const modelPillStyle = {
  background: "#edf5ff",
  border: "1px solid #b9d7ff",
  borderRadius: 999,
  color: "#0049bb",
  fontSize: 12,
  padding: "3px 8px"
} as const;

const linkStyle = {
  alignItems: "center",
  color: "var(--accent-strong)",
  display: "inline-flex",
  gap: 6,
  overflowWrap: "anywhere" as const
} as const;
