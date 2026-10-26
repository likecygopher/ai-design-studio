"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Asset, AssetType, ProductWithProfile } from "@/src/domain/types";
import { useI18n } from "@/src/i18n/I18nProvider";
import {
  getMaterialCategoryForAssetType,
  materialCategories,
  type MaterialCategory
} from "@/src/domain/material-categories";

const sampleSubTypes: Array<{ value: AssetType; label: string }> = [
  { value: "product-photo", label: "产品照片" },
  { value: "phone-shot", label: "手机实拍" },
  { value: "feature-icon", label: "功能图标" },
  { value: "background", label: "背景素材" }
];

export function AssetLibrary() {
  const { locale, t } = useI18n();
  const [products, setProducts] = useState<ProductWithProfile[]>([]);
  const [productId, setProductId] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [uploadCategory, setUploadCategory] = useState<MaterialCategory>(materialCategories[3]);
  const [sampleType, setSampleType] = useState<AssetType>("product-photo");
  const [files, setFiles] = useState<FileList | null>(null);
  const [newProduct, setNewProduct] = useState({ name: "", category: "" });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [productsResponse, assetsResponse] = await Promise.all([
        fetch("/api/products"),
        fetch("/api/upload")
      ]);
      if (productsResponse.ok) {
        const payload = await productsResponse.json();
        if (Array.isArray(payload.products)) {
          setProducts(payload.products);
          setProductId((current) => current || payload.products[0]?.id || "");
        }
      }
      if (assetsResponse.ok) {
        const payload = await assetsResponse.json();
        if (Array.isArray(payload.assets)) {
          setAssets(payload.assets);
        }
      }
    } catch {
      setError(t("加载素材失败,请刷新页面。"));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const product = products.find((item) => item.id === productId);

  const productAssets = useMemo(() => {
    const fromProduct = product?.assets ?? [];
    const uploadedElsewhere = assets.filter(
      (asset) =>
        asset.productId === productId && !fromProduct.some((item) => item.id === asset.id)
    );
    return [...fromProduct, ...uploadedElsewhere];
  }, [assets, product, productId]);

  function assetsForCategory(category: MaterialCategory): Asset[] {
    return productAssets.filter(
      (asset) => getMaterialCategoryForAssetType(asset.type)?.key === category.key
    );
  }

  async function createProduct() {
    if (!newProduct.name.trim() || !newProduct.category.trim()) {
      setError(t("请填写产品名称与品类。"));
      return;
    }
    setError("");
    try {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newProduct)
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? t("创建产品失败"));
      }
      setNewProduct({ name: "", category: "" });
      setStatus(t("已创建产品:{name}", { name: payload.product?.displayName ?? "" }));
      await refresh();
      if (payload.product?.id) {
        setProductId(payload.product.id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("创建产品失败"));
    }
  }

  async function uploadFiles() {
    if (!files?.length || !productId) {
      setError(t("请选择要上传的文件。"));
      return;
    }
    setError("");
    setStatus("上传中…");
    try {
      const form = new FormData();
      form.set("projectId", "project-user-workspace");
      form.set("productId", productId);
      form.set(
        "type",
        uploadCategory.key === "sample" ? sampleType : uploadCategory.defaultAssetType
      );
      for (const file of Array.from(files)) {
        form.append("files", file);
      }
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? t("上传失败"));
      }
      setStatus(t("已入库 {count} 个素材", { count: payload.assets?.length ?? 0 }));
      setFiles(null);
      await refresh();
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : t("上传失败"));
    }
  }

  async function deleteProduct() {
    if (!product || product.projectId !== "project-user-workspace") {
      return;
    }
    setError("");
    try {
      const response = await fetch(`/api/products?id=${encodeURIComponent(product.id)}`, {
        method: "DELETE"
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? t("删除产品失败"));
      }
      setStatus(
        t("已删除产品及其上传素材:{name}", {
          name: product.displayName ?? product.id
        })
      );
      setProductId("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("删除产品失败"));
    }
  }

  async function removeAsset(assetId: string) {
    setError("");
    try {
      const response = await fetch(`/api/assets?id=${encodeURIComponent(assetId)}`, {
        method: "DELETE"
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? t("删除失败"));
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("删除失败"));
    }
  }

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={panelStyle}>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(220px, 1fr) auto minmax(360px, 2fr)", alignItems: "end" }}>
          <div style={{ alignItems: "end", display: "grid", gap: 8, gridTemplateColumns: "1fr auto" }}>
            <label style={fieldStyle}>
              {t("当前产品")}
              <select value={productId} onChange={(event) => setProductId(event.target.value)}>
                {products.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName ?? item.id}
                  </option>
                ))}
              </select>
            </label>
            {product?.projectId === "project-user-workspace" ? (
              <button onClick={deleteProduct} style={dangerButtonStyle} type="button">
                {t("workflow.deleteProduct")}
              </button>
            ) : null}
          </div>
          <span style={{ color: "var(--muted)" }}>{t("或")}</span>
          <div style={{ alignItems: "end", display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr auto" }}>
            <label style={fieldStyle}>
              {t("新产品名称")}
              <input
                value={newProduct.name}
                onChange={(event) => setNewProduct((c) => ({ ...c, name: event.target.value }))}
              />
            </label>
            <label style={fieldStyle}>
              {t("新产品品类")}
              <input
                placeholder={t("如 Laundry appliance")}
                value={newProduct.category}
                onChange={(event) => setNewProduct((c) => ({ ...c, category: event.target.value }))}
              />
            </label>
            <button onClick={createProduct} style={primaryButtonStyle} type="button">
              {t("workflow.createProduct")}
            </button>
          </div>
        </div>
      </div>

      <div style={panelStyle}>
        <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>
          {t("上传素材到「{name}」", { name: product?.displayName ?? "…" })}
        </h2>
        <div style={{ alignItems: "end", display: "grid", gap: 12, gridTemplateColumns: "auto auto 1fr auto" }}>
          <label style={fieldStyle}>
            {t("素材类别")}
            <select
              value={uploadCategory.key}
              onChange={(event) =>
                setUploadCategory(
                  materialCategories.find((item) => item.key === event.target.value) ??
                    materialCategories[3]
                )
              }
            >
              {materialCategories.map((category) => (
                <option key={category.key} value={category.key}>
                  {t(category.label)}
                </option>
              ))}
            </select>
          </label>
          {uploadCategory.key === "sample" ? (
            <label style={fieldStyle}>
              {t("样例类型")}
              <select
                value={sampleType}
                onChange={(event) => setSampleType(event.target.value as AssetType)}
              >
                {sampleSubTypes.map((item) => (
                  <option key={item.value} value={item.value}>
                    {t(item.label)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span />
          )}
          <div style={fieldStyle}>
            <span>{t("文件")}</span>
            <div style={fileFieldStyle}>
              <label style={fileButtonStyle}>
                {t("选择文件")}
                <input
                  accept={uploadCategory.accept}
                  multiple
                  onChange={(event) => setFiles(event.target.files)}
                  type="file"
                  style={{ display: "none" }}
                />
              </label>
              <span
                style={fileHintStyle}
                title={files?.length ? selectedFileNames(files, locale) : undefined}
              >
                {files?.length ? selectedFileNames(files, locale) : t("未选择")}
              </span>
            </div>
          </div>
          <button onClick={uploadFiles} style={primaryButtonStyle} type="button">
            {t("上传入库")}
          </button>
        </div>
        {status ? <p style={{ color: "#0049bb", margin: "8px 0 0" }}>{status}</p> : null}
        {error ? <p style={{ color: "#8f1f1f", margin: "8px 0 0" }}>{error}</p> : null}
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        {materialCategories.map((category) => {
          const categoryAssets = assetsForCategory(category);
          return (
            <div data-testid={`material-group-${category.key}`} key={category.key} style={panelStyle}>
              <div style={{ alignItems: "baseline", display: "flex", gap: 8, justifyContent: "space-between" }}>
                <h3 style={{ fontSize: 15, margin: 0 }}>{t(category.label)}</h3>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>
                  {t("{count} 项", { count: categoryAssets.length })}
                </span>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {categoryAssets.length === 0 ? (
                  <span style={{ color: "var(--muted-soft)", fontSize: 13 }}>
                    {t("暂无素材,可在上方上传。")}
                  </span>
                ) : null}
                {categoryAssets.map((asset) => (
                  <div
                    data-testid={`asset-row-${asset.id}`}
                    key={asset.id}
                    style={{ alignItems: "center", border: "1px solid #e5e8ec", borderRadius: 8, display: "flex", gap: 10, padding: 8 }}
                  >
                    {/\.(png|jpe?g|webp|svg)$/i.test(asset.url) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={asset.filename}
                        src={asset.url}
                        style={{ background: "var(--studio-glass-preview, #f7f8fa)", height: 44, objectFit: "contain", width: 44 }}
                      />
                    ) : (
                      <span style={{ fontSize: 22 }}>📄</span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {asset.filename}
                      </div>
                      <div style={{ color: "var(--muted-soft)", fontSize: 12 }}>{asset.type}</div>
                    </div>
                    <button
                      aria-label={t("删除 {filename}", { filename: asset.filename })}
                      onClick={() => removeAsset(asset.id)}
                      style={dangerButtonStyle}
                      type="button"
                    >
                      {t("删除")}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const panelStyle = {
  background: "var(--studio-glass-card, #ffffff)",
  border: "1px solid #d9e0e7",
  borderRadius: 8,
  padding: 16
} as const;

const fieldStyle = { display: "grid", gap: 6 } as const;

const fileFieldStyle = {
  alignItems: "center",
  display: "flex",
  gap: 8,
  minWidth: 0,
  maxWidth: 360
} as const;

const fileButtonStyle = {
  alignItems: "center",
  background: "rgba(255,255,255,.56)",
  border: "1px solid rgba(88,113,141,.22)",
  borderRadius: 8,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.6)",
  color: "var(--text)",
  cursor: "pointer",
  display: "inline-flex",
  flex: "0 0 auto",
  fontWeight: 600,
  height: 34,
  justifyContent: "center",
  padding: "0 12px"
} as const;

const fileHintStyle = {
  color: "var(--muted)",
  fontSize: 11,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
} as const;

function selectedFileNames(files: FileList | null, locale: "zh" | "en" = "zh"): string {
  if (!files?.length) {
    return "";
  }
  const names = Array.from(files).map((file) => file.name);
  const separator = locale === "en" ? ", " : "、";
  return names.length > 2
    ? locale === "en"
      ? `${names.slice(0, 2).join(separator)} and ${names.length - 2} more`
      : `${names.slice(0, 2).join(separator)} 等 ${names.length} 个文件`
    : names.join(separator);
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

const dangerButtonStyle = {
  background: "var(--studio-glass-card, #ffffff)",
  border: "1px solid #e0b4b4",
  borderRadius: 8,
  color: "#8f1f1f",
  cursor: "pointer",
  padding: "6px 10px"
} as const;

