"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  ImagePlus,
  Loader2,
  Play,
  RefreshCcw,
  Sparkles,
  Trash2
} from "lucide-react";
import {
  ICON_DESIGN_VARIANTS,
  type IconDesignVariant,
  type IconDesignVariantId
} from "@/src/domain/icon-design";
import {
  DEFAULT_IMAGE_MODEL_CHOICE,
  type ImageModelChoice
} from "@/src/domain/generation-models";
import type { Asset, AssetType } from "@/src/domain/types";
import { mapWithConcurrency } from "@/src/lib/concurrency";
import { useI18n } from "@/src/i18n/I18nProvider";
import { ImageModelSelector } from "./ImageModelSelector";
import styles from "./IconDesignStudio.module.css";

const PROJECT_ID = "project-icon-design";
const PRODUCT_ID = "icon-design-workspace";
const CLIENT_CONCURRENCY = 3;

type UploadSlotId = "sourceIcon";

type UploadSlot = {
  id: UploadSlotId;
  label: string;
  caption: string;
  assetType: AssetType;
};

const UPLOAD_SLOTS: UploadSlot[] = [
  {
    id: "sourceIcon",
    label: "待规范化 Icon",
    caption: "Image 1",
    assetType: "icon-source"
  }
];

type IconDesignOutput = {
  id: string;
  variantId: IconDesignVariantId;
  label: string;
  group: "color" | "layout";
  size: string;
  url: string;
  model: string;
  prompt: string;
  sourceAssetIds: string[];
  generatedAt: string;
};

type RunState = {
  state: "idle" | "running" | "done" | "failed";
  completed: number;
  total: number;
  outputs: IconDesignOutput[];
  error?: string;
};

const initialRunState: RunState = {
  state: "idle",
  completed: 0,
  total: 0,
  outputs: []
};

