"use client";

import { useEffect, useMemo, useState } from "react";
import { Film, LoaderCircle, Play } from "lucide-react";
import {
  DEFAULT_PRODUCT_VIDEO_PROMPT,
  PRODUCT_VIDEO_MODEL_LABEL,
  PRODUCT_VIDEO_OUTPUT
} from "@/src/domain/product-video";
import type { Asset, ProductWithProfile } from "@/src/domain/types";
import { useI18n } from "@/src/i18n/I18nProvider";
import styles from "./ProductVideoStudio.module.css";

type ProductVideoStudioProps = {
  products: ProductWithProfile[];
  pollIntervalMs?: number;
};

type VideoTaskPayload = {
  taskId?: string;
  status?: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  model?: string;
  videoUrl?: string;
  remoteVideoUrl?: string;
  warning?: string;
  error?: string;
};

type UiStatus = "idle" | "submitting" | NonNullable<VideoTaskPayload["status"]>;

export function ProductVideoStudio({
  products,
  pollIntervalMs = 5000
}: ProductVideoStudioProps) {
  const { t } = useI18n();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const selectedProduct = products.find((product) => product.id === productId) ?? products[0];
  const productImages = useMemo(
    () => getProductImages(selectedProduct?.assets ?? []),
    [selectedProduct]
  );
  const [productAssetId, setProductAssetId] = useState(productImages[0]?.id ?? "");
  const [prompt, setPrompt] = useState(DEFAULT_PRODUCT_VIDEO_PROMPT);
  const [status, setStatus] = useState<UiStatus>("idle");
  const [taskId, setTaskId] = useState("");
  const [model, setModel] = useState(PRODUCT_VIDEO_MODEL_LABEL);
  const [videoUrl, setVideoUrl] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setProductAssetId((current) =>
      productImages.some((asset) => asset.id === current) ? current : (productImages[0]?.id ?? "")
    );
  }, [productImages]);

  useEffect(() => {
    if (!taskId) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    function scheduleNextPoll() {
      timer = window.setTimeout(pollTask, pollIntervalMs);
    }

    async function pollTask() {
      try {
        const response = await fetch(`/api/product-video?taskId=${encodeURIComponent(taskId)}`);
        const payload: VideoTaskPayload = await response.json();
        if (!response.ok || payload.error) {
          throw new Error(
          payload.error ?? t("任务查询失败 ({status})", { status: response.status })
        );
        }
        if (cancelled) {
          return;
        }

        const nextStatus = payload.status ?? "running";
        setStatus(nextStatus);
        if (payload.model) {
          setModel(payload.model);
        }
        setVideoUrl(payload.videoUrl ?? "");
        setWarning((current) => payload.warning ?? current);

        if (nextStatus === "failed" || nextStatus === "cancelled") {
          setError(payload.error ?? t("视频生成任务未完成。"));
          return;
        }
        if (nextStatus === "queued" || nextStatus === "running") {
          scheduleNextPoll();
        }
      } catch (cause) {
        if (!cancelled) {
          setStatus("failed");
          setError(cause instanceof Error ? cause.message : t("视频任务查询失败。"));
        }
      }
    }

    scheduleNextPoll();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [pollIntervalMs, taskId]);

  async function createVideo() {
    if (!selectedProduct || !productAssetId) {
      setError(t("请先选择包含产品图片的产品档案。"));
      return;
    }
    if (!prompt.trim()) {
      setError(t("视频提示词不能为空。"));
      return;
    }

    setStatus("submitting");
    setTaskId("");
    setVideoUrl("");
    setWarning("");
    setError("");
    try {
      const response = await fetch("/api/product-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: selectedProduct.id, productAssetId, prompt })
      });
      const payload: VideoTaskPayload = await response.json();
      if (!response.ok || payload.error || !payload.taskId) {
        throw new Error(
          payload.error ?? t("任务创建失败 ({status})", { status: response.status })
        );
      }
      setTaskId(payload.taskId);
      setStatus(payload.status ?? "queued");
      setModel(payload.model ?? PRODUCT_VIDEO_MODEL_LABEL);
      setVideoUrl(payload.videoUrl ?? "");
      setWarning(payload.warning ?? "");
    } catch (cause) {
      setStatus("failed");
      setError(cause instanceof Error ? cause.message : t("产品视频任务创建失败。"));
    }
  }

  const selectedAsset = productImages.find((asset) => asset.id === productAssetId);
  const busy = status === "submitting" || status === "queued" || status === "running";

  return (
    <section className={styles.studio}>
      <div className={styles.toolbar}>
        <label className={styles.field}>
          {t("产品")}
          <select
            aria-label={t("产品")}
            disabled={busy}
            onChange={(event) => setProductId(event.target.value)}
            value={selectedProduct?.id ?? ""}
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.displayName ?? product.modelName ?? product.id}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t("产品参考图")}
          <select
            aria-label={t("产品参考图")}
            disabled={busy || !productImages.length}
            onChange={(event) => setProductAssetId(event.target.value)}
            value={productAssetId}
          >
            {productImages.length ? null : <option value="">{t("暂无产品图片")}</option>}
            {productImages.map((asset) => (
              <option key={asset.id} value={asset.id}>{asset.filename}</option>
            ))}
          </select>
        </label>
        <div className={styles.modelField}>
          <span>{t("视频模型")}</span>
          <strong>{PRODUCT_VIDEO_MODEL_LABEL}</strong>
        </div>
      </div>

      <div className={styles.editorGrid}>
        <div className={styles.referencePane}>
          <div className={styles.paneHeader}>
            <Film aria-hidden="true" size={18} />
            <strong>{t("唯一产品参考")}</strong>
          </div>
          <div className={styles.referenceStage}>
            {selectedAsset ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={selectedAsset.filename}
                className={styles.referenceImage}
                src={selectedAsset.url}
              />
            ) : (
              <a className={styles.emptyLink} href="/assets">{t("到素材库上传产品照片")}</a>
            )}
          </div>
          <dl className={styles.specList}>
            <div><dt>{t("时长")}</dt><dd>{t("{count} 秒", { count: PRODUCT_VIDEO_OUTPUT.durationSeconds })}</dd></div>
            <div><dt>{t("画幅")}</dt><dd>{PRODUCT_VIDEO_OUTPUT.aspectRatio}</dd></div>
            <div><dt>{t("分辨率")}</dt><dd>{PRODUCT_VIDEO_OUTPUT.resolution}</dd></div>
          </dl>
        </div>

        <label className={styles.promptField}>
          <span>{t("视频提示词")}</span>
          <textarea
            aria-label={t("视频提示词")}
            disabled={busy}
            onChange={(event) => setPrompt(event.target.value)}
            spellCheck={false}
            value={prompt}
          />
        </label>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.generateButton}
          data-generate-action="true"
          disabled={busy || !productImages.length || !products.length}
          onClick={createVideo}
          type="button"
        >
          {busy ? <LoaderCircle aria-hidden="true" className={styles.spinner} size={18} /> : <Play aria-hidden="true" size={18} />}
          {busy
            ? statusLabel(status, t)
            : videoUrl
              ? t("重新生成产品视频")
              : t("生成产品视频")}
        </button>
        {taskId ? <span className={styles.taskId}>{t("任务 ID: {id}", { id: taskId })}</span> : null}
        {error ? <span className={styles.error}>{error}</span> : null}
        {warning ? <span className={styles.warning}>{warning}</span> : null}
      </div>

      {videoUrl ? (
        <div className={styles.result}>
          <div className={styles.resultHeader}>
            <strong>Hero Product Film</strong>
            <span>{model}</span>
          </div>
          <video controls playsInline preload="metadata" src={videoUrl} />
          <a href={videoUrl} target="_blank" rel="noreferrer">{t("打开视频文件")}</a>
        </div>
      ) : null}
    </section>
  );
}

function getProductImages(assets: Asset[]): Asset[] {
  return assets.filter((asset) => asset.type === "product-photo" || asset.type === "phone-shot");
}

function statusLabel(status: UiStatus, translate: (key: string) => string): string {
  if (status === "submitting") {
    return translate("正在创建任务");
  }
  if (status === "queued") {
    return translate("任务排队中");
  }
  return translate("视频生成中");
}
