"use client";

import { useEffect, useState } from "react";
import type { ProductWithProfile, SellingPoint } from "@/src/domain/types";
import { useI18n } from "@/src/i18n/I18nProvider";

type EditablePoint = SellingPoint & { enabled?: boolean };

export function ProductProfilePanel() {
  const { t } = useI18n();
  const [products, setProducts] = useState<ProductWithProfile[]>([]);
  const [productId, setProductId] = useState("");
  const [points, setPoints] = useState<EditablePoint[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/products")
      .then((response) => (response.ok ? response.json() : { products: [] }))
      .then((payload) => {
        if (cancelled || !Array.isArray(payload.products)) {
          return;
        }
        setProducts(payload.products);
        const first = payload.products[0];
        if (first) {
          setProductId((current) => current || first.id);
          setPoints(first.profile.detectedFeatures);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function switchProduct(nextId: string) {
    const product = products.find((item) => item.id === nextId);
    setProductId(nextId);
    setPoints(product?.profile.detectedFeatures ?? []);
    setStatus("");
    setError("");
  }

  function updatePoint(index: number, patch: Partial<EditablePoint>) {
    setPoints((current) =>
      current.map((point, itemIndex) => (itemIndex === index ? { ...point, ...patch } : point))
    );
  }

  function addPoint() {
    setPoints((current) => [
      ...current,
      {
        id: `feature-manual-${Date.now()}`,
        title: "",
        shortLabel: "",
        benefit: "",
        priority: current.length + 1,
        enabled: true
      }
    ]);
  }

  function removePoint(index: number) {
    setPoints((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function recognize() {
    setStatus(t("识别中…"));
    setError("");
    try {
      const response = await fetch("/api/products/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId })
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? t("识别失败"));
      }
      setPoints(payload.product.profile.detectedFeatures);
      const modelNote =
        payload.model && payload.model !== "rule-parser" ? `, ${payload.model}` : "";
      setStatus(
        t("已从 {source} 识别 {count} 条卖点{model}", {
          source: payload.recognizedFrom ?? t("产品信息文档"),
          count: payload.product.profile.detectedFeatures.length,
          model: modelNote
        })
      );
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : t("识别失败"));
    }
  }

  async function save() {
    setStatus(t("保存中…"));
    setError("");
    try {
      const response = await fetch("/api/products/selling-points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          sellingPoints: points
            .filter((point) => point.title.trim() || point.shortLabel.trim())
            .map((point, index) => ({ ...point, priority: index + 1 }))
        })
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? t("保存失败"));
      }
      setPoints(payload.product.profile.detectedFeatures);
      setStatus(t("卖点已保存,后续 PDP 与生成提示词将使用最新档案。"));
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : t("保存失败"));
    }
  }

  const product = products.find((item) => item.id === productId);

  return (
    <section style={{ background: "var(--studio-glass-card, #ffffff)", border: "1px solid #d9e0e7", borderRadius: 8, padding: 18 }}>
      <div style={{ alignItems: "end", display: "grid", gap: 12, gridTemplateColumns: "minmax(240px, 320px) 1fr auto auto", marginBottom: 14 }}>
        <label style={{ display: "grid", gap: 6 }}>
          {t("产品")}
          <select value={productId} onChange={(event) => switchProduct(event.target.value)}>
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName ?? item.id}
              </option>
            ))}
          </select>
        </label>
        <span style={{ color: "var(--muted)" }}>
          {product ? `品类:${product.category ?? "未填写"} · 素材 ${product.assets.length} 项` : ""}
        </span>
        <button onClick={recognize} style={secondaryButtonStyle} type="button">
          从产品信息识别卖点
        </button>
        <button onClick={save} style={primaryButtonStyle} type="button">
          保存卖点
        </button>
      </div>

      {status ? <p style={{ color: "#0049bb", margin: "0 0 10px" }}>{status}</p> : null}
      {error ? <p style={{ color: "#8f1f1f", margin: "0 0 10px" }}>{error}</p> : null}

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ color: "var(--muted)", display: "grid", fontSize: 12, fontWeight: 700, gap: 10, gridTemplateColumns: "2fr 1.5fr 2.5fr 2fr auto", padding: "0 4px" }}>
          <span>卖点标题</span>
          <span>短标签(黑条)</span>
          <span>卖点说明(灰条)</span>
          <span>技术佐证</span>
          <span />
        </div>
        {points.map((point, index) => (
          <div
            data-testid="profile-point-row"
            key={point.id}
            style={{ alignItems: "center", border: "1px solid #e5e8ec", borderRadius: 8, display: "grid", gap: 10, gridTemplateColumns: "2fr 1.5fr 2.5fr 2fr auto", padding: 8 }}
          >
            <input
              aria-label={`卖点标题 ${index + 1}`}
              value={point.title}
              onChange={(event) => updatePoint(index, { title: event.target.value })}
            />
            <input
              aria-label={`短标签 ${index + 1}`}
              value={point.shortLabel}
              onChange={(event) => updatePoint(index, { shortLabel: event.target.value })}
            />
            <input
              aria-label={`卖点说明 ${index + 1}`}
              value={point.benefit}
              onChange={(event) => updatePoint(index, { benefit: event.target.value })}
            />
            <input
              aria-label={`技术佐证 ${index + 1}`}
              value={point.technicalProof ?? ""}
              onChange={(event) => updatePoint(index, { technicalProof: event.target.value })}
            />
            <button
              aria-label={`删除卖点 ${index + 1}`}
              onClick={() => removePoint(index)}
              style={dangerButtonStyle}
              type="button"
            >
              删除
            </button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <button onClick={addPoint} style={secondaryButtonStyle} type="button">
          新增卖点
        </button>
      </div>

      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 14 }}>
        支持 PDF / TXT / JSON，识别结果可手工修正。
      </p>
    </section>
  );
}

const primaryButtonStyle = {
  background: "var(--accent-strong)",
  border: "1px solid var(--accent-strong)",
  borderRadius: 8,
  color: "#ffffff",
  cursor: "pointer",
  fontWeight: 800,
  padding: "10px 14px"
} as const;

const secondaryButtonStyle = {
  ...primaryButtonStyle,
  background: "var(--studio-glass-card, #ffffff)",
  color: "var(--accent-strong)"
} as const;

const dangerButtonStyle = {
  background: "var(--studio-glass-card, #ffffff)",
  border: "1px solid #e0b4b4",
  borderRadius: 8,
  color: "#8f1f1f",
  cursor: "pointer",
  padding: "8px 10px"
} as const;
