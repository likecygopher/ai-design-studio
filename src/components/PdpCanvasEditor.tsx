"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Download,
  ImagePlus,
  LayoutTemplate,
  Plus,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import {
  PDP_KV_BLOCK_ID,
  buildDefaultPdpCanvasLayout,
  getPdpCanvasColumnLabel,
  getSellingPointBlockId,
  rankSellingPointIds,
  type PdpCanvasBlock,
  type PdpCanvasLayout
} from "@/src/domain/pdp-canvas-layout";
import type { Asset, ProductWithProfile, SellingPoint } from "@/src/domain/types";
import { PdpCanvas } from "./PdpCanvas";
import { ImageCropDialog } from "./ImageCropDialog";
import { SYSTEM_SETTINGS_CHANGED, type StudioMarketSettings } from "@/src/lib/system-settings-events";
import styles from "./PdpEditor.module.css";
import { useI18n } from "@/src/i18n/I18nProvider";

type ExportResponse = {
  taskId: string;
  url: string;
  templateVersion: string;
  sectionCount: number;
  missingImageSlots: string[];
  error?: string;
};

type EditablePoint = SellingPoint & { custom?: boolean };
type PendingCrop = { file: File; blockId: string; aspectRatio: number };
type EditorStatus = "idle" | "uploading" | "exporting" | "done" | "failed";


