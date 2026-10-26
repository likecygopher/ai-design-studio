"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  ImagePlus,
  Loader2,
  Play,
  RefreshCcw,
  Trash2
} from "lucide-react";
import { getCompetitionTaskSpec } from "@/src/domain/competition-tasks";
import { PHONE_STANDARDIZATION_ANGLES } from "@/src/domain/phone-standardization";
import {
  DEFAULT_IMAGE_MODEL_CHOICE,
  type ImageModelChoice
} from "@/src/domain/generation-models";
import type { Asset, ProductWithProfile } from "@/src/domain/types";
import { mapWithConcurrency } from "@/src/lib/concurrency";
import type { CompetitionOutputArtifact } from "@/src/services/competition-runner";
import { useI18n } from "@/src/i18n/I18nProvider";
import { ImageModelSelector } from "./ImageModelSelector";
import styles from "./PhoneStandardizeRunner.module.css";

const TASK_ID = "task1-phone-to-studio-6" as const;
const CLIENT_CONCURRENCY = 3;

type RunState = {
  state: "idle" | "running" | "done" | "failed";
  completed: number;
  outputs: CompetitionOutputArtifact[];
  error?: string;
};

const initialRunState: RunState = {
  state: "idle",
  completed: 0,
  outputs: []
};

export function PhoneStandardizeRunner() {
  const { t } = useI18n();
  const task = getCompetitionTaskSpec(TASK_ID);
  const [products, setProducts] = useState<ProductWithProfile[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);

  const [imageModel, setImageModel] = useState<ImageModelChoice>(DEFAULT_IMAGE_MODEL_CHOICE);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [run, setRun] = useState<RunState>(initialRunState);

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
  const sourceAsset = useMemo(
    () => selectedProduct ? findLatestPhoneShot(selectedProduct) : undefined,
    [selectedProduct]
  );
  const progressPercent = Math.round((run.completed / task.outputs.length) * 100);

  async function uploadSource(file: File) {
    if (!selectedProduct) {
      return;
    }

    const previousAssets = selectedProduct.assets.filter(
      (asset) => asset.type === "phone-shot" && asset.source === "uploaded"
    );
    setUploading(true);
    setMessage("");

    try {
      const form = new FormData();
      form.set("projectId", selectedProduct.projectId);
      form.set("productId", selectedProduct.id);
      form.set("type", "phone-shot");
      form.append("files", file);

      const response = await fetch("/api/upload", { method: "POST", body: form });
      const payload = await response.json();
      const uploaded = payload.assets?.[0] as Asset | undefined;

      if (!response.ok || payload.error || !uploaded) {
        throw new Error(payload.error ?? t("上传失败"));
      }

      await Promise.all(
        previousAssets.map((asset) =>
          fetch(`/api/assets?id=${encodeURIComponent(asset.id)}`, { method: "DELETE" })
        )
      );

      setProducts((current) =>
        current.map((product) =>
          product.id === selectedProduct.id
            ? {
                ...product,
                assets: [
                  ...product.assets.filter((asset) => asset.type !== "phone-shot"),
                  uploaded
                ]
              }
            : product
        )
      );
      setRun(initialRunState);
      setMessage(t("手机图已上传：{name}", { name: uploaded.filename }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("上传失败"));
    } finally {
      setUploading(false);
    }
  }

  async function removeSource() {
    if (!selectedProduct || !sourceAsset || sourceAsset.source !== "uploaded") {
      return;
    }

    setUploading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/assets?id=${encodeURIComponent(sourceAsset.id)}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        throw new Error(t("删除素材失败"));
      }
      setProducts((current) =>
        current.map((product) =>
          product.id === selectedProduct.id
            ? {
                ...product,
                assets: product.assets.filter((asset) => asset.id !== sourceAsset.id)
              }
            : product
        )
      );
      setRun(initialRunState);
      setMessage(t("手机图已移除"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("删除素材失败"));
    } finally {
      setUploading(false);
    }
  }

  async function generate() {
    if (!selectedProduct || !sourceAsset) {
      return;
    }

    setRun({ state: "running", completed: 0, outputs: [] });
    setMessage("");
    const errors: string[] = [];

    await mapWithConcurrency(task.outputs, CLIENT_CONCURRENCY, async (spec) => {
      try {
        const response = await fetch("/api/competition/run-output", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: TASK_ID,
            outputId: spec.id,
            productId: selectedProduct.id,
            imageModel,
            sourceAssetId: sourceAsset.id
          })
        });
        const payload = await response.json();
        if (!response.ok || payload.error) {
          throw new Error(payload.error ?? `Request failed with ${response.status}`);
        }

        setRun((current) => ({
          ...current,
          completed: current.completed + 1,
          outputs: sortOutputs([
            ...current.outputs,
            payload.output as CompetitionOutputArtifact
          ])
        }));
      } catch (error) {
        errors.push(
          `${spec.label}: ${error instanceof Error ? error.message : t("生成失败")}`
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

  if (productsLoaded && products.length === 0) {
    return (
      <section className={styles.emptyState}>
        {t("还没有产品。请先到")} <a href="/assets">{t("素材库")}</a>{" "}
        {t("创建产品，再回到本页上传手机拍摄图。")}
      </section>
    );
  }

  return (
    <div className={styles.runner}>
      <section className={styles.controlBand}>
        <div className={styles.taskCopy}>
          <strong>{t(task.requirement)}</strong>
          <span>{t(task.summary)}</span>
        </div>
        <div className={styles.controls}>
          <ImageModelSelector
            className={styles.field}
            disabled={run.state === "running"}
            onChange={setImageModel}
            value={imageModel}
          />
          <button
            className={styles.generateButton}
            data-generate-action="true"
            disabled={!selectedProduct || !sourceAsset || uploading || run.state === "running"}
            onClick={generate}
            type="button"
          >
            {run.state === "running" ? (
              <Loader2 aria-hidden className={styles.spinner} size={17} />
            ) : run.state === "done" ? (
              <RefreshCcw aria-hidden size={17} />
            ) : (
              <Play aria-hidden size={17} />
            )}
            {run.state === "running"
              ? t("生成中 {done}/3", { done: run.completed })
              : run.state === "done"
                ? t("重新生成 3 张标准图")
                : t("生成 3 张标准图")}
          </button>
        </div>
      </section>

      <section className={styles.sourceSection} aria-labelledby="phone-source-heading">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="phone-source-heading">{t("手机拍摄图 / 非标准产品图")}</h2>
          </div>
          <strong>
            {sourceAsset ? t("已准备 · 将生成 3 张") : t("等待上传")}
          </strong>
        </div>

        <div className={styles.sourceLayout}>
          <div className={styles.previewStage}>
            {sourceAsset ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={t("手机拍摄图")} src={sourceAsset.url} />
            ) : (
              <div className={styles.placeholder}>
                <ImagePlus aria-hidden size={30} />
                <strong>{t("上传一张产品照片")}</strong>
                <span>{t("支持 PNG、JPG、WebP")}</span>
              </div>
            )}
          </div>

          <div className={styles.sourceInfo}>
            <div>
              <span>{t("输入要求")}</span>
              <strong>{t("产品主体清晰可辨")}</strong>
            </div>
            <div>
              <span>{t("固定输出")}</span>
              <strong>{t("左侧 45° / 正视 / 右侧 45°")}</strong>
            </div>
            <div className={styles.sourceActions}>
              <label className={styles.uploadButton}>
                {uploading ? (
                  <Loader2 aria-hidden className={styles.spinner} size={16} />
                ) : (
                  <ImagePlus aria-hidden size={16} />
                )}
                {sourceAsset ? t("替换图片") : t("上传图片")}
                <input
                  accept="image/png,image/jpeg,image/webp"
                  aria-label={t("上传手机拍摄图")}
                  disabled={uploading || run.state === "running"}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void uploadSource(file);
                    }
                    event.target.value = "";
                  }}
                  type="file"
                />
              </label>
              {sourceAsset?.source === "uploaded" ? (
                <button
                  aria-label={t("删除手机拍摄图")}
                  className={styles.deleteButton}
                  disabled={uploading || run.state === "running"}
                  onClick={removeSource}
                  title={t("删除手机拍摄图")}
                  type="button"
                >
                  <Trash2 aria-hidden size={16} />
                  删除
                </button>
              ) : null}
            </div>
            {sourceAsset ? <small title={sourceAsset.filename}>{sourceAsset.filename}</small> : null}
          </div>
        </div>
        {message ? <p className={styles.message}>{message}</p> : null}
      </section>

      {run.state === "running" ? (
        <section aria-label="生成进度" className={styles.progressPanel}>
          <div>
            <strong>{t("摄影棚标准化生成中 {done}/3", { done: run.completed })}</strong>
          </div>
          <div className={styles.progressTrack}>
            <div style={{ width: `${progressPercent}%` }} />
          </div>
        </section>
      ) : null}

      {run.error ? (
        <section className={styles.error}>
          {t("部分输出失败：")}
          {run.error}
        </section>
      ) : null}

      {run.outputs.length ? (
        <section className={styles.results} aria-label="手机图标准化结果">
          <div className={styles.resultHeader}>
            <h2>{t("摄影棚标准化三视角")}</h2>
            <span>{t("{done}/3 已完成", { done: run.outputs.length })}</span>
          </div>
          <div className={styles.resultGrid}>
            {run.outputs.map((output) => (
              <OutputCard key={output.id} output={output} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function findLatestPhoneShot(product: ProductWithProfile): Asset | undefined {
  return [...product.assets].reverse().find((asset) => asset.type === "phone-shot");
}

function sortOutputs(outputs: CompetitionOutputArtifact[]): CompetitionOutputArtifact[] {
  const angleOrder = PHONE_STANDARDIZATION_ANGLES.map((angle) => angle.id);
  return outputs.sort(
    (left, right) =>
      angleOrder.indexOf(left.spec.angle as never) -
      angleOrder.indexOf(right.spec.angle as never)
  );
}

function OutputCard({ output }: { output: CompetitionOutputArtifact }) {
  const { t } = useI18n();
  const angle = PHONE_STANDARDIZATION_ANGLES.find((item) => item.id === output.spec.angle);

  return (
    <article className={styles.outputCard}>
      <div className={styles.outputPreview}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={angle?.label ?? output.spec.label} src={output.url} />
      </div>
      <div className={styles.outputMeta}>
        <div>
          <CheckCircle2 aria-hidden color="#0049bb" size={16} />
          <strong>{angle?.label ?? output.spec.label}</strong>
        </div>
        <span>{output.provenance.model}</span>
        <a href={output.url} target="_blank">
          <ExternalLink aria-hidden size={14} />
          {t("打开原图")}
        </a>
      </div>
    </article>
  );
}