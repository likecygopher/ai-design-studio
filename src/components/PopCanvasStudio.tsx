"use client";

import {
  CookingPot,
  Check,
  Download,
  ImagePlus,
  LockKeyhole,
  Maximize2,
  Move,
  Play,
  Refrigerator,
  RotateCcw,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import type { Asset, ProductWithProfile } from "@/src/domain/types";
import { parseAspectRatio } from "@/src/domain/image-crop";
import {
  allPopTemplates,
  getPopTemplate,
  renderPopFlatSvg,
  type PopTemplate
} from "@/src/domain/pop";
import {
  getPopStickerGroup,
  getPopTemplateIds,
  getPopTemplateSet,
  inferPopProductType,
  type PopProductType
} from "@/src/domain/pop-template-sets";
import {
  PopTemplateCanvas,
  type PopVariantCanvasContent
} from "./PopTemplateCanvas";
import { ImageCropDialog } from "./ImageCropDialog";
import styles from "./PopCanvasStudio.module.css";
import { useI18n } from "@/src/i18n/I18nProvider";

type LocalMaterial = {
  templateId: string;
  name: string;
  pngUrl: string;
  svgUrl: string;
};

type PopTemplateDraft = {
  textValues: Record<string, string>;
  imageAssetIds: Record<string, string>;
};

type EditorStatus =
  | "idle"
  | "uploading"
  | "generating"
  | "done"
  | "failed";

type UploadTarget = {
  templateId: string;
  slotId: string;
};

type PendingCrop = {
  file: File;
  target: UploadTarget;
  aspectRatio: number;
};

const MIN_CANVAS_ZOOM = 0.5;
const MAX_CANVAS_ZOOM = 2;
const CANVAS_ZOOM_STEP = 0.25;

export function PopCanvasStudio({ products }: { products: ProductWithProfile[] }) {
  const { t } = useI18n();
  const previewNamespace = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const initialProduct = products[0];
  const initialProductType = initialProduct
    ? inferPopProductType(initialProduct)
    : "refrigerator";
  const initialTemplateSet = getPopTemplateSet(initialProductType);
  const initialTemplateId = getPopTemplateIds(initialTemplateSet)[0] ?? "";

  const [productId, setProductId] = useState(initialProduct?.id ?? "");
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplateId);
  const [selectedByGroup, setSelectedByGroup] = useState<Record<string, string>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, PopTemplateDraft>>(
    buildInitialDrafts
  );
  const [assets, setAssets] = useState<Asset[]>(() =>
    dedupeAssets(products.flatMap((product) => product.assets))
  );
  const [dataUriCache, setDataUriCache] = useState<Record<string, string>>({});
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [status, setStatus] = useState<EditorStatus>("idle");
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [materials, setMaterials] = useState<LocalMaterial[]>([]);
  const [pendingCrop, setPendingCrop] = useState<PendingCrop | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<UploadTarget | null>(null);
  const exportUrlsRef = useRef<string[]>([]);
  const generationRevisionRef = useRef(0);

  const product =
    products.find((item) => item.id === productId) ?? products[0];
  const productType: PopProductType = product
    ? inferPopProductType(product)
    : "refrigerator";
  const templateSet = getPopTemplateSet(productType);
  const templateIds = useMemo(
    () => getPopTemplateIds(templateSet),
    [templateSet]
  );
  const selectedTemplate = getPopTemplate(selectedTemplateId);
  const selectedGroup = getPopStickerGroup(templateSet, selectedTemplateId);
  const selectedDraft =
    drafts[selectedTemplateId] ?? buildDefaultDraft(selectedTemplate);

  useEffect(() => () => {
    generationRevisionRef.current += 1;
    exportUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/upload")
      .then((response) => (response.ok ? response.json() : { assets: [] }))
      .then((payload) => {
        if (!cancelled && Array.isArray(payload.assets)) {
          setAssets((current) =>
            dedupeAssets([...current, ...(payload.assets as Asset[])])
          );
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedImageIds = useMemo(
    () => Array.from(new Set(Object.values(drafts).flatMap((draft) => Object.values(draft.imageAssetIds)).filter(Boolean))),
    [drafts]
  );

  useEffect(() => {
    const wanted = selectedImageIds.filter(
      (assetId) => assetId && !dataUriCache[assetId]
    );
    if (!wanted.length) {
      return;
    }

    let cancelled = false;
    void (async () => {
      for (const assetId of wanted) {
        const asset = assets.find((item) => item.id === assetId);
        if (!asset) {
          continue;
        }
        try {
          const response = await fetch(asset.url);
          const blob = await response.blob();
          const dataUri = await blobToDataUri(blob);
          if (!cancelled) {
            setDataUriCache((current) => ({
              ...current,
              [assetId]: dataUri
            }));
          }
        } catch {
          // The Canvas keeps the gray placeholder when an asset cannot be read.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assets, dataUriCache, selectedImageIds]);

  const imageAssets = useMemo(
    () => assets.filter(isRasterImage),
    [assets]
  );
  const productPhotoOptions = useMemo(
    () =>
      imageAssets.filter(
        (asset) =>
          asset.type === "product-photo" &&
          (asset.productId === product?.id || product?.assets.some((item) => item.id === asset.id))
      ),
    [imageAssets, product?.id]
  );
  const effectiveProductAssetId =
    productPhotoOptions[0]?.id || "";
  const productPhoto = productPhotoOptions.find((asset) => asset.id === effectiveProductAssetId);

  const contentByTemplateId = useMemo(() => Object.fromEntries(
    Object.entries(drafts).map(([templateId, draft]) => [templateId, {
      textValues: draft.textValues,
      imageDataUris: Object.fromEntries(Object.entries(draft.imageAssetIds)
        .filter(([, assetId]) => assetId && dataUriCache[assetId])
        .map(([slotId, assetId]) => [slotId, dataUriCache[assetId]]))
    } satisfies PopVariantCanvasContent])
  ), [dataUriCache, drafts]);

  const flatSvg = useMemo(() => {
    const content = contentByTemplateId[selectedTemplateId] ?? {
      textValues: selectedDraft.textValues,
      imageDataUris: {}
    };
    return renderPopFlatSvg({
      templateId: selectedTemplateId,
      textValues: content.textValues,
      imageDataUris: content.imageDataUris
    });
  }, [contentByTemplateId, selectedDraft.textValues, selectedTemplateId]);

  function switchProduct(nextProductId: string) {
    const nextProduct =
      products.find((item) => item.id === nextProductId) ?? products[0];
    if (!nextProduct) {
      return;
    }

    const nextSet = getPopTemplateSet(inferPopProductType(nextProduct));
    const nextTemplateId = getPopTemplateIds(nextSet)[0];
    setProductId(nextProduct.id);
    setSelectedTemplateId(nextTemplateId);
    setEditorOpen(false);
    markDirty();
  }

  function selectTemplate(nextTemplateId: string) {
    if (!templateIds.includes(nextTemplateId)) {
      return;
    }
    const group = getPopStickerGroup(templateSet, nextTemplateId);
    if (group) {
      setSelectedByGroup((current) => ({ ...current, [group.id]: nextTemplateId }));
    }
    setSelectedTemplateId(nextTemplateId);
    markDirty();
  }

  function updateText(slotId: string, value: string) {
    updateDraft(selectedTemplateId, (draft) => ({
      ...draft,
      textValues: {
        ...draft.textValues,
        [slotId]: value
      }
    }));
  }

  function assignImage(templateId: string, slotId: string, assetId: string) {
    updateDraft(templateId, (draft) => ({
      ...draft,
      imageAssetIds: {
        ...draft.imageAssetIds,
        [slotId]: assetId
      }
    }));
  }

  function updateDraft(
    templateId: string,
    updater: (draft: PopTemplateDraft) => PopTemplateDraft
  ) {
    setDrafts((current) => {
      const template = getPopTemplate(templateId);
      const draft = current[templateId] ?? buildDefaultDraft(template);
      return {
        ...current,
        [templateId]: updater(draft)
      };
    });
    markDirty();
  }

  function requestImageUpload(slotId: string) {
    uploadTargetRef.current = {
      templateId: selectedTemplateId,
      slotId
    };
    fileInputRef.current?.click();
  }

  function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const target = uploadTargetRef.current;
    event.target.value = "";
    if (!file || !target || !product) {
      return;
    }

    const template = getPopTemplate(target.templateId);
    setPendingCrop({
      file,
      target,
      aspectRatio: getPopCropAspectRatio(template, target.slotId)
    });
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
      form.set("type", "pop-input");
      form.append("files", file);

      const response = await fetch("/api/upload", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok || payload.error || !payload.assets?.[0]) {
        throw new Error(payload.error ?? t("图片上传失败"));
      }

      const uploaded = payload.assets[0] as Asset;
      setAssets((current) => dedupeAssets([...current, uploaded]));
      assignImage(pending.target.templateId, pending.target.slotId, uploaded.id);
      setStatus("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("图片上传失败"));
      setStatus("failed");
    } finally {
      setPendingCrop(null);
      uploadTargetRef.current = null;
    }
  }

  function cancelImageCrop() {
    setPendingCrop(null);
    uploadTargetRef.current = null;
  }

  async function generateMaterialSet() {
    markDirty();
    const revision = generationRevisionRef.current;
    const generated: LocalMaterial[] = [];
    const createdUrls: string[] = [];
    setStatus("generating");
    try {
      for (const [index, group] of templateSet.groups.entries()) {
        const templateId = selectedByGroup[group.id] ?? group.variants[0].templateId;
        const template = getPopTemplate(templateId);
        const draft = drafts[templateId] ?? buildDefaultDraft(template);
        const imageDataUris: Record<string, string> = {};
        setStage(t("正在生成 {index}/{total} · {name}", { index: index + 1, total: templateSet.groups.length, name: group.name }));
        for (const [slotId, assetId] of Object.entries(draft.imageAssetIds)) {
          if (!assetId) continue;
          let dataUri = dataUriCache[assetId];
          if (!dataUri) {
            const asset = assets.find((item) => item.id === assetId);
            if (!asset) throw new Error(t("所选图片已不可用，请重新选择图片。"));
            const response = await fetch(asset.url);
            if (!response.ok) throw new Error(t("无法读取图片 {name}，请重新选择图片。", { name: asset.filename }));
            dataUri = await blobToDataUri(await response.blob());
          }
          imageDataUris[slotId] = dataUri;
        }
        const svg = renderPopFlatSvg({ templateId, textValues: draft.textValues, imageDataUris });
        const png = await rasterizeSvg(svg);
        const pngUrl = URL.createObjectURL(png);
        const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
        createdUrls.push(pngUrl, svgUrl);
        generated.push({ templateId, name: template.name, pngUrl, svgUrl });
        if (revision !== generationRevisionRef.current) {
          createdUrls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }
      }
      exportUrlsRef.current = createdUrls;
      setMaterials(generated);
      setStage(t("已生成 {count} 份物料，可逐项下载 PNG 或 SVG。", { count: generated.length }));
      setStatus("done");
    } catch (cause) {
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
      if (revision !== generationRevisionRef.current) return;
      setError(cause instanceof Error ? cause.message : t("本地物料导出失败，请重试。"));
      setStage("");
      setStatus("failed");
    }
  }

  function markDirty() {
    generationRevisionRef.current += 1;
    exportUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    exportUrlsRef.current = [];
    setMaterials([]);
    setError("");
    setStage("");
    setStatus("idle");
  }

  if (!product) {
    return null;
  }

  const ProductTypeIcon = productType === "oven" ? CookingPot : Refrigerator;
  const productTypeLabel = productType === "oven" ? t("烤箱模板") : t("冰箱模板");
  const statusLabel =
    status === "generating"
      ? t("生成中")
      : status === "uploading"
        ? t("上传中")
        : status === "done"
          ? t("已生成")
          : status === "failed"
            ? t("失败")
            : t("就绪");

  return (
    <section className={styles.studio}>
      <div className={styles.toolbar}>
        <label className={styles.field}>
          {t("产品")}
          <select
            aria-label={t("产品")}
            onChange={(event) => switchProduct(event.target.value)}
            value={product.id}
          >
            {products.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName ?? item.id}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.field}>
          {t("产品类型模板")}
          <div className={styles.productType} data-testid="pop-product-type">
            <ProductTypeIcon aria-hidden="true" size={18} strokeWidth={1.8} />
            {productTypeLabel}
          </div>
        </div>
        <div className={styles.setActions}>
          <span>{t("本地模板模式 · 拖拽贴装预览")}</span>
          <button className={styles.generateButton} disabled={status === "generating" || status === "uploading"} onClick={generateMaterialSet} type="button">
            <Play aria-hidden="true" size={15} />
            {status === "generating" ? t("正在生成整套物料") : t("生成整套 POP 物料")}
          </button>
        </div>
      </div>

      <div className={styles.materialOverview}>
        <div className={styles.overviewHeader}>
          <h3>{t("选择 POP 模板")} <span>{templateSet.name}</span></h3>
          <p><span className={styles.fixedDot} /> {t("固定模板")} <span className={styles.optionalDot} /> {t("可选方案")} <span aria-live="polite">· {statusLabel}</span></p>
        </div>
        <div className={styles.materialGrid}>
          {templateSet.groups.map((group) => {
            const fixed = group.variants.length === 1;
            const chosenId = selectedByGroup[group.id] ?? group.variants[0].templateId;
            return (
              <section aria-label={group.name} className={styles.materialCard} key={group.id}>
                <div className={styles.materialCardHeader}>
                  <h4>{group.name}</h4>
                  <span className={fixed ? styles.fixedBadge : styles.optionalBadge}>
                    {fixed ? <LockKeyhole aria-hidden="true" size={11} /> : null}
                    {fixed ? t("固定模板") : t("可选方案")}
                  </span>
                  <button aria-label={t("展开编辑 {name}", { name: group.name })} aria-controls="pop-template-editor" aria-expanded={editorOpen && selectedGroup?.id === group.id} className={styles.expandButton} onClick={() => {
                    setSelectedTemplateId(chosenId);
                    setEditorOpen(true);
                    requestAnimationFrame(() => document.getElementById("pop-template-editor")?.scrollIntoView?.({ block: "start" }));
                  }} title={t("展开编辑 {name}", { name: group.name })} type="button">
                    <Maximize2 aria-hidden="true" size={14} />
                  </button>
                </div>
                <div aria-label={t("{name} 方案", { name: group.name })} className={styles.materialVariants} role={fixed ? undefined : "radiogroup"}>
                  {group.variants.map((variant) => {
                    const content = contentByTemplateId[variant.templateId];
                    const svg = namespacePreviewSvg(
                      renderPopFlatSvg({ templateId: variant.templateId, textValues: content?.textValues ?? {}, imageDataUris: content?.imageDataUris ?? {} }),
                      `${previewNamespace}-${variant.templateId}`
                    );
                    return (
                      <label className={`${styles.variantCard} ${chosenId === variant.templateId && !fixed ? styles.variantSelected : ""}`} key={variant.templateId}>
                        {!fixed ? <span className={styles.variantLabel}>
                          {variant.label}
                          <input aria-label={`${group.name} ${variant.label}`} checked={chosenId === variant.templateId} name={`pop-${group.id}`} onChange={() => selectTemplate(variant.templateId)} type="radio" value={variant.templateId} />
                          {chosenId === variant.templateId ? <Check aria-hidden="true" size={11} /> : null}
                        </span> : null}
                        <div aria-hidden="true" className={styles.variantArtwork} dangerouslySetInnerHTML={{ __html: svg }} />
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        {stage ? <p aria-live="polite" className={styles.stage}>{stage}</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </div>

      {materials.length ? <section aria-label={t("整套 POP 物料")} className={styles.result}>
        <div className={styles.resultHeader}><h3>{t("整套物料（{count}）", { count: materials.length })}</h3><span className={styles.resultMode}>{t("本地模板导出")}</span></div>
        <div className={styles.materialResults}>{materials.map((material) => <article key={material.templateId}>
          <img alt={material.name} src={material.pngUrl} />
          <strong>{material.name}</strong>
          <div><a aria-label={t("下载 PNG · {name}", { name: material.name })} download={`${material.templateId}.png`} href={material.pngUrl}>{t("下载 PNG")}</a><a aria-label={t("下载 SVG · {name}", { name: material.name })} download={`${material.templateId}.svg`} href={material.svgUrl}>{t("下载 SVG")}</a></div>
        </article>)}</div>
      </section> : null}

      {editorOpen ? <div className={styles.editorSection} id="pop-template-editor">
      <div className={styles.editorBar}><strong>{t("编辑模板 · {name}", { name: selectedGroup?.name ?? "" })}</strong><button className={styles.resetPlacementButton} onClick={() => setEditorOpen(false)} type="button">{t("收起编辑")}</button></div>
      <div className={styles.workspace}>
        <div className={styles.canvasPane}>
          <div className={styles.canvasHeader}>
            <div className={styles.canvasTitle}>
              <strong>{templateSet.name}</strong>
              <span>
                {selectedGroup?.name ?? "Sticker"} / {selectedTemplate.name}
              </span>
            </div>
            <div className={styles.zoomControls}>
              <button
                aria-label={t("缩小 POP 画布")}
                disabled={canvasZoom <= MIN_CANVAS_ZOOM}
                onClick={() =>
                  setCanvasZoom((current) =>
                    Math.max(MIN_CANVAS_ZOOM, current - CANVAS_ZOOM_STEP)
                  )
                }
                title={t("缩小 POP 画布")}
                type="button"
              >
                <ZoomOut aria-hidden="true" size={17} />
              </button>
              <input
                aria-label={t("POP 画布缩放")}
                max={MAX_CANVAS_ZOOM * 100}
                min={MIN_CANVAS_ZOOM * 100}
                onChange={(event) =>
                  setCanvasZoom(Number(event.target.value) / 100)
                }
                step={CANVAS_ZOOM_STEP * 100}
                type="range"
                value={canvasZoom * 100}
              />
              <output>{Math.round(canvasZoom * 100)}%</output>
              <button
                aria-label={t("放大 POP 画布")}
                disabled={canvasZoom >= MAX_CANVAS_ZOOM}
                onClick={() =>
                  setCanvasZoom((current) =>
                    Math.min(MAX_CANVAS_ZOOM, current + CANVAS_ZOOM_STEP)
                  )
                }
                title={t("放大 POP 画布")}
                type="button"
              >
                <ZoomIn aria-hidden="true" size={17} />
              </button>
            </div>
          </div>
          <div className={styles.canvasViewport}>
            <PopTemplateCanvas
              contentByTemplateId={contentByTemplateId}
              onSelectTemplate={selectTemplate}
              selectedTemplateId={selectedTemplateId}
              templateSet={templateSet}
              zoom={canvasZoom}
            />
          </div>
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <i className={styles.blueSwatch} />
              {t("文字区域")}
            </span>
            <span className={styles.legendItem}>
              <i className={styles.graySwatch} />
              {t("图片区域")}
            </span>
            <span className={styles.legendItem}>
              <i className={styles.selectedSwatch} />
              {t("当前 Sticker")}
            </span>
          </div>
        </div>

        <aside className={styles.inspector}>
          <div className={styles.inspectorHeader}>
            <p>{selectedGroup?.name ?? "Sticker"}</p>
            <h3>{selectedTemplate.name}</h3>
          </div>

          <div className={styles.inspectorFields}>
            <label className={styles.field}>
              {t("当前 Sticker")}
              <select
                aria-label={t("当前 Sticker")}
                onChange={(event) => selectTemplate(event.target.value)}
                value={selectedTemplateId}
              >
                {templateSet.groups.map((group) => (
                  <optgroup key={group.id} label={group.name}>
                    {group.variants.map((variant) => (
                      <option key={variant.templateId} value={variant.templateId}>
                        {variant.label} · {getPopTemplate(variant.templateId).name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            {selectedTemplate.slots.map((slot) =>
              slot.type === "text" ? (
                <label className={styles.field} key={slot.id}>
                  {slot.label}
                  <input
                    maxLength={slot.maxLength}
                    onChange={(event) => updateText(slot.id, event.target.value)}
                    value={selectedDraft.textValues[slot.id] ?? ""}
                  />
                </label>
              ) : (
                <div className={styles.imageControl} key={slot.id}>
                  <label className={styles.field}>
                    {slot.label}
                    <select
                      aria-label={slot.label}
                      onChange={(event) =>
                        assignImage(
                          selectedTemplateId,
                          slot.id,
                          event.target.value
                        )
                      }
                      value={selectedDraft.imageAssetIds[slot.id] ?? ""}
                    >
                      <option value="">{t("灰色占位")}</option>
                      {imageAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.filename}
                          {asset.source === "uploaded" ? t("（已上传）") : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    aria-label={t("上传{label}", { label: slot.label })}
                    className={styles.iconButton}
                    disabled={status === "uploading" || status === "generating"}
                    onClick={() => requestImageUpload(slot.id)}
                    title={t("上传{label}", { label: slot.label })}
                    type="button"
                  >
                    <ImagePlus aria-hidden="true" size={18} />
                  </button>
                </div>
              )
            )}

            <div className={styles.compositorNotice}>
              <Move aria-hidden="true" size={16} />
              {t("在下方产品预览中直接拖动 Sticker，并拖拽右下角控制点调整大小。")}
            </div>
          </div>
        </aside>
      </div>
      </div> : null}

      <StickerProductComposer
        flatSvg={flatSvg}
        key={`${product.id}-${selectedTemplateId}-${effectiveProductAssetId}`}
        productName={product.displayName ?? product.modelName ?? product.id}
        productImageUrl={productPhoto?.url}
        templateName={selectedTemplate.name}
      />
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
          title={t("裁切 {name} 图片", { name: getPopTemplate(pendingCrop.target.templateId).name })}
        />
      ) : null}
    </section>
  );
}


type StickerPlacement = {
  x: number;
  y: number;
  width: number;
};

type StickerDragState = {
  mode: "move" | "resize";
  pointerId: number;
  startClientX: number;
  startClientY: number;
  initial: StickerPlacement;
  aspectRatio: number;
  heightPercent: number;
};

const DEFAULT_STICKER_PLACEMENT: StickerPlacement = {
  x: 55,
  y: 25,
  width: 25
};

function StickerProductComposer({
  flatSvg,
  templateName,
  productName,
  productImageUrl
}: {
  flatSvg: string;
  templateName: string;
  productName: string;
  productImageUrl?: string;
}) {
  const { t } = useI18n();
  const previewNamespace = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [placement, setPlacement] = useState<StickerPlacement>(DEFAULT_STICKER_PLACEMENT);
  const [exportState, setExportState] = useState<"idle" | "exporting" | "done" | "failed">("idle");
  const [exportError, setExportError] = useState("");
  const [exportUrl, setExportUrl] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  const stickerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<StickerDragState | null>(null);
  const exportUrlRef = useRef("");

  useEffect(() => {
    return () => {
      if (exportUrlRef.current) {
        URL.revokeObjectURL(exportUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    clearExport();
  }, [flatSvg]);

  function resetPlacement() {
    setPlacement(DEFAULT_STICKER_PLACEMENT);
    clearExport();
  }

  function clearExport() {
    if (exportUrlRef.current) {
      URL.revokeObjectURL(exportUrlRef.current);
      exportUrlRef.current = "";
    }
    setExportUrl("");
    setExportState("idle");
    setExportError("");
  }

  function beginDrag(
    event: ReactPointerEvent<HTMLElement>,
    mode: StickerDragState["mode"]
  ) {
    const stage = stageRef.current;
    const sticker = stickerRef.current;
    if (!stage || !sticker) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const stageBounds = stage.getBoundingClientRect();
    const stickerBounds = sticker.getBoundingClientRect();
    const heightPercent = (stickerBounds.height / stageBounds.height) * 100;
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      initial: placement,
      aspectRatio: stickerBounds.width / Math.max(1, stickerBounds.height),
      heightPercent
    };
    stage.setPointerCapture(event.pointerId);
    clearExport();
  }

  function updateDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage || drag.pointerId !== event.pointerId) {
      return;
    }

    const bounds = stage.getBoundingClientRect();
    const deltaX = ((event.clientX - drag.startClientX) / bounds.width) * 100;
    const deltaY = ((event.clientY - drag.startClientY) / bounds.height) * 100;

    if (drag.mode === "move") {
      setPlacement({
        ...drag.initial,
        x: clamp(drag.initial.x + deltaX, 0, 100 - drag.initial.width),
        y: clamp(drag.initial.y + deltaY, 0, 100 - drag.heightPercent)
      });
      return;
    }

    const maximumWidth = Math.max(
      8,
      Math.min(
        64,
        100 - drag.initial.x,
        (100 - drag.initial.y) * drag.aspectRatio
      )
    );
    setPlacement({
      ...drag.initial,
      width: clamp(drag.initial.width + deltaX, 8, maximumWidth)
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 5 : 1;
    let next = placement;
    if (event.key === "ArrowLeft") {
      next = { ...placement, x: clamp(placement.x - step, 0, 100 - placement.width) };
    } else if (event.key === "ArrowRight") {
      next = { ...placement, x: clamp(placement.x + step, 0, 100 - placement.width) };
    } else if (event.key === "ArrowUp") {
      next = { ...placement, y: clamp(placement.y - step, 0, 92) };
    } else if (event.key === "ArrowDown") {
      next = { ...placement, y: clamp(placement.y + step, 0, 92) };
    } else {
      return;
    }
    event.preventDefault();
    setPlacement(next);
    clearExport();
  }

  async function exportComposition() {
    if (!productImageUrl) return;
    setExportState("exporting");
    setExportError("");
    const svgUrl = URL.createObjectURL(
      new Blob([flatSvg], { type: "image/svg+xml;charset=utf-8" })
    );

    try {
      const [productImage, stickerImage] = await Promise.all([
        loadImage(productImageUrl),
        loadImage(svgUrl)
      ]);
      const canvas = document.createElement("canvas");
      const productWidth = productImage.naturalWidth || productImage.width;
      const productHeight = productImage.naturalHeight || productImage.height;
      canvas.width = canvas.height = Math.max(productWidth, productHeight);
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("浏览器无法创建贴装画布。");
      }

      context.drawImage(productImage, (canvas.width - productWidth) / 2, (canvas.height - productHeight) / 2, productWidth, productHeight);
      const stickerWidth = (placement.width / 100) * canvas.width;
      const stickerHeight =
        stickerWidth *
        ((stickerImage.naturalHeight || stickerImage.height) /
          Math.max(1, stickerImage.naturalWidth || stickerImage.width));
      context.drawImage(
        stickerImage,
        (placement.x / 100) * canvas.width,
        (placement.y / 100) * canvas.height,
        stickerWidth,
        stickerHeight
      );

      const blob = await canvasToBlob(canvas);
      if (exportUrlRef.current) {
        URL.revokeObjectURL(exportUrlRef.current);
      }
      const nextUrl = URL.createObjectURL(blob);
      exportUrlRef.current = nextUrl;
      setExportUrl(nextUrl);
      setExportState("done");

      const anchor = document.createElement("a");
      anchor.href = nextUrl;
      anchor.download = "midea-pop-sticker-composition.png";
      anchor.click();
    } catch (cause) {
      setExportState("failed");
      setExportError(cause instanceof Error ? cause.message : "贴装图导出失败。");
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  }

  const stickerStyle = {
    left: placement.x + "%",
    top: placement.y + "%",
    width: placement.width + "%"
  } as CSSProperties;
  const displaySvg = namespacePreviewSvg(flatSvg, previewNamespace).replace(
    "<svg ",
    '<svg style="width:100%;height:auto;display:block;pointer-events:none" '
  );

  return (
    <section className={styles.compositorSection} aria-labelledby="pop-compositor-title">
      <div className={styles.compositorHeader}>
        <div>
          <h3 id="pop-compositor-title">{t("产品贴装预览")}</h3>
          <span>{t("{product} · {template} · 本地拖拽合成", { product: productName, template: templateName })}</span>
        </div>
        <div className={styles.compositorActions}>
          <label className={styles.sizeControl}>
            <span>{t("Sticker 大小")}</span>
            <input
              aria-label={t("Sticker 大小")}
              max="64"
              min="8"
              onChange={(event) => {
                setPlacement((current) => ({
                  ...current,
                  width: Number(event.target.value)
                }));
                clearExport();
              }}
              step="1"
              type="range"
              value={placement.width}
            />
            <output>{Math.round(placement.width)}%</output>
          </label>
          <button className={styles.resetPlacementButton} onClick={resetPlacement} type="button">
            <RotateCcw aria-hidden="true" size={15} />
            复位
          </button>
          <button
            className={styles.exportButton}
            disabled={!productImageUrl || exportState === "exporting"}
            onClick={exportComposition}
            type="button"
          >
            <Download aria-hidden="true" size={16} />
            {exportState === "exporting" ? t("正在导出") : t("导出当前贴装图")}
          </button>
        </div>
      </div>

      <div
        className={styles.compositorStage}
        data-testid="pop-product-compositor"
        onPointerCancel={endDrag}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        ref={stageRef}
      >
        {productImageUrl ? <img alt={`${productName} 本地贴装产品图`} draggable={false} src={productImageUrl} /> : <p className={styles.missingPhoto}>当前产品暂无产品图，请先在资产中心补充产品图片。</p>}
        {productImageUrl ? <div
          aria-label={t("可拖动 Sticker")}
          className={styles.stickerOverlay}
          onKeyDown={handleKeyboard}
          onPointerDown={(event) => beginDrag(event, "move")}
          ref={stickerRef}
          role="application"
          style={stickerStyle}
          tabIndex={0}
        >
          <div
            className={styles.stickerArtwork}
            dangerouslySetInnerHTML={{ __html: displaySvg }}
          />
          <button
            aria-label={t("拖动调整 Sticker 大小")}
            className={styles.stickerResizeHandle}
            onPointerDown={(event) => beginDrag(event, "resize")}
            type="button"
          >
            <Maximize2 aria-hidden="true" size={13} />
          </button>
        </div> : null}
      </div>

      <div className={styles.compositorFooter}>
        <span>
          <Move aria-hidden="true" size={15} />
          {t("拖动 Sticker 调整位置；拖动右下角控制点或使用滑杆调整大小。")}
        </span>
        {exportUrl ? (
          <a download="midea-pop-sticker-composition.png" href={exportUrl}>
            <Download aria-hidden="true" size={14} />
            {t("再次下载")}
          </a>
        ) : null}
        {exportError ? <strong>{exportError}</strong> : null}
      </div>
    </section>
  );
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("贴装素材载入失败。"));
    image.src = source;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("贴装图导出失败。"))),
      "image/png"
    );
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Inline SVG fragment references resolve across the document, so each preview needs its own IDs. */
function namespacePreviewSvg(svg: string, namespace: string): string {
  const ids = new Map(Array.from(svg.matchAll(/\bid="([^"]+)"/g), ([, id]) => [id, `pop-${namespace}-${id}`]));
  return svg
    .replace(/\bid="([^"]+)"/g, (_match, id: string) => `id="${ids.get(id)}"`)
    .replace(/url\(#([^)]+)\)/g, (match, id: string) => ids.has(id) ? `url(#${ids.get(id)})` : match);
}
function buildInitialDrafts(): Record<string, PopTemplateDraft> {
  return Object.fromEntries(
    allPopTemplates.map((template) => [
      template.id,
      buildDefaultDraft(template)
    ])
  );
}

function buildDefaultDraft(template: PopTemplate): PopTemplateDraft {
  return {
    textValues: Object.fromEntries(
      template.slots
        .filter((slot) => slot.type === "text")
        .map((slot) => [
          slot.id,
          slot.type === "text" ? slot.defaultValue : ""
        ])
    ),
    imageAssetIds: {}
  };
}

function getPopCropAspectRatio(template: PopTemplate, slotId: string): number {
  const imageSlotCount = template.slots.filter((slot) => slot.type === "image").length;
  if (imageSlotCount > 1 || /Image\d+$/i.test(slotId)) {
    return 1;
  }
  const overrides: Record<string, number> = {
    "main-sticker-usp": 752 / 918,
    "main-sticker-usp-footer": 752 / 918,
    "inner-sticker-display": 1018 / 552,
    "inner-sticker-display-left": 1.25,
    "inner-sticker-display-right": 1.25,
    "side-sticker": 470 / 168,
    "oven-wobbler": 1,
    "oven-body-round": 1,
    "oven-body-strip": 4,
    "oven-body-feature": 2,
    "oven-top-sticker": 1.25
  };
  return overrides[template.id] ?? parseAspectRatio(template.aspectRatio, 1);
}

function dedupeAssets(assets: Asset[]): Asset[] {
  return Array.from(
    new Map(assets.map((asset) => [asset.id, asset])).values()
  );
}

function isRasterImage(asset: Asset): boolean {
  return /\.(png|jpe?g|webp)$/i.test(asset.url);
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function rasterizeSvg(svg: string): Promise<Blob> {
  const blob = new Blob([svg], {
    type: "image/svg+xml;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);

  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Sticker 栅格化失败"));
      image.src = url;
    });

    const canvas = document.createElement("canvas");
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    canvas.width = Math.max(1, width * 2);
    canvas.height = Math.max(1, height * 2);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("浏览器无法创建物料导出画布。");
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}
