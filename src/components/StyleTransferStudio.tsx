"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Download, ExternalLink, FolderOpen, Image as ImageIcon, Loader2, RefreshCcw, Upload, WandSparkles } from "lucide-react";
import { STYLE_TRANSFER_PRESETS, STYLE_TRANSFER_VARIANTS, type StyleTransferPreset, type StyleTransferStyleId, type StyleTransferVariantId } from "@/src/domain/style-transfer";
import { DEFAULT_IMAGE_MODEL_CHOICE, type ImageModelChoice } from "@/src/domain/generation-models";
import type { ProductWithProfile } from "@/src/domain/types";
import { mapWithConcurrency } from "@/src/lib/concurrency";
import { ImageModelSelector } from "./ImageModelSelector";
import { StudioDialog } from "./StudioDialog";
import { useI18n } from "@/src/i18n/I18nProvider";
import { StyleMaterialPicker, productLabel, styleProductImages } from "./StyleMaterialPicker";
import styles from "./StyleTransferStudio.module.css";

type StyleOutput = { id: string; url: string; model: string; prompt: string; sourceAssetIds: string[]; generatedAt: string; isFallback: boolean };
type RequestSnapshot = { productId: string; productAssetId: string; styleId: StyleTransferStyleId; keywords: string; imageModel: ImageModelChoice };
type Job = { variantId: StyleTransferVariantId; label: string; state: "pending" | "running" | "done" | "failed"; output?: StyleOutput; error?: string };
type Run = { label: string; params: RequestSnapshot; jobs: Job[] };
const presetOrder = ["premium-universal", "nordic-home", "japanese-aesthetic", "nordic-editorial", "lab", "latin-american"];
const presets = [...STYLE_TRANSFER_PRESETS].sort((a, b) => presetOrder.indexOf(a.id) - presetOrder.indexOf(b.id));