export function IconDesignStudio() {
  const { t } = useI18n();
  const [assets, setAssets] = useState<Partial<Record<UploadSlotId, Asset>>>({});
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [uploading, setUploading] = useState<UploadSlotId | null>(null);

  const [imageModel, setImageModel] = useState<ImageModelChoice>(DEFAULT_IMAGE_MODEL_CHOICE);
  const [featureTitle, setFeatureTitle] = useState("Twin Crispers");
  const [message, setMessage] = useState("");
  const [run, setRun] = useState<RunState>(initialRunState);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/upload")
      .then((response) => (response.ok ? response.json() : { assets: [] }))
      .then((payload) => {
        if (cancelled || !Array.isArray(payload.assets)) {
          return;
        }
        const workspaceAssets = (payload.assets as Asset[]).filter(
          (asset) => asset.productId === PRODUCT_ID
        );
        const restored: Partial<Record<UploadSlotId, Asset>> = {};
        for (const slot of UPLOAD_SLOTS) {
          restored[slot.id] = [...workspaceAssets]
            .reverse()
            .find((asset) => asset.type === slot.assetType);
        }
        setAssets(restored);
      })
      .catch(() => setMessage(t("无法读取已上传的 Icon Design 素材。")))
      .finally(() => setAssetsLoaded(true));

    return () => {
      cancelled = true;
    };
  }, []);

  const ready = Boolean(assets.sourceIcon && featureTitle.trim());
  const isBusy = uploading !== null || run.state === "running";
  const progressPercent = run.total ? Math.round((run.completed / run.total) * 100) : 0;
  const outputsByVariant = useMemo(
    () => new Map(run.outputs.map((output) => [output.variantId, output])),
    [run.outputs]
  );

  async function uploadAsset(slot: UploadSlot, file: File) {
    const previous = assets[slot.id];
    setUploading(slot.id);
    setMessage("");
    try {
      const form = new FormData();
      form.set("projectId", PROJECT_ID);
      form.set("productId", PRODUCT_ID);
      form.set("type", slot.assetType);
      form.append("files", file);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const payload = await response.json();
      const uploaded = payload.assets?.[0] as Asset | undefined;
      if (!response.ok || payload.error || !uploaded) {
        throw new Error(payload.error ?? t("上传失败"));
      }

      if (previous?.source === "uploaded") {
        await fetch(`/api/assets?id=${encodeURIComponent(previous.id)}`, { method: "DELETE" });
      }
      setAssets((current) => ({ ...current, [slot.id]: uploaded }));
      setRun(initialRunState);
      setMessage(t("{label}已上传：{name}", { label: t(slot.label), name: uploaded.filename }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("上传失败"));
    } finally {
      setUploading(null);
    }
  }

  async function removeAsset(slot: UploadSlot) {
    const asset = assets[slot.id];
    if (!asset) {
      return;
    }
    setUploading(slot.id);
    setMessage("");
    try {
      const response = await fetch(`/api/assets?id=${encodeURIComponent(asset.id)}`, {
        method: "DELETE"
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? t("删除素材失败"));
      }
      setAssets((current) => ({ ...current, [slot.id]: undefined }));
      setRun(initialRunState);
      setMessage(t("{label}已移除", { label: t(slot.label) }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("删除素材失败"));
    } finally {
      setUploading(null);
    }
  }

  async function generateAll() {
    if (!ready || !assets.sourceIcon) {
      return;
    }
    const sourceIcon = assets.sourceIcon;

    setRun({ state: "running", completed: 0, total: ICON_DESIGN_VARIANTS.length, outputs: [] });
    setMessage("");
    const errors: string[] = [];

    await mapWithConcurrency(ICON_DESIGN_VARIANTS, CLIENT_CONCURRENCY, async (variant) => {
      try {
        const response = await fetch("/api/icon-design/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            variantId: variant.id,
            sourceIconAssetId: sourceIcon.id,
            featureTitle: featureTitle.trim(),
            imageModel
          })
        });
        const payload = await response.json();
        if (!response.ok || payload.error || !payload.output) {
          throw new Error(payload.error ?? t("{label}生成失败", { label: t(variant.label) }));
        }
        setRun((current) => ({
          ...current,
          completed: current.completed + 1,
          outputs: sortOutputs([...current.outputs, payload.output as IconDesignOutput])
        }));
      } catch (error) {
        errors.push(
          `${t(variant.label)}: ${error instanceof Error ? error.message : t("生成失败")}`
        );
        setRun((current) => ({ ...current, completed: current.completed + 1 }));
      }
    });

    setRun((current) => ({
      ...current,
      state: errors.length ? "failed" : "done",
      error: errors.length ? errors.join("；") : undefined
    }));
  }

  return (
    <div className={styles.studio}>
      <section className={styles.controlBand}>
        <div className={styles.controlCopy}>
          <strong>{t("4 种官方颜色 · 2 种版式")}</strong>
        </div>
        <div className={styles.controls}>
          <ImageModelSelector
            className={styles.modelField}
            disabled={isBusy}
            onChange={setImageModel}
            value={imageModel}
          />
          <button
            className={styles.primaryButton}
            data-generate-action="true"
            disabled={!ready || isBusy}
            onClick={generateAll}
            type="button"
          >
            {run.state === "running" ? (
              <Loader2 aria-hidden className={styles.spinner} size={17} />
            ) : run.outputs.length ? (
              <RefreshCcw aria-hidden size={17} />
            ) : (
              <Play aria-hidden size={17} />
            )}
            {run.state === "running"
              ? t("生成中 {done}/{total}", { done: run.completed, total: run.total })
              : run.outputs.length
                ? t("重新生成 6 个版本")
                : t("生成全部 6 个版本")}
          </button>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="content-heading">
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.step}>01</span>
            <h2 id="content-heading">{t("待规范化 Icon 与卖点")}</h2>
          </div>
        </div>
        <div className={styles.contentGrid}>
          <UploadAssetSlot
            asset={assets.sourceIcon}
            busy={isBusy}
            loading={uploading === "sourceIcon"}
            onRemove={() => removeAsset(UPLOAD_SLOTS[0])}
            onUpload={(file) => uploadAsset(UPLOAD_SLOTS[0], file)}
            slot={UPLOAD_SLOTS[0]}
          />
          <label className={styles.titleField}>
            卖点标题
            <input
              aria-label={t("卖点标题")}
              disabled={isBusy}
              maxLength={80}
              onChange={(event) => {
                setFeatureTitle(event.target.value);
                setRun(initialRunState);
              }}
              placeholder="Twin Crispers"
              value={featureTitle}
            />
            <span>{featureTitle.trim().length}/80</span>
          </label>
        </div>
      </section>

      {message ? <p className={styles.message}>{message}</p> : null}
      {!assetsLoaded ? <p className={styles.message}>{t("正在读取 Icon Design 素材…")}</p> : null}

      {run.state === "running" ? (
        <section aria-label={t("生成进度")} className={styles.progressBand}>
          <div>
            <Sparkles aria-hidden size={18} />
            <strong>{t("正在并行生成 {done}/{total}", { done: run.completed, total: run.total })}</strong>
          </div>
          <div className={styles.progressTrack}>
            <div style={{ width: `${progressPercent}%` }} />
          </div>
        </section>
      ) : null}
      {run.error ? <section className={styles.error}>{t("部分输出失败：")}{run.error}</section> : null}

      <section className={styles.results} aria-labelledby="result-heading">
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.step}>02</span>
            <h2 id="result-heading">{t("规范化输出")}</h2>
          </div>
          <span className={styles.resultCount}>{t("{done}/6 已生成", { done: run.outputs.length })}</span>
        </div>
        <OutputGroup
          outputsByVariant={outputsByVariant}
          title={t("官方颜色样式")}
          variants={ICON_DESIGN_VARIANTS.filter((variant) => variant.group === "color")}
        />
        <OutputGroup
          outputsByVariant={outputsByVariant}
          title={t("官方图文版式")}
          variants={ICON_DESIGN_VARIANTS.filter((variant) => variant.group === "layout")}
        />
      </section>
    </div>
  );
}