export function PdpCanvasEditor({ products }: { products: ProductWithProfile[] }) {
  const { t } = useI18n();
  const initialProduct = products[0];
  const initialPoints = toEditablePoints(initialProduct);
  const [productId, setProductId] = useState(initialProduct?.id ?? "");
  const [points, setPoints] = useState<EditablePoint[]>(initialPoints);
  const [layout, setLayout] = useState<PdpCanvasLayout>(() =>
    buildDefaultPdpCanvasLayout(initialPoints)
  );
  const [selectedBlockId, setSelectedBlockId] = useState(() =>
    initialPoints[0] ? getSellingPointBlockId(initialPoints[0].id) : PDP_KV_BLOCK_ID
  );
  const [sectionImages, setSectionImages] = useState<Record<string, string>>({});
  const [coverAssetId, setCoverAssetId] = useState("");
  const [country, setCountry] = useState("Mexico");
  const [language, setLanguage] = useState("Spanish");
  const [coverTitle, setCoverTitle] = useState(
    initialProduct?.displayName ?? initialProduct?.id ?? "Product key visual"
  );
  const [coverSubtitle, setCoverSubtitle] = useState(
    initialProduct?.profile.category ?? "Product overview"
  );

  useEffect(() => {
    let cancelled = false;
    let updated = false;
    const handleSettingsChange = (event: Event) => {
      const market = (event as CustomEvent<StudioMarketSettings>).detail;
      if (!market?.country || !market?.language) return;
      updated = true;
      setCountry(market.country);
      setLanguage(market.language);
    };
    window.addEventListener(SYSTEM_SETTINGS_CHANGED, handleSettingsChange);
    fetch("/api/settings")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled && !updated && payload?.settings) {
          setCountry(String(payload.settings.country));
          setLanguage(String(payload.settings.language));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      window.removeEventListener(SYSTEM_SETTINGS_CHANGED, handleSettingsChange);
    };
  }, []);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [zoom, setZoom] = useState(0.68);
  const [status, setStatus] = useState<EditorStatus>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ExportResponse | null>(null);
  const [uploadTargetBlockId, setUploadTargetBlockId] = useState("");
  const [pendingCrop, setPendingCrop] = useState<PendingCrop | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const product = products.find((item) => item.id === productId) ?? initialProduct;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/upload")
      .then((response) => (response.ok ? response.json() : { assets: [] }))
      .then((payload) => {
        if (!cancelled && Array.isArray(payload.assets)) {
          setAssets(payload.assets);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const imageAssets = useMemo(() => {
    const byId = new Map<string, Asset>();
    for (const asset of [...products.flatMap((item) => item.assets), ...assets]) {
      if (/\.(png|jpe?g|webp)$/i.test(asset.url)) {
        byId.set(asset.id, asset);
      }
    }
    return Array.from(byId.values());
  }, [assets, products]);

  const assetById = useMemo(
    () => new Map(imageAssets.map((asset) => [asset.id, asset])),
    [imageAssets]
  );

  const defaultCoverAssetId =
    product?.assets.find((asset) => asset.type === "product-photo")?.id ?? "";
  const effectiveCoverAssetId = coverAssetId || defaultCoverAssetId;

  const imageUrlByBlockId = useMemo(() => {
    const urls: Record<string, string | undefined> = {
      [PDP_KV_BLOCK_ID]: assetById.get(effectiveCoverAssetId)?.url
    };
    for (const point of points) {
      const assetId = sectionImages[point.id];
      urls[getSellingPointBlockId(point.id)] = assetId
        ? assetById.get(assetId)?.url
        : undefined;
    }
    return urls;
  }, [assetById, effectiveCoverAssetId, points, sectionImages]);

  const selectedBlock = layout.blocks.find((block) => block.id === selectedBlockId);
  const selectedPoint =
    selectedBlock?.sellingPointId
      ? points.find((point) => point.id === selectedBlock.sellingPointId)
      : undefined;
  const activePoints = useMemo(
    () => points.filter((point) => point.enabled !== false).slice().sort(byPriority),
    [points]
  );

  function switchProduct(nextId: string) {
    const nextProduct = products.find((item) => item.id === nextId);
    const nextPoints = toEditablePoints(nextProduct);
    const nextLayout = buildDefaultPdpCanvasLayout(nextPoints);

    setProductId(nextId);
    setPoints(nextPoints);
    setLayout(nextLayout);
    setSelectedBlockId(
      nextPoints[0] ? getSellingPointBlockId(nextPoints[0].id) : PDP_KV_BLOCK_ID
    );
    setSectionImages({});
    setCoverAssetId("");
    setCoverTitle(nextProduct?.displayName ?? nextProduct?.id ?? "Product key visual");
    setCoverSubtitle(nextProduct?.profile.category ?? "Product overview");
    setResult(null);
    setError("");
    setStatus("idle");
  }

  function resetTreeLayout() {
    const next = buildDefaultPdpCanvasLayout(activePoints);
    setLayout(next);
    setSelectedBlockId((current) =>
      next.blocks.some((block) => block.id === current)
        ? current
        : next.blocks.find((block) => block.kind === "selling-point")?.id ?? PDP_KV_BLOCK_ID
    );
    markDirty();
  }

  function handleDragEnd(nextLayout: PdpCanvasLayout) {
    const visualOrder = rankSellingPointIds(nextLayout);
    const priorityById = new Map(visualOrder.map((id, index) => [id, index + 1]));
    setPoints((current) =>
      current.map((point) => ({
        ...point,
        priority: priorityById.get(point.id) ?? point.priority
      }))
    );
    markDirty();
  }

  function updateSelectedPoint(patch: Partial<EditablePoint>) {
    if (!selectedPoint) {
      return;
    }
    setPoints((current) =>
      current.map((point) => (point.id === selectedPoint.id ? { ...point, ...patch } : point))
    );
    markDirty();
  }

  function addSellingPoint() {
    const id = `feature-custom-${Date.now()}`;
    const point: EditablePoint = {
      id,
      title: "New selling point",
      shortLabel: "New selling point",
      benefit: "Add the product benefit or technical proof.",
      priority: activePoints.length + 1,
      enabled: true,
      custom: true
    };
    const nextPoints = [...points, point];
    const nextLayout = buildDefaultPdpCanvasLayout(nextPoints);

    setPoints(nextPoints);
    setLayout(nextLayout);
    setSelectedBlockId(getSellingPointBlockId(id));
    markDirty();
  }

  function removeSelectedPoint() {
    if (!selectedPoint) {
      return;
    }

    const nextPoints = points.filter((point) => point.id !== selectedPoint.id);
    const nextLayout = buildDefaultPdpCanvasLayout(nextPoints);
    setPoints(nextPoints);
    setLayout(nextLayout);
    setSectionImages((current) => {
      const next = { ...current };
      delete next[selectedPoint.id];
      return next;
    });
    setSelectedBlockId(
      nextLayout.blocks.find((block) => block.kind === "selling-point")?.id ??
        PDP_KV_BLOCK_ID
    );
    markDirty();
  }

  function assignAssetToBlock(blockId: string, assetId: string) {
    const block = layout.blocks.find((item) => item.id === blockId);
    if (!block) {
      return;
    }

    if (block.kind === "kv") {
      setCoverAssetId(assetId);
    } else if (block.kind === "selling-point" && block.sellingPointId) {
      setSectionImages((current) => ({
        ...current,
        [block.sellingPointId!]: assetId
      }));
    }
    markDirty();
  }

  function requestImage(blockId: string) {
    const block = layout.blocks.find((item) => item.id === blockId);
    if (!block || (block.kind !== "kv" && block.kind !== "selling-point")) {
      return;
    }
    setSelectedBlockId(blockId);
    setUploadTargetBlockId(blockId);
    fileInputRef.current?.click();
  }

  function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const blockId = uploadTargetBlockId || selectedBlockId;
    event.target.value = "";
    if (!file || !product) {
      return;
    }
    const block = layout.blocks.find((item) => item.id === blockId);
    if (!block) {
      return;
    }
    setPendingCrop({ file, blockId, aspectRatio: getPdpImageAspectRatio(block) });
  }

  async function uploadCroppedImage(file: File) {
    const pending = pendingCrop;
    if (!pending || !product) {
      return;
    }

    setStatus("uploading");
    setError("");
    try {
      const form = new FormData();
      form.set("projectId", product.projectId);
      form.set("productId", product.id);
      form.set("type", "pdp-input");
      form.append("files", file);

      const response = await fetch("/api/upload", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok || payload.error || !payload.assets?.[0]) {
        throw new Error(payload.error ?? t("图片上传失败"));
      }

      const uploaded = payload.assets[0] as Asset;
      setAssets((current) => [
        ...current.filter((asset) => asset.id !== uploaded.id),
        uploaded
      ]);
      assignAssetToBlock(pending.blockId, uploaded.id);
      setStatus("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("图片上传失败"));
      setStatus("failed");
    } finally {
      setPendingCrop(null);
      setUploadTargetBlockId("");
    }
  }

  function cancelImageCrop() {
    setPendingCrop(null);
    setUploadTargetBlockId("");
  }

  async function exportPdp() {
    if (!product) {
      return;
    }

    setStatus("exporting");
    setError("");
    setResult(null);

    const visualOrder = rankSellingPointIds(layout);
    const priorityById = new Map(visualOrder.map((id, index) => [id, index + 1]));
    const exportPoints = points
      .map((point) => ({
        ...point,
        priority: priorityById.get(point.id) ?? point.priority
      }))
      .sort(byPriority);

    try {
      const response = await fetch("/api/pdp/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: `task-pdp-export-${Date.now()}`,
          productId: product.id,
          country,
          language,
          templateVersion: "pdp-canvas-v4",
          coverAssetId: effectiveCoverAssetId || undefined,
          coverTitle,
          coverSubtitle,
          sectionImages,
          layout,
          sellingPoints: exportPoints.map((point) => ({
            id: point.id,
            title: point.title,
            shortLabel: point.shortLabel,
            benefit: point.benefit,
            technicalProof: point.technicalProof,
            priority: point.priority,
            enabled: point.enabled
          }))
        })
      });
      const payload: ExportResponse = await response.json();

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? `Request failed with ${response.status}`);
      }

      setResult(payload);
      setStatus("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PDP export failed");
      setStatus("failed");
    }
  }

  function markDirty() {
    setResult(null);
    setError("");
    setStatus("idle");
  }

  if (!product) {
    return null;
  }

  const selectedAssetId =
    selectedBlock?.kind === "kv"
      ? effectiveCoverAssetId
      : selectedPoint
        ? sectionImages[selectedPoint.id] ?? ""
        : "";
  const selectedAsset = selectedAssetId ? assetById.get(selectedAssetId) : undefined;

  return (
    <section className={styles.editor}>
      <header className={styles.editorHeader}>
        <div>
          <h2>动态 PDP 画布</h2>
        </div>
        <span
          className={`${styles.status} ${status === "done" ? styles.statusActive : ""}`}
        >
          {statusLabel(status, t)}
        </span>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.contextControls}>
          <select
            aria-label={t("产品")}
            className={styles.productSelect}
            onChange={(event) => switchProduct(event.target.value)}
            value={productId}
          >
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName ?? item.id}
              </option>
            ))}
          </select>
          <span title={t("默认市场可在右上角「用户设置」中修改")}>{country} / {language}</span>
        </div>

        <div className={styles.toolbarActions}>
          <button
            aria-label={t("缩小画布")}
            className={styles.iconButton}
            disabled={zoom <= 0.42}
            onClick={() => setZoom((current) => Math.max(0.42, current - 0.08))}
            title={t("缩小画布")}
            type="button"
          >
            <ZoomOut aria-hidden="true" size={17} />
          </button>
          <span className={styles.zoomValue}>{Math.round(zoom * 100)}%</span>
          <button
            aria-label={t("放大画布")}
            className={styles.iconButton}
            disabled={zoom >= 1.22}
            onClick={() => setZoom((current) => Math.min(1.22, current + 0.08))}
            title={t("放大画布")}
            type="button"
          >
            <ZoomIn aria-hidden="true" size={17} />
          </button>
          <span className={styles.toolbarDivider} />
          <button
            className={styles.commandButton}
            onClick={resetTreeLayout}
            title={t("恢复默认树形布局")}
            type="button"
          >
            <LayoutTemplate aria-hidden="true" size={16} />
            <span>{t("树形布局")}</span>
          </button>
          <button
            className={styles.commandButton}
            onClick={addSellingPoint}
            title={t("新增卖点")}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            <span>{t("新增卖点")}</span>
          </button>
          <button
            className={styles.primaryButton}
            disabled={status === "exporting" || status === "uploading"}
            onClick={exportPdp}
            title={t("导出 PDP 长图")}
            type="button"
          >
            <Download aria-hidden="true" size={16} />
            <span>{status === "exporting" ? t("导出中") : t("导出长图")}</span>
          </button>
        </div>
      </div>

      <div className={styles.workspace}>
        <div className={styles.canvasPane}>
          <PdpCanvas
            brandName={product.brand ?? "Midea"}
            coverTitle={coverTitle}
            coverSubtitle={coverSubtitle}
            country={country}
            imageUrlByBlockId={imageUrlByBlockId}
            language={language}
            layout={layout}
            onDragEnd={handleDragEnd}
            onLayoutChange={setLayout}
            onRequestImage={requestImage}
            onSelectBlock={setSelectedBlockId}
            points={points}
            productName={product.displayName ?? product.id}
            selectedBlockId={selectedBlockId}
            zoom={zoom}
          />
        </div>

        <aside className={styles.inspector}>
          <div className={styles.inspectorHeader}>
            <span className={styles.inspectorLabel}>{t("当前图层")}</span>
            <select
              aria-label={t("当前图层")}
              className={styles.layerSelect}
              onChange={(event) => setSelectedBlockId(event.target.value)}
              value={selectedBlockId}
            >
              {layout.blocks.map((block) => (
                <option key={block.id} value={block.id}>
                  {blockOptionLabel(block, points)}
                </option>
              ))}
            </select>
            <div className={styles.selectionMeta}>
              <strong>{blockTitle(selectedBlock, selectedPoint, t)}</strong>
              {selectedBlock?.kind === "selling-point" ? (
                <span className={styles.priorityBadge}>
                  P{selectedPoint?.priority ?? selectedBlock.priority ?? 1} · SP
                  {selectedBlock.level ?? 1}
                </span>
              ) : null}
            </div>
          </div>

          <div className={styles.inspectorBody}>
            {selectedBlock?.kind === "selling-point" && selectedPoint ? (
              <>
                <label className={styles.field}>
                  {t("黑色标题")}
                  <input
                    aria-label={t("卖点标题")}
                    onChange={(event) =>
                      updateSelectedPoint({ title: event.target.value })
                    }
                    value={selectedPoint.title}
                  />
                </label>
                <label className={styles.field}>
                  {t("灰色说明")}
                  <textarea
                    aria-label={t("卖点说明")}
                    onChange={(event) =>
                      updateSelectedPoint({ benefit: event.target.value })
                    }
                    value={selectedPoint.benefit}
                  />
                </label>
                <ImageAssetField
                  assetId={selectedAssetId}
                  assets={imageAssets}
                  onChange={(assetId) => assignAssetToBlock(selectedBlock.id, assetId)}
                  onUpload={() => requestImage(selectedBlock.id)}
                />
                <AssetPreview asset={selectedAsset} />
                <div className={styles.inspectorFooter}>
                  <button
                    className={styles.dangerButton}
                    onClick={removeSelectedPoint}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={15} />
                    {t("移除卖点")}
                  </button>
                </div>
              </>
            ) : selectedBlock?.kind === "kv" ? (
              <>
                <label className={styles.field}>
                  {t("KV 标题")}
                  <input
                    aria-label={t("KV 标题")}
                    maxLength={160}
                    onChange={(event) => {
                      setCoverTitle(event.target.value);
                      markDirty();
                    }}
                    value={coverTitle}
                  />
                </label>
                <label className={styles.field}>
                  {t("KV 说明")}
                  <textarea
                    aria-label={t("KV 说明")}
                    maxLength={320}
                    onChange={(event) => {
                      setCoverSubtitle(event.target.value);
                      markDirty();
                    }}
                    value={coverSubtitle}
                  />
                </label>
                <ImageAssetField
                  assetId={selectedAssetId}
                  assets={imageAssets}
                  onChange={(assetId) => assignAssetToBlock(selectedBlock.id, assetId)}
                  onUpload={() => requestImage(selectedBlock.id)}
                />
                <AssetPreview asset={selectedAsset} />
              </>
            ) : (
              <div className={styles.inspectorSummary}>
                <strong>{blockTitle(selectedBlock, selectedPoint, t)}</strong>
                <p>{generatedBlockSummary(selectedBlock, activePoints.length, t)}</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      <input
        accept="image/png,image/jpeg,image/webp"
        className={styles.hiddenInput}
        onChange={uploadImage}
        ref={fileInputRef}
        type="file"
      />
      {pendingCrop ? (
        <ImageCropDialog
          aspectRatio={pendingCrop.aspectRatio}
          file={pendingCrop.file}
          onCancel={cancelImageCrop}
          onConfirm={uploadCroppedImage}
          title={t("裁切 PDP 配图")}
        />
      ) : null}

      {error ? <div className={styles.errorBar}>{error}</div> : null}
      {result ? (
        <div className={styles.resultBar}>
          <span className={styles.resultMeta}>
            {t("{version} · {count} 个卖点", { version: result.templateVersion, count: result.sectionCount })}
            {result.missingImageSlots.length
              ? t(" · {count} 个待补图", { count: result.missingImageSlots.length })
              : ""}
          </span>
          <a href={result.url} rel="noreferrer" target="_blank">{t("打开导出文件")}</a>
        </div>
      ) : null}
    </section>
  );
}

