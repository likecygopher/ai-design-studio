"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  Brush,
  CheckCircle2,
  Eraser,
  ExternalLink,
  ImagePlus,
  Loader2,
  MousePointer2,
  Play,
  RefreshCcw,
  Undo2,
  Trash2
} from "lucide-react";
import {
  DEFAULT_IMAGE_MODEL_CHOICE,
  type ImageModelChoice
} from "@/src/domain/generation-models";
import {
  clearEditableMask,
  createEditableMask,
  floodSelectRegion,
  getAspectConstrainedWidth,
  hasMaskSelection,
  paintMaskCircle,
  paintMaskStroke,
  type EditableMask
} from "@/src/domain/sku-mask";
import {
  DEFAULT_SKU_PROMPTS,
  SKU_REPLACEMENT_MODES,
  type SkuReplacementMode
} from "@/src/domain/sku-replacement";
import type { Asset, AssetType, ProductWithProfile } from "@/src/domain/types";
import { ImageModelSelector } from "./ImageModelSelector";
import styles from "./SkuReplacementStudio.module.css";
import { useI18n } from "@/src/i18n/I18nProvider";

const ACCEPTED_IMAGES = "image/png,image/jpeg,image/webp";
const MAX_WORK_WIDTH = 960;
const MAX_WORK_HEIGHT = 680;
const MAX_MASK_HISTORY = 20;

type SkuOutput = {
  id: string;
  mode: SkuReplacementMode;
  url: string;
  model: string;
  prompt: string;
  sourceAssetIds: string[];
  generatedAt: string;
};

type MaskEditorHandle = {
  exportMaskFile: () => Promise<File | null>;
  clear: () => void;
};

type MaskTool = "brush" | "smart" | "eraser";