function UploadAssetSlot(props: {
  slot: UploadSlot;
  asset?: Asset;
  busy: boolean;
  loading: boolean;
  onUpload(file: File): void;
  onRemove(): void;
}) {
  const { t } = useI18n();
  const { slot, asset, busy, loading, onUpload, onRemove } = props;
  return (
    <article className={styles.uploadSlot}>
      <header>
        <div>
          <span>{slot.caption}</span>
          <strong>{t(slot.label)}</strong>
        </div>
        {asset ? (
          <button
            aria-label={t("删除{label}", { label: t(slot.label) })}
            className={styles.iconButton}
            disabled={busy}
            onClick={onRemove}
            title={t("删除{label}", { label: t(slot.label) })}
            type="button"
          >
            <Trash2 aria-hidden size={16} />
          </button>
        ) : null}
      </header>
      <div className={styles.assetPreview}>
        {asset ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={t(slot.label)} src={asset.url} />
        ) : (
          <div className={styles.emptyPreview}>
            <ImagePlus aria-hidden size={28} />
            <span>PNG / JPG / WebP</span>
          </div>
        )}
      </div>
      <footer>
        <span title={asset?.filename}>{asset?.filename ?? t("未上传")}</span>
        <label className={styles.uploadButton}>
          {loading ? (
            <Loader2 aria-hidden className={styles.spinner} size={15} />
          ) : (
            <ImagePlus aria-hidden size={15} />
          )}
          {asset ? t("替换") : t("上传")}
          <input
            accept="image/png,image/jpeg,image/webp"
            aria-label={t("上传{label}", { label: t(slot.label) })}
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                onUpload(file);
              }
              event.target.value = "";
            }}
            type="file"
          />
        </label>
      </footer>
    </article>
  );
}

function OutputGroup(props: {
  title: string;
  variants: IconDesignVariant[];
  outputsByVariant: Map<IconDesignVariantId, IconDesignOutput>;
}) {
  return (
    <div className={styles.outputGroup}>
      <h3>{props.title}</h3>
      <div className={props.variants[0]?.group === "layout" ? styles.layoutGrid : styles.colorGrid}>
        {props.variants.map((variant) => (
          <OutputCard
            key={variant.id}
            output={props.outputsByVariant.get(variant.id)}
            variant={variant}
          />
        ))}
      </div>
    </div>
  );
}

function OutputCard({
  variant,
  output
}: {
  variant: IconDesignVariant;
  output?: IconDesignOutput;
}) {
  const { t } = useI18n();
  return (
    <article className={styles.outputCard}>
      <div
        className={styles.outputPreview}
        data-aspect={variant.size === "1536x1024" ? "wide" : "square"}
      >
        {output ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={t(variant.label)} src={output.url} />
        ) : (
          <div className={styles.outputPlaceholder}>
            <span>{variant.id.replaceAll("-", " ")}</span>
          </div>
        )}
      </div>
      <div className={styles.outputMeta}>
        <div>
          {output ? <CheckCircle2 aria-hidden color="#0049bb" size={16} /> : null}
          <strong>{t(variant.label)}</strong>
        </div>
        <p>{variant.description}</p>
        {output ? (
          <>
            <span>{output.model}</span>
            <a href={output.url} rel="noreferrer" target="_blank">
              <ExternalLink aria-hidden size={14} /> {t("打开原图")}
            </a>
          </>
        ) : null}
      </div>
    </article>
  );
}

function sortOutputs(outputs: IconDesignOutput[]): IconDesignOutput[] {
  const order = ICON_DESIGN_VARIANTS.map((variant) => variant.id);
  return outputs.sort((left, right) => order.indexOf(left.variantId) - order.indexOf(right.variantId));
}