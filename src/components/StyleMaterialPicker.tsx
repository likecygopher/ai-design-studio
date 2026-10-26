"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import type { Asset, ProductWithProfile } from "@/src/domain/types";
import { StudioDialog } from "./StudioDialog";
import styles from "./StyleTransferStudio.module.css";
import { useI18n } from "@/src/i18n/I18nProvider";

const PRODUCT_TYPES = new Set<Asset["type"]>(["product-photo", "phone-shot", "white-background-closed", "white-background-open", "sku-product"]);
export function styleProductImages(product?: ProductWithProfile) {
  return product?.assets.filter(asset => PRODUCT_TYPES.has(asset.type)) ?? [];
}
export function productLabel(product?: ProductWithProfile) { return product?.displayName ?? product?.modelName ?? product?.id ?? "未选择产品"; }

export function StyleMaterialPicker({ mode, products, setProducts, initialProductId, onSelect, onClose }: {
  mode: "library" | "upload";
  products: ProductWithProfile[];
  setProducts: Dispatch<SetStateAction<ProductWithProfile[]>>;
  initialProductId: string;
  onSelect: (productId: string, assetId: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [productId, setProductId] = useState(initialProductId || products[0]?.id || "new");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const product = products.find(item => item.id === productId);
  const images = styleProductImages(product);

  async function upload() {
    if (busy) return;
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) { setError(t("请选择不超过 20 MB 的 PNG、JPEG 或 WebP 产品图片。")); return; }
    if (!product && (!name.trim() || !category.trim())) { setError(t("请填写产品名称和品类。")); return; }
    setBusy(true); setError("");
    try {
      let target = product;
      if (!target) {
        const response = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), category: category.trim() }) });
        const payload = await response.json();
        if (!response.ok || !payload.product?.id) throw new Error(payload.error ?? t("创建产品失败"));
        target = payload.product as ProductWithProfile;
        const created = target;
        setProducts(current => [...current.filter(item => item.id !== created.id), created]);
        setProductId(target.id);
      }
      const form = new FormData();
      form.set("projectId", target.projectId); form.set("productId", target.id); form.set("type", "product-photo"); form.append("files", file);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const payload = await response.json();
      const asset = payload.assets?.[0] as Asset | undefined;
      if (!response.ok || payload.error || !asset?.id) throw new Error(payload.error ?? t(t("上传失败，请重试")));
      const targetId = target.id;
      setProducts(current => current.map(item => item.id === targetId ? { ...item, assets: [...item.assets, asset] } : item));
      onSelect(target.id, asset.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t(t("上传失败，请重试"))); }
    finally { setBusy(false); }
  }

  return <StudioDialog title={mode === "library" ? t("选择产品素材") : t("本地上传产品图")} onClose={onClose} busy={busy}>
    <div className={styles.pickerForm}>
      <label className={styles.field}>{t("产品")}<select disabled={busy} value={productId} onChange={event => { setProductId(event.target.value); setError(""); }}>
        {products.map(item => <option value={item.id} key={item.id}>{productLabel(item)}</option>)}
        {mode === "upload" ? <option value="new">{t("＋ 创建新产品")}</option> : !products.length ? <option value="new">{t("暂无产品")}</option> : null}
      </select></label>
      {mode === "library" ? <>
        <p className={styles.hint}>{t("仅使用当前产品的素材。")}</p>
        <div className={styles.assetGrid}>
          {images.map(asset => <button type="button" key={asset.id} aria-label={asset.filename} onClick={() => onSelect(productId, asset.id)} className={styles.assetCard}>
            {/* eslint-disable-next-line @next/next/no-img-element */}<img src={asset.url} alt="" /><span>{asset.filename}</span>
          </button>)}
        </div>
        {!images.length ? <p className={styles.emptyState}>{t("此产品暂无可用参考图。关闭窗口后，可通过“本地上传”添加。")}</p> : null}
      </> : <>
        {!product ? <div className={styles.newProductFields}>
          <label className={styles.field}>{t("产品名称")}<input maxLength={100} disabled={busy} value={name} onChange={event => setName(event.target.value)} placeholder={t("例如：静音循环风扇")} /></label>
          <label className={styles.field}>{t("产品品类")}<input maxLength={60} disabled={busy} value={category} onChange={event => setCategory(event.target.value)} placeholder={t("例如：风扇")} /></label>
        </div> : null}
        <label className={styles.uploadZone}><ImagePlus size={25} aria-hidden /><strong>{file?.name ?? t("点击选择产品图片")}</strong><span>{t("PNG / JPEG / WebP · 最大 20 MB")}</span><input type="file" aria-label={t("产品图片")} disabled={busy} accept="image/png,image/jpeg,image/webp" onChange={event => { setFile(event.target.files?.[0]); setError(""); }} /></label>
        <button className={styles.primary} disabled={busy || !file} onClick={upload} type="button">{busy ? <><Loader2 size={14} className={styles.spinner} aria-hidden />{t("上传中…")}</> : t("上传并使用")}</button>
      </>}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </div>
  </StudioDialog>;
}