export function SkuReplacementStudio() {
  const { t } = useI18n();
  const [products, setProducts] = useState<ProductWithProfile[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);

  const [mode, setMode] = useState<SkuReplacementMode>("reference-part");
  const [imageModel, setImageModel] = useState<ImageModelChoice>(DEFAULT_IMAGE_MODEL_CHOICE);
  const [instructions, setInstructions] = useState(DEFAULT_SKU_PROMPTS);
  const [selectionDescriptions, setSelectionDescriptions] = useState({
    color: "顶部银色金属包边和下方把手",
    style: "下方把手"
  });
  const [hasSelection, setHasSelection] = useState(false);
  const [uploadingType, setUploadingType] = useState<AssetType | null>(null);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [output, setOutput] = useState<SkuOutput | null>(null);
  const maskEditorRef = useRef<MaskEditorHandle>(null);

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
      })
      .catch(() => setProductsLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedProduct = products[0];
  const baseAsset = useMemo(() => findBaseAsset(selectedProduct), [selectedProduct]);
  const referenceAsset = useMemo(
    () => findLatestAsset(selectedProduct, "sku-reference-part"),
    [selectedProduct]
  );
  const canGenerate = Boolean(
    selectedProduct &&
      baseAsset &&
      instructions[mode].trim() &&
      (mode === "reference-part" ? referenceAsset : hasSelection)
  );

  async function uploadAsset(file: File, type: AssetType): Promise<Asset | null> {
    if (!selectedProduct) {
      return null;
    }
    setUploadingType(type);
    setMessage("");
    try {
      const form = new FormData();
      form.set("projectId", selectedProduct.projectId);
      form.set("productId", selectedProduct.id);
      form.set("type", type);
      form.append("files", file);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const payload = await response.json();
      const uploaded = payload.assets?.[0] as Asset | undefined;
      if (!response.ok || payload.error || !uploaded) {
        throw new Error(payload.error ?? t("图片上传失败。"));
      }

      const previous = selectedProduct.assets.filter(
        (asset) => asset.type === type && asset.source === "uploaded" && asset.id !== uploaded.id
      );
      await Promise.all(
        previous.map((asset) =>
          fetch(`/api/assets?id=${encodeURIComponent(asset.id)}`, { method: "DELETE" })
        )
      );
      setProducts((current) =>
        current.map((product) =>
          product.id === selectedProduct.id
            ? {
                ...product,
                assets: [...product.assets.filter((asset) => asset.type !== type), uploaded]
              }
            : product
        )
      );
      setOutput(null);
      if (type !== "sku-mask") {
        setMessage(t("已上传：{name}", { name: uploaded.filename }));
      }
      return uploaded;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("图片上传失败。"));
      return null;
    } finally {
      setUploadingType(null);
    }
  }

  async function removeAsset(asset: Asset) {
    if (!selectedProduct || asset.source !== "uploaded") {
      return;
    }
    setUploadingType(asset.type);
    setMessage("");
    try {
      const response = await fetch(`/api/assets?id=${encodeURIComponent(asset.id)}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        throw new Error(t("删除图片失败。"));
      }
      setProducts((current) =>
        current.map((product) =>
          product.id === selectedProduct.id
            ? { ...product, assets: product.assets.filter((item) => item.id !== asset.id) }
            : product
        )
      );
      setOutput(null);
      setMessage(t("图片已移除。"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("删除图片失败。"));
    } finally {
      setUploadingType(null);
    }
  }

  async function generate() {
    if (!selectedProduct || !baseAsset || !canGenerate) {
      return;
    }
    setGenerating(true);
    setMessage("");
    try {
      let maskAssetId = "";
      if (mode !== "reference-part") {
        const maskFile = await maskEditorRef.current?.exportMaskFile();
        if (!maskFile) {
          throw new Error(t("请先在画布中选择需要修改的部件区域。"));
        }
        const maskAsset = await uploadAsset(maskFile, "sku-mask");
        if (!maskAsset) {
          throw new Error(t("选区蒙版上传失败。"));
        }
        maskAssetId = maskAsset.id;
      }

      const { postCapabilityJob } = await import("@/src/platform/client/job-client");
      const payload = await postCapabilityJob<{ output?: SkuOutput }>("/api/sku-replacement", {
        productId: selectedProduct.id,
        mode,
        imageModel,
        baseAssetId: baseAsset.id,
        referenceAssetId: mode === "reference-part" ? referenceAsset?.id : undefined,
        maskAssetId: maskAssetId || undefined,
        selectionDescription:
          mode === "color" || mode === "style" ? selectionDescriptions[mode] : undefined,
        instruction: instructions[mode]
      });
      if (!payload.output) {
        throw new Error(t("SKU 局部替换生成失败。"));
      }
      setOutput(payload.output);
      setMessage(t("局部替换结果已生成。未选区域应与原产品保持一致。"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("SKU 局部替换生成失败。"));
    } finally {
      setGenerating(false);
    }
  }

  if (productsLoaded && products.length === 0) {
    return (
      <section className={styles.emptyState}>
        {t("还没有产品。请先到")} <a href="/products">{t("产品档案")}</a>{" "}
        {t("创建产品，再回到本页上传产品图。")}
      </section>
    );
  }

  return (
    <div className={styles.studio}>
      <section className={styles.controlBand}>
        <div className={styles.taskCopy}>
          <strong>{t("只修改指定部件，整机其余结构、材质、Logo、视角和光影保持不变")}</strong>
        </div>
        <div className={styles.controls}>
          <ImageModelSelector
            className={styles.field}
            disabled={generating}
            onChange={setImageModel}
            value={imageModel}
          />
          <button
            className={styles.generateButton}
            data-generate-action="true"
            disabled={!canGenerate || generating || Boolean(uploadingType)}
            onClick={generate}
            type="button"
          >
            {generating ? (
              <Loader2 aria-hidden className={styles.spinner} size={17} />
            ) : output ? (
              <RefreshCcw aria-hidden size={17} />
            ) : (
              <Play aria-hidden size={17} />
            )}
            {generating ? t("AI 替换中") : output ? t("重新生成") : t("生成替换结果")}
          </button>
        </div>
      </section>

      <div aria-label={t("SKU 替换方式")} className={styles.modeTabs} role="tablist">
        {SKU_REPLACEMENT_MODES.map((item) => (
          <button
            aria-selected={mode === item.id}
            className={mode === item.id ? styles.modeTabActive : styles.modeTab}
            disabled={generating}
            key={item.id}
            onClick={() => {
              if (item.id === mode) {
                return;
              }
              maskEditorRef.current?.clear();
              setHasSelection(false);
              setMode(item.id);
              setOutput(null);
              setMessage("");
            }}
            role="tab"
            type="button"
          >
            <strong>{t(item.label)}</strong>
            <span>{t(item.description)}</span>
          </button>
        ))}
      </div>

      {mode === "reference-part" ? (
        <section className={styles.referenceWorkspace}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>{t("产品图与新部件图")}</h2>
            </div>
            <strong>{baseAsset && referenceAsset ? t("输入已完整") : t("需要 2 张图片")}</strong>
          </div>
          <div className={styles.uploadGrid}>
            <AssetUploadSlot
              asset={baseAsset}
              busy={uploadingType === "sku-product"}
              label={t("image 1 · 产品整机图")}
              onRemove={baseAsset?.type === "sku-product" ? () => removeAsset(baseAsset) : undefined}
              onUpload={(file) => uploadAsset(file, "sku-product")}
              required
              supporting={t("产品完整、视角清楚；可直接使用产品档案中的产品图。")}
            />
            <AssetUploadSlot
              asset={referenceAsset}
              busy={uploadingType === "sku-reference-part"}
              label={t("image 2 · 新配件 / 部件图")}
              onRemove={referenceAsset ? () => removeAsset(referenceAsset) : undefined}
              onUpload={(file) => uploadAsset(file, "sku-reference-part")}
              required
              supporting={t("尽量正对部件拍摄，图标、丝印、材质和边缘清晰可辨。")}
            />
          </div>
          <PromptEditor
            mode={mode}
            onChange={(value) => setInstructions((current) => ({ ...current, [mode]: value }))}
            value={instructions[mode]}
          />
        </section>
      ) : (
        <section className={styles.maskWorkspace}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>{mode === "color" ? t("选择需要改色的部件") : t("选择需要改款的部件")}</h2>
            </div>
            <label className={styles.inlineUpload}>
              {uploadingType === "sku-product" ? (
                <Loader2 aria-hidden className={styles.spinner} size={16} />
              ) : (
                <ImagePlus aria-hidden size={16} />
              )}
              {baseAsset ? t("替换产品图") : t("上传产品图")}
              <input
                accept={ACCEPTED_IMAGES}
                aria-label={t("上传 SKU 产品图")}
                disabled={generating || Boolean(uploadingType)}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void uploadAsset(file, "sku-product");
                  }
                  event.target.value = "";
                }}
                type="file"
              />
            </label>
          </div>
          <div className={styles.maskLayout}>
            <SkuMaskEditor
              asset={baseAsset}
              disabled={generating || Boolean(uploadingType)}
              onSelectionChange={setHasSelection}
              ref={maskEditorRef}
            />
            <aside className={styles.promptPanel}>
              <label className={styles.textField}>
                {t("选中部件说明")}
                <input
                  disabled={generating}
                  onChange={(event) =>
                    setSelectionDescriptions((current) => ({
                      ...current,
                      [mode]: event.target.value
                    }))
                  }
                  placeholder={t("例如：顶部金属包边和下方把手")}
                  value={selectionDescriptions[mode]}
                />
              </label>
              <PromptEditor
                compact
                mode={mode}
                onChange={(value) =>
                  setInstructions((current) => ({ ...current, [mode]: value }))
                }
                value={instructions[mode]}
              />
              <div className={hasSelection ? styles.selectionReady : styles.selectionMissing}>
                {hasSelection ? (
                  <CheckCircle2 aria-hidden size={17} />
                ) : (
                  <MousePointer2 aria-hidden size={17} />
                )}
                {hasSelection ? t("选区已准备") : t("请在左侧画布选择部件")}
              </div>
            </aside>
          </div>
        </section>
      )}

      {message ? <p className={styles.message}>{message}</p> : null}

      {output ? (
        <section className={styles.resultSection}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>{t("SKU 局部替换结果")}</h2>
              <p>{t(SKU_REPLACEMENT_MODES.find((item) => item.id === output.mode)?.label ?? "")}</p>
            </div>
            <span>{output.model}</span>
          </div>
          <div className={styles.resultLayout}>
            <div className={styles.resultImage}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt={t("SKU 局部替换结果")} src={output.url} />
            </div>
            <div className={styles.resultMeta}>
              <CheckCircle2 aria-hidden color="#0049bb" size={20} />
              <strong>{t("AI 图像编辑完成")}</strong>
              <span>{new Date(output.generatedAt).toLocaleString()}</span>
              <a href={output.url} target="_blank">
                <ExternalLink aria-hidden size={15} />
                {t("打开原图")}
              </a>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function AssetUploadSlot({
  asset,
  busy,
  label,
  onRemove,
  onUpload,
  required,
  supporting
}: {
  asset?: Asset;
  busy: boolean;
  label: string;
  onRemove?: () => void;
  onUpload: (file: File) => void | Promise<unknown>;
  required?: boolean;
  supporting: string;
}) {
  const { t } = useI18n();
  return (
    <article className={styles.uploadSlot}>
      <div className={styles.slotHeader}>
        <strong>{label}</strong>
        {required ? <span>{t("必填")}</span> : null}
      </div>
      <div className={styles.slotPreview}>
        {asset ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={label} src={asset.url} />
        ) : (
          <div className={styles.slotPlaceholder}>
            <ImagePlus aria-hidden size={30} />
            <span>{t("等待上传")}</span>
          </div>
        )}
      </div>
      <p>{supporting}</p>
      <div className={styles.slotActions}>
        <label className={styles.uploadButton}>
          {busy ? <Loader2 aria-hidden className={styles.spinner} size={16} /> : <ImagePlus aria-hidden size={16} />}
          {asset ? t("替换图片") : t("上传图片")}
          <input
            accept={ACCEPTED_IMAGES}
            aria-label={t("上传{label}", { label })}
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void onUpload(file);
              }
              event.target.value = "";
            }}
            type="file"
          />
        </label>
        {onRemove ? (
          <button aria-label={t("删除{label}", { label })} onClick={onRemove} title={t("删除{label}", { label })} type="button">
            <Trash2 aria-hidden size={16} />
          </button>
        ) : null}
      </div>
      {asset ? <small title={asset.filename}>{asset.filename}</small> : null}
    </article>
  );
}

function PromptEditor({
  compact = false,
  mode,
  onChange,
  value
}: {
  compact?: boolean;
  mode: SkuReplacementMode;
  onChange: (value: string) => void;
  value: string;
}) {
  const { t } = useI18n();
  return (
    <label className={compact ? styles.promptEditorCompact : styles.promptEditor}>
      {mode === "color"
        ? t("颜色 / 材质替换要求")
        : mode === "style"
          ? t("局部样式替换要求")
          : t("部件替换要求")}
      <textarea
        aria-label={t("SKU 局部替换提示词")}
        onChange={(event) => onChange(event.target.value)}
        rows={compact ? 10 : 6}
        value={value}
      />
    </label>
  );
}

const SkuMaskEditor = forwardRef<MaskEditorHandle, {
  asset?: Asset;
  disabled: boolean;
  onSelectionChange: (selected: boolean) => void;
}>(function SkuMaskEditor({ asset, disabled, onSelectionChange }, ref) {
  const { t } = useI18n();
  const [tool, setTool] = useState<MaskTool>("smart");
  const [brushSize, setBrushSize] = useState(34);
  const [tolerance, setTolerance] = useState(38);
  const [mask, setMask] = useState<EditableMask | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 960, height: 640 });
  const [naturalSize, setNaturalSize] = useState({ width: 960, height: 640 });
  const [loadError, setLoadError] = useState("");
  const [historyDepth, setHistoryDepth] = useState(0);
  const canvasDisplayMaxWidth = getAspectConstrainedWidth(
    canvasSize.width,
    canvasSize.height,
    MAX_WORK_HEIGHT
  );
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sourcePixelsRef = useRef<Uint8ClampedArray | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const historyRef = useRef<EditableMask[]>([]);

  useEffect(() => {
    onSelectionChange(mask ? hasMaskSelection(mask) : false);
  }, [mask, onSelectionChange]);

  useEffect(() => {
    setMask(null);
    historyRef.current = [];
    setHistoryDepth(0);
    sourcePixelsRef.current = null;
    setLoadError("");
    if (!asset) {
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const scale = Math.min(1, MAX_WORK_WIDTH / image.naturalWidth, MAX_WORK_HEIGHT / image.naturalHeight);
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const analysis = document.createElement("canvas");
      analysis.width = width;
      analysis.height = height;
      const context = analysis.getContext("2d", { willReadFrequently: true });
      if (!context) {
        setLoadError(t("浏览器无法创建图像选区画布。"));
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      sourcePixelsRef.current = context.getImageData(0, 0, width, height).data;
      setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
      setCanvasSize({ width, height });
      setMask(createEditableMask(width, height));
    };
    image.onerror = () => setLoadError(t("产品图片载入失败，请重新上传。"));
    image.src = asset.url;
  }, [asset]);

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !mask) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const overlay = context.createImageData(mask.width, mask.height);
    for (let index = 0; index < mask.values.length; index += 1) {
      if (mask.values[index] === 0) {
        continue;
      }
      const offset = index * 4;
      overlay.data[offset] = 0;
      overlay.data[offset + 1] = 157;
      overlay.data[offset + 2] = 204;
      overlay.data[offset + 3] = 118;
    }
    context.clearRect(0, 0, mask.width, mask.height);
    context.putImageData(overlay, 0, 0);
  }, [mask]);

  useImperativeHandle(ref, () => ({
    clear() {
      historyRef.current = [];
      setHistoryDepth(0);
      setMask((current) => (current ? clearEditableMask(current) : current));
    },
    async exportMaskFile() {
      if (!mask || !hasMaskSelection(mask)) {
        return null;
      }
      const working = document.createElement("canvas");
      working.width = mask.width;
      working.height = mask.height;
      const context = working.getContext("2d");
      if (!context) {
        throw new Error(t("无法导出选区蒙版。"));
      }
      const pixels = context.createImageData(mask.width, mask.height);
      for (let index = 0; index < mask.values.length; index += 1) {
        const offset = index * 4;
        const selected = mask.values[index] > 0;
        pixels.data[offset] = 255;
        pixels.data[offset + 1] = 255;
        pixels.data[offset + 2] = 255;
        pixels.data[offset + 3] = selected ? 0 : 255;
      }
      context.putImageData(pixels, 0, 0);

      const output = document.createElement("canvas");
      output.width = naturalSize.width;
      output.height = naturalSize.height;
      const outputContext = output.getContext("2d");
      if (!outputContext) {
        throw new Error(t("无法导出原始尺寸选区蒙版。"));
      }
      outputContext.imageSmoothingEnabled = false;
      outputContext.drawImage(working, 0, 0, output.width, output.height);
      const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png"));
      return blob ? new File([blob], `sku-mask-${Date.now()}.png`, { type: "image/png" }) : null;
    }
  }), [mask, naturalSize]);

  function pointerPosition(event: ReactPointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvasSize.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvasSize.height
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled || !mask) {
      return;
    }
    const point = pointerPosition(event);
    if (tool === "smart") {
      const pixels = sourcePixelsRef.current;
      if (pixels) {
        applyMaskOperation((current) =>
          floodSelectRegion(current, pixels, point.x, point.y, tolerance)
        );
      }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = point;
    rememberMask(mask);
    setMask(paintMaskCircle(mask, point.x, point.y, brushSize / 2, tool === "brush"));
  }

  function rememberMask(current: EditableMask) {
    historyRef.current = [...historyRef.current.slice(-(MAX_MASK_HISTORY - 1)), current];
    setHistoryDepth(historyRef.current.length);
  }

  function applyMaskOperation(operation: (current: EditableMask) => EditableMask) {
    if (!mask) {
      return;
    }
    rememberMask(mask);
    setMask(operation(mask));
  }

  function undoMaskOperation() {
    const previous = historyRef.current.pop();
    if (!previous) {
      return;
    }
    setHistoryDepth(historyRef.current.length);
    setMask(previous);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled || tool === "smart") {
      return;
    }
    const point = pointerPosition(event);
    const previous = lastPointRef.current ?? point;
    setMask((current) =>
      current
        ? paintMaskStroke(
            current,
            previous.x,
            previous.y,
            point.x,
            point.y,
            brushSize / 2,
            tool === "brush"
          )
        : current
    );
    lastPointRef.current = point;
  }

  function endDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div className={styles.maskEditor}>
      <div className={styles.maskToolbar}>
        <div className={styles.toolGroup} aria-label={t("选区工具")}>
          <ToolButton active={tool === "smart"} icon={<MousePointer2 size={17} />} label={t("智能选区")} onClick={() => setTool("smart")} />
          <ToolButton active={tool === "brush"} icon={<Brush size={17} />} label={t("画笔")} onClick={() => setTool("brush")} />
          <ToolButton active={tool === "eraser"} icon={<Eraser size={17} />} label={t("橡皮")} onClick={() => setTool("eraser")} />
          <button
            aria-label={t("撤销上一步")}
            className={styles.iconButton}
            disabled={disabled || historyDepth === 0}
            onClick={undoMaskOperation}
            title={t("撤销上一步")}
            type="button"
          >
            <Undo2 aria-hidden size={17} />
          </button>
          <button
            aria-label={t("清空选区")}
            className={styles.iconButton}
            disabled={disabled || !mask || !hasMaskSelection(mask)}
            onClick={() => applyMaskOperation(clearEditableMask)}
            title={t("清空选区")}
            type="button"
          >
            <Trash2 aria-hidden size={17} />
          </button>
        </div>
        {tool === "smart" ? (
          <label className={styles.sliderField}>
            {t("识别容差")}
            <input
              aria-label={t("智能选区识别容差")}
              disabled={disabled}
              max="80"
              min="8"
              onChange={(event) => setTolerance(Number(event.target.value))}
              type="range"
              value={tolerance}
            />
            <span>{tolerance}</span>
          </label>
        ) : (
          <label className={styles.sliderField}>
            {t("笔刷大小")}
            <input
              aria-label={t("选区笔刷大小")}
              disabled={disabled}
              max="96"
              min="6"
              onChange={(event) => setBrushSize(Number(event.target.value))}
              type="range"
              value={brushSize}
            />
            <span>{brushSize}</span>
          </label>
        )}
      </div>
      <div
        className={styles.canvasStage}
        style={{
          aspectRatio: `${canvasSize.width} / ${canvasSize.height}`,
          maxWidth: `${canvasDisplayMaxWidth}px`
        }}
      >
        {asset && mask ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={t("SKU 产品选区底图")} draggable={false} src={asset.url} />
            <canvas
              aria-label={t("SKU 部件选区画布")}
              className={tool === "smart" ? styles.smartCursor : styles.brushCursor}
              height={canvasSize.height}
              onPointerCancel={endDrawing}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrawing}
              ref={overlayRef}
              width={canvasSize.width}
            />
          </>
        ) : (
          <div className={styles.canvasPlaceholder}>
            {asset ? (
              <Loader2 aria-hidden className={styles.spinner} size={28} />
            ) : (
              <ImagePlus aria-hidden size={34} />
            )}
            <strong>{asset ? t("正在读取图片尺寸") : t("请先上传产品图")}</strong>
          </div>
        )}
        {loadError ? <div className={styles.canvasError}>{loadError}</div> : null}
      </div>
      <p className={styles.canvasStatus}>
        {t("蓝色覆盖区域将被允许修改；未覆盖区域由蒙版严格保护。")}
      </p>
    </div>
  );
});

function ToolButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={active ? styles.toolButtonActive : styles.toolButton}
      onClick={onClick}
      title={label}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function findLatestAsset(
  product: ProductWithProfile | undefined,
  type: AssetType
): Asset | undefined {
  return product ? [...product.assets].reverse().find((asset) => asset.type === type) : undefined;
}

function findBaseAsset(product: ProductWithProfile | undefined): Asset | undefined {
  if (!product) {
    return undefined;
  }
  return (
    findLatestAsset(product, "sku-product") ??
    [...product.assets]
      .reverse()
      .find((asset) => asset.type === "product-photo" || asset.type === "phone-shot")
  );
}