export function StyleTransferStudio() {
  const { t } = useI18n();
  const [products, setProducts] = useState<ProductWithProfile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  const [productId, setProductId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [styleId, setStyleId] = useState<StyleTransferStyleId>("premium-universal");
  const [keywords, setKeywords] = useState(presets[0].keywords);
  const [count, setCount] = useState(3);
  const [imageModel, setImageModel] = useState<ImageModelChoice>(DEFAULT_IMAGE_MODEL_CHOICE);
  const [picker, setPicker] = useState<"library" | "upload" | null>(null);
  const [gallery, setGallery] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const active = useRef(false);
  const selectedProduct = products.find(product => product.id === productId);
  const asset = styleProductImages(selectedProduct).find(item => item.id === assetId);
  const preset = presets.find(item => item.id === styleId)!;
  const visiblePresets = presets.slice(0, 5).some(item => item.id === styleId) ? presets.slice(0, 5) : [...presets.slice(0, 4), preset];

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false); setLoadError("");
    fetch("/api/products", { signal: controller.signal }).then(async response => {
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.products)) throw new Error(payload.error ?? t("无法读取产品素材"));
      if (controller.signal.aborted) return;
      const list = payload.products as ProductWithProfile[];
      setProducts(list);
      const initial = list.find(product => styleProductImages(product).length) ?? list[0];
      setProductId(initial?.id ?? ""); setAssetId(styleProductImages(initial)[0]?.id ?? "");
      setLoaded(true);
    }).catch(cause => { if (!controller.signal.aborted) { setLoadError(
          cause instanceof Error ? cause.message : t("无法读取产品素材")
        ); setLoaded(true); } });
    return () => controller.abort();
  }, [loadVersion]);

  useEffect(() => () => { request.current?.abort(); }, []);

  function choosePreset(next: StyleTransferPreset) {
    if (active.current) return;
    setStyleId(next.id); setKeywords(next.keywords); setGallery(false);
  }

  async function execute(snapshot: Run, retry = false) {
    if (active.current) return;
    const pending = snapshot.jobs.filter(job => !retry || job.state === "failed");
    if (!pending.length) return;
    active.current = true; setBusy(true);
    const controller = new AbortController(); request.current = controller;
    setRun({ ...snapshot, jobs: snapshot.jobs.map(job => pending.some(item => item.variantId === job.variantId) ? { ...job, state: "pending", error: undefined } : job) });
    const update = (id: string, patch: Partial<Job>) => {
      if (!controller.signal.aborted) setRun(current => current ? { ...current, jobs: current.jobs.map(job => job.variantId === id ? { ...job, ...patch } : job) } : current);
    };
    try {
      await mapWithConcurrency(pending, 3, async job => {
        update(job.variantId, { state: "running" });
        try {
          const { postCapabilityJob } = await import("@/src/platform/client/job-client");
          const payload = await postCapabilityJob<{ output?: Job["output"] }>(
            "/api/style-transfer",
            { ...snapshot.params, variantId: job.variantId },
            controller.signal
          );
          if (!payload.output?.url) throw new Error(t("生成失败，请重试"));
          update(job.variantId, { state: "done", output: payload.output, error: undefined });
        } catch (cause) { update(job.variantId, { state: "failed", error: cause instanceof Error ? cause.message : t("生成失败，请重试") }); }
      });
    } finally {
      active.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function generate() {
    if (!selectedProduct || !asset) return;
    void execute({
      label: productLabel(selectedProduct) + " · " + preset.label,
      params: { productId, productAssetId: asset.id, styleId, keywords: keywords.trim() || preset.keywords, imageModel },
      jobs: STYLE_TRANSFER_VARIANTS.slice(0, count).map(variant => ({ variantId: variant.id, label: variant.label, state: "pending" }))
    });
  }

  const completed = run?.jobs.filter(job => job.state === "done").length ?? 0;
  const failed = run?.jobs.filter(job => job.state === "failed").length ?? 0;
  return (
    <div className={styles.studio}>
      <header className={styles.heading}><h1>{t("一键风格迁移")}</h1></header>
      {loadError ? <div role="alert" className={styles.error}>{loadError}<button className={styles.secondary} onClick={() => setLoadVersion(value => value + 1)} type="button">{t("重新加载素材")}</button></div> : null}
      <div className={styles.inputRow}>
        <section className={styles.panel} aria-label={t("选择素材")}>
          <div className={styles.sectionHeading}><h2>{t("选择素材")}</h2><div className={styles.actions}>
            <button className={styles.secondary} disabled={busy || !loaded || !!loadError} onClick={() => setPicker("library")} type="button"><FolderOpen size={13} aria-hidden />{t("从素材库选择")}</button>
            <button className={styles.secondary} disabled={busy || !loaded || !!loadError} onClick={() => setPicker("upload")} type="button"><Upload size={13} aria-hidden />{t("本地上传")}</button>
          </div></div>
          <div className={styles.material}>
            <div className={styles.productPreview}>{asset ? <img src={asset.url} alt={t("当前产品参考")} /> : <ImageIcon size={26} aria-hidden />}</div>
            <div className={styles.materialCopy}><div><strong>{loaded ? productLabel(selectedProduct) : t("正在读取素材…")}</strong><button className={styles.textButton} disabled={busy || !loaded || !products.length} onClick={() => setPicker("library")} type="button">{t("更换产品")}<ChevronRight size={12} aria-hidden /></button></div>
              <span>{asset?.filename ?? t("上传清晰产品图，或从素材库选择")}</span>
              <small>{asset ? t("产品参考图 · 保持产品结构与外观") : t("支持任意产品品类，不限于冰箱或烤箱")}</small>
            </div>
          </div>
        </section>
        <section className={styles.panel} aria-label={t("输出数量")}><h2>{t("输出数量")}</h2>
          <div className={styles.quantity} role="radiogroup" aria-label={t("输出数量")}>{[1, 2, 3].map(value => <button type="button" role="radio" aria-checked={count === value} key={value} disabled={busy} onClick={() => setCount(value)}>{t("{count} 张", { count: value })}</button>)}</div>
          <p className={styles.microHint}>{t("同一风格，不同构图")}</p>
        </section>
      </div>
      <section className={styles.panel} aria-label={t("风格预设")}>
        <div className={styles.sectionHeading}><div className={styles.presetHeading}><strong className={styles.activeTab}>{t("风格预设")}</strong><span className={styles.unavailable} title={t("本版仅提供已有预设，风格学习尚未开放")}>{t("风格学习 · 暂未开放")}</span><span className={styles.current}>{t("当前风格：{name}", { name: preset.label })}</span></div>
          <button type="button" className={styles.textButton} disabled={busy} onClick={() => setGallery(true)}>{t("查看全部预设")}<ChevronRight size={12} aria-hidden /></button>
        </div>
        <div className={styles.presetGrid}>{visiblePresets.map(item => <PresetCard key={item.id} preset={item} selected={styleId === item.id} disabled={busy} onSelect={() => choosePreset(item)} />)}</div>
      </section>
      <div className={styles.bottomRow}>
        <section className={styles.panel} aria-label={t("场景描述")}>
          <div className={styles.sectionHeading}><h2>{t("场景描述")}<span className={styles.caption}>{t("仅供确认")}</span></h2></div>
          <p className={styles.sceneSummary}>
            {t("将{product}置于{scene}场景。{summary}保留主体的外观、结构与品牌细节。", {
              product: selectedProduct ? productLabel(selectedProduct) : t("所选产品"),
              scene: preset.label,
              summary: preset.summary
            })}
          </p>
          <details className={styles.advanced}><summary>{t("高级描述")}</summary><label className={styles.field}>{t("场景 Keywords")}<textarea disabled={busy} maxLength={600} value={keywords} onChange={event => setKeywords(event.target.value)} /></label><p className={styles.hint}>{keywords.length}/600</p></details>
        </section>
        <section className={styles.panel + " " + styles.generatePanel} aria-label={t("生成设置")}>
          <ImageModelSelector className={styles.field} value={imageModel} onChange={setImageModel} disabled={busy} />
          <button type="button" aria-label={t("生成风格图")} className={styles.primary} disabled={!asset || busy || !loaded || !!loadError} onClick={generate}>{busy ? <Loader2 className={styles.spinner} size={16} aria-hidden /> : <WandSparkles size={16} aria-hidden />}{busy ? t("正在生成…") : t("生成风格图")}</button>
        </section>
      </div>
      {run ? <section aria-label={t("风格迁移结果")} className={styles.panel}>
        <div className={styles.sectionHeading}><div><h2>{t("生成结果")}</h2><p className={styles.hint}>{run.label}</p></div><span aria-live="polite">
            {t("{done}/{total} 已完成", { done: completed, total: run.jobs.length })}
            {busy ? t(" · 生成中") : ""}
          </span></div>
        <div className={styles.resultGrid}>{run.jobs.map(job => <article className={styles.outputCard} key={job.variantId}>
          <div className={styles.outputPreview}>{job.output ? <img src={job.output.url} alt={t("风格迁移输出：") + job.label} /> : <div className={styles.outputPlaceholder}>{job.state === "failed" ? <RefreshCcw size={23} aria-hidden /> : <Loader2 size={23} className={styles.spinner} aria-hidden />}<span>{job.state === "failed" ? t("此图片生成失败") : job.state === "running" ? t("正在生成") : t("等待生成")}</span></div>}</div>
          <div className={styles.outputMeta}><strong>{job.label}</strong>{job.output ? <><small>{job.output.isFallback ? t("示例回退结果 · 非实时生图") : job.output.model}</small><div className={styles.actions}><a href={job.output.url} download={"style-" + job.variantId + ".png"}><Download size={13} aria-hidden />{t("下载图片")}</a><a href={job.output.url} target="_blank" rel="noreferrer"><ExternalLink size={13} aria-hidden />{t("查看大图")}</a></div></> : job.error ? <p role="alert">{job.error}</p> : null}</div>
        </article>)}</div>
        {!busy && failed ? <div className={styles.retry}><span>{t("{count} 张生成失败，成功图片已保留。", { count: failed })}</span><button className={styles.secondary} onClick={() => void execute(run, true)} type="button"><RefreshCcw size={13} aria-hidden />{t("重试失败图片")}</button></div> : null}
      </section> : null}
      {picker ? <StyleMaterialPicker mode={picker} products={products} setProducts={setProducts} initialProductId={productId} onClose={() => setPicker(null)} onSelect={(nextProduct, nextAsset) => { setProductId(nextProduct); setAssetId(nextAsset); setPicker(null); }} /> : null}
      {gallery ? <StudioDialog title={t("全部风格预设")} onClose={() => setGallery(false)}><div className={styles.gallery}>{presets.map(item => <PresetCard key={item.id} preset={item} selected={item.id === styleId} onSelect={() => choosePreset(item)} />)}</div></StudioDialog> : null}
    </div>
  );
}

function PresetCard({ preset, selected, disabled = false, onSelect }: { preset: StyleTransferPreset; selected: boolean; disabled?: boolean; onSelect: () => void }) {
  return <button type="button" aria-label={preset.label} aria-pressed={selected} disabled={disabled} className={styles.preset} onClick={onSelect} title={preset.summary}>
    <div className={styles.presetImage}><img src={preset.references[0].url} alt="" />{selected ? <span className={styles.selectedCheck}><Check size={12} aria-hidden /></span> : null}</div>
    <strong>{preset.label}</strong>
  </button>;
}