function ImageAssetField({
  assetId,
  assets,
  onChange,
  onUpload
}: {
  assetId: string;
  assets: Asset[];
  onChange: (assetId: string) => void;
  onUpload: () => void;
}) {
  const { t } = useI18n();
  return (
    <label className={styles.field}>
      {t("配图")}
      <span className={styles.assetActions}>
        <select
          aria-label={t("配图")}
          onChange={(event) => onChange(event.target.value)}
          value={assetId}
        >
          <option value="">{t("待上传")}</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.filename}
            </option>
          ))}
        </select>
        <button
          aria-label={t("上传配图")}
          className={styles.iconButton}
          onClick={onUpload}
          title={t("上传配图")}
          type="button"
        >
          <Upload aria-hidden="true" size={16} />
        </button>
      </span>
    </label>
  );
}

function AssetPreview({ asset }: { asset: Asset | undefined }) {
  return (
    <div className={styles.assetPreview}>
      {asset ? (
        <img alt={asset.filename} src={asset.url} />
      ) : (
        <div className={styles.assetPlaceholder}>
          <ImagePlus aria-hidden="true" size={24} />
        </div>
      )}
    </div>
  );
}

function getPdpImageAspectRatio(block: PdpCanvasBlock): number {
  if (block.kind === "kv") {
    return block.width / Math.max(1, block.height - 94);
  }
  if (block.kind === "selling-point") {
    if ((block.level ?? 1) >= 3) {
      return (block.width / 2) / Math.max(1, block.height);
    }
    const titleHeight = Math.min(54, Math.max(34, Math.round(block.height * 0.21)));
    const descriptionHeight = Math.min(50, Math.max(32, Math.round(block.height * 0.19)));
    return block.width / Math.max(1, block.height - titleHeight - descriptionHeight);
  }
  return block.width / Math.max(1, block.height);
}

function toEditablePoints(product: ProductWithProfile | undefined): EditablePoint[] {
  return (product?.profile.detectedFeatures ?? []).map((point) => ({
    ...point,
    enabled: point.enabled !== false
  }));
}

function blockOptionLabel(block: PdpCanvasBlock, points: EditablePoint[]): string {
  if (block.kind === "selling-point") {
    const point = points.find((item) => item.id === block.sellingPointId);
    return `SP${block.level ?? 1} · ${point?.title || "Selling point"}`;
  }
  return getPdpCanvasColumnLabel(block);
}

function blockTitle(
  block: PdpCanvasBlock | undefined,
  point: EditablePoint | undefined,
  translate: (key: string, params?: Record<string, string | number>) => string
): string {
  if (!block) {
    return translate("未选择");
  }
  if (block.kind === "selling-point") {
    return point?.title || "Selling point";
  }
  return getPdpCanvasColumnLabel(block);
}

function generatedBlockSummary(
  block: PdpCanvasBlock | undefined,
  sellingPointCount: number,
  translate: (key: string, params?: Record<string, string | number>) => string
): string {
  if (block?.kind === "brand") {
    return translate("固定品牌头图，使用系统品牌素材。");
  }
  if (block?.kind === "features") {
    return translate("根据 {count} 个卖点自动生成图标索引。", { count: sellingPointCount });
  }
  if (block?.kind === "specification") {
    return translate("根据 {count} 个卖点自动生成参数表。", { count: sellingPointCount });
  }
  return translate("选择画布中的内容块。");
}

function statusLabel(
  status: EditorStatus,
  translate: (key: string) => string
): string {
  if (status === "uploading") {
    return translate("上传中");
  }
  if (status === "exporting") {
    return translate("导出中");
  }
  if (status === "done") {
    return translate("已导出");
  }
  if (status === "failed") {
    return translate("失败");
  }
  return translate("就绪");
}

function byPriority(left: SellingPoint, right: SellingPoint): number {
  return left.priority - right.priority;
}
