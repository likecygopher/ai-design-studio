"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FolderOpen, ImagePlus, Languages, Upload, WandSparkles } from "lucide-react";
import { DEFAULT_IMAGE_MODEL_CHOICE, type ImageModelChoice } from "@/src/domain/generation-models";
import type { Asset, ProductWithProfile } from "@/src/domain/types";
import { mapWithConcurrency } from "@/src/lib/concurrency";
import { ImageModelSelector } from "./ImageModelSelector";
import styles from "./LocalizePanel.module.css";
import { useI18n } from "@/src/i18n/I18nProvider";

type Material = { id: string; file: File; originalName: string; previewUrl: string; assetId?: string; base?: { file: File; previewUrl: string } };
type Job = Material & { state: "pending" | "running" | "done" | "failed"; resultUrl?: string; error?: string; width?: number; height?: number };
type Batch = { country: string; language: string; imageModel: ImageModelChoice; jobs: Job[] };
const countries = ["Mexico", "Brazil", "Saudi Arabia", "United States"];
const languages = ["Spanish", "Portuguese", "English", "Arabic"];
const languageLabels: Record<string, string> = { Spanish: "西班牙语 · Español", Portuguese: "葡萄牙语 · Português", English: "英语 · English", Arabic: "阿拉伯语 · العربية" };
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const MAX_UPLOAD_COUNT = 20;
const SVG_RASTER_MAX_DIMENSION = 2048;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

export function LocalizePanel() {
  const { t } = useI18n();
  const [mode, setMode] = useState<"single" | "bundle">("single");
  const [imageModel, setImageModel] = useState<ImageModelChoice>(DEFAULT_IMAGE_MODEL_CHOICE);
  const [targetCountry, setTargetCountry] = useState("Mexico");
  const [targetLanguage, setTargetLanguage] = useState("Spanish");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [items, setItems] = useState<Material[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [run, setRun] = useState<Batch | null>(null);
  const [running, setRunning] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const preparingRef = useRef(false);
  const marketEdited = useRef(false);
  const previewUrls = useRef(new Set<string>());
  const controller = useRef<AbortController | null>(null);
  const blocked = running || preparing;

  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/settings", { signal: abort.signal }).then(async response => {
      const payload = await response.json();
      if (!response.ok || !payload.settings?.country || !payload.settings?.language) throw new Error(t("无法读取默认市场，当前使用 Mexico / Spanish。"));
      if (!abort.signal.aborted && !marketEdited.current) { setTargetCountry(payload.settings.country); setTargetLanguage(payload.settings.language); }
    }).catch(cause => { if (!abort.signal.aborted) setSettingsError(cause instanceof Error ? cause.message : t("无法读取默认市场。")); }).finally(() => { if (!abort.signal.aborted) setSettingsLoaded(true); });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    setLibraryLoaded(false); setLibraryError("");
    Promise.all([fetch("/api/upload", { signal: abort.signal }), fetch("/api/products", { signal: abort.signal })]).then(async ([uploadResponse, productsResponse]) => {
      const uploaded = await uploadResponse.json();
      const products = await productsResponse.json();
      if (!uploadResponse.ok || !Array.isArray(uploaded.assets)) throw new Error(t("素材库加载失败，请重试。"));
      const combined: Asset[] = [...uploaded.assets, ...(Array.isArray(products.products) ? products.products.flatMap((product: ProductWithProfile) => product.assets ?? []) : [])];
      const images = combined.filter(asset => /\.(png|jpe?g|webp|svg)(?:\?|$)/i.test(asset.filename || asset.url));
      if (!abort.signal.aborted) setAssets([...new Map(images.map(asset => [asset.id, asset])).values()]);
    }).catch(cause => { if (!abort.signal.aborted) setLibraryError(cause instanceof Error ? cause.message : t("素材库加载失败，请重试。")); }).finally(() => { if (!abort.signal.aborted) setLibraryLoaded(true); });
    return () => abort.abort();
  }, [libraryVersion]);

  useEffect(() => () => {
    controller.current?.abort();
    for (const url of previewUrls.current) revokeObjectUrl(url);
    previewUrls.current.clear();
  }, []);

  useEffect(() => {
    // Sweep after material/run commits, never on unrelated preparation renders.
    // Retained jobs own their original and base previews until the run is replaced.
    const referenced = new Set<string>();
    for (const item of [...items, ...(run?.jobs ?? [])]) {
      referenced.add(item.previewUrl);
      if (item.base) referenced.add(item.base.previewUrl);
    }
    for (const url of previewUrls.current) {
      if (!referenced.has(url)) { revokeObjectUrl(url); previewUrls.current.delete(url); }
    }
  }, [items, run]);

  function preview(file: File) { const url = URL.createObjectURL(file); previewUrls.current.add(url); return url; }

  async function addFiles(files: File[], assetId?: string) {
    if (active.current || preparingRef.current || !files.length) return;
    preparingRef.current = true; setPreparing(true); setError("");
    try {
      const limit = mode === "single" ? 1 : MAX_UPLOAD_COUNT - items.length;
      const selected = files.slice(0, Math.max(0, limit));
      const failures = files.length > selected.length ? [`${mode === "single" ? t("单张模式仅选择 1 张") : t("一次最多处理 20 张图片")}。`] : [];
      const next: Material[] = [];
      for (const source of selected) {
        try {
          const file = await normalizeUploadFile(source);
          next.push({ id: createUploadId(), file, originalName: source.name, previewUrl: preview(file), assetId });
        } catch (cause) { failures.push(`${source.name}: ${cause instanceof Error ? cause.message : t("无法读取图片")}`); }
      }
      if (next.length) setItems(current => mode === "single" ? next : [...current, ...next]);
      if (failures.length) setError(failures.join("；"));
    } finally { preparingRef.current = false; setPreparing(false); }
  }

  async function addAsset(asset: Asset) {
    if (active.current || preparingRef.current) return;
    preparingRef.current = true; setPreparing(true); setError("");
    let file: File;
    try {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error(t("无法读取所选素材，请重新选择或本地上传。"));
      const blob = await response.blob();
      file = new File([blob], asset.filename, { type: blob.type || imageTypeFromName(asset.filename) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("无法读取素材")); return; }
    finally { preparingRef.current = false; setPreparing(false); }
    await addFiles([file], asset.id);
  }

  async function pairBase(id: string, file?: File) {
    if (!file || active.current || preparingRef.current) return;
    preparingRef.current = true; setPreparing(true); setError("");
    try {
      const normalized = await normalizeUploadFile(file);
      const material = items.find(item => item.id === id);
      if (!material) return;
      const [originalSize, baseSize] = await Promise.all([imageSize(material.file), imageSize(normalized)]);
      if (originalSize.width !== baseSize.width || originalSize.height !== baseSize.height) throw new Error(`底图尺寸必须与 ${material.originalName} 完全一致（${originalSize.width} × ${originalSize.height}），请检查配对。`);
      const base = { file: normalized, previewUrl: preview(normalized) };
      setItems(current => current.map(item => item.id === id ? { ...item, base } : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("底图读取失败")); }
    finally { preparingRef.current = false; setPreparing(false); }
  }

  async function execute(batch: Batch, retry = false) {
    if (active.current || preparingRef.current) return;
    const pending = batch.jobs.filter(job => !retry || job.state === "failed");
    if (!pending.length) return;
    active.current = true; setRunning(true); setError("");
    const abort = new AbortController(); controller.current = abort;
    setRun({ ...batch, jobs: batch.jobs.map(job => pending.some(item => item.id === job.id) ? { ...job, state: "pending", error: undefined } : job) });
    const update = (id: string, patch: Partial<Job>) => { if (!abort.signal.aborted) setRun(current => current ? { ...current, jobs: current.jobs.map(job => job.id === id ? { ...job, ...patch } : job) } : current); };
    try {
      await mapWithConcurrency(pending, 3, async item => {
        update(item.id, { state: "running" });
        try {
          const form = new FormData();
          form.append("image", item.file, item.file.name);
          if (item.base) form.append("baseImage", item.base.file, item.base.file.name);
          form.append("country", batch.country); form.append("language", batch.language); form.append("imageModel", batch.imageModel);
          const response = await fetch("/api/localize", { method: "POST", body: form, signal: abort.signal });
          const payload = await response.json();
          if (!response.ok || payload.error || !payload.url) throw new Error(payload.error ?? t("生成失败：{status}", { status: response.status }));
          update(item.id, { state: "done", resultUrl: payload.url, width: payload.width, height: payload.height, error: undefined });
        } catch (cause) { update(item.id, { state: "failed", error: cause instanceof Error ? cause.message : t("生成失败，请重试") }); }
      });
    } finally { active.current = false; if (!abort.signal.aborted) setRunning(false); }
  }

  const completed = run?.jobs.filter(job => job.state === "done").length ?? 0;
  const failed = run?.jobs.filter(job => job.state === "failed").length ?? 0;
  return <section className={styles.studio}>
    <header className={styles.heading}><h1>{t("多语言环境自适应")}</h1></header>
    <div className={styles.topRow}>
      <section className={styles.panel}>
        <div className={styles.sectionHeading}><h2>{t("选择原始素材")}</h2><div className={styles.segment} aria-label={t("素材模式")}>
          <button type="button" disabled={blocked} aria-pressed={mode === "single"} onClick={() => { if (active.current || preparingRef.current) return; if (items.length > 1) { setError(t("请先移除多余物料，再切换到单张素材。")); return; } setMode("single"); }}>{t("单张素材")}</button>
          <button type="button" disabled={blocked} aria-pressed={mode === "bundle"} onClick={() => { if (!active.current && !preparingRef.current) setMode("bundle"); }}>{t("物料组合包")}</button>
        </div></div>
        <div className={styles.materials}>
          {items.length ? items.map(item => <div className={styles.material} key={item.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}<img src={item.previewUrl} alt={t("原图 {name}", { name: item.originalName })} />
            <span title={item.originalName}>{item.originalName}</span><button type="button" disabled={blocked} aria-label={t("移除 {name}", { name: item.originalName })} onClick={() => { if (!active.current && !preparingRef.current) setItems(current => current.filter(value => value.id !== item.id)); }}>{t("移除")}</button>
          </div>) : <div className={styles.empty}><ImagePlus size={26} aria-hidden /><span>{t("选择已完成设计的图片")}</span><small>{t("从素材库选择，或添加本地图片")}</small></div>}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} disabled={blocked} onClick={() => setLibraryOpen(value => !value)}><FolderOpen size={14} aria-hidden />{t("从素材库选择")}</button>
          <label className={styles.secondary}><Upload size={14} aria-hidden />{t("本地上传")}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" aria-label={t("上传待转换图片")} disabled={blocked} multiple={mode === "bundle"} onChange={event => { void addFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} /></label>
          {items.length ? <button className={styles.textButton} type="button" disabled={blocked} onClick={() => { if (!active.current && !preparingRef.current) { setItems([]); setError(""); } }}>{t("清空")}</button> : null}
        </div>
        <p className={styles.hint}>{t("PNG / JPEG / WebP，单张 ≤30 MB，最多 20 项。")}</p>
        {libraryOpen ? <div className={styles.library} aria-label={t("素材库")}>
          <div className={styles.sectionHeading}><strong>{t("现有素材")}</strong><button type="button" className={styles.textButton} disabled={blocked} onClick={() => setLibraryOpen(false)}>{t("收起")}</button></div>
          {!libraryLoaded ? <p className={styles.hint}>{t("正在读取素材库…")}</p> : null}
          {libraryError ? <p role="alert">{libraryError}<button type="button" disabled={blocked} onClick={() => setLibraryVersion(value => value + 1)}>{t("重试加载")}</button></p> : null}
          {libraryLoaded && !libraryError && !assets.length ? <p className={styles.hint}>{t("素材库暂无图片，请本地上传。")}</p> : null}
          <div className={styles.libraryGrid}>{assets.map(asset => <button type="button" key={asset.id} aria-label={t("选择素材 {name}", { name: asset.filename })} disabled={blocked || (mode === "bundle" && (items.length >= MAX_UPLOAD_COUNT || items.some(item => item.assetId === asset.id)))} onClick={() => void addAsset(asset)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}<img src={asset.url} alt="" /><span>{asset.filename}</span>
          </button>)}</div>
        </div> : null}
      </section>
      <section className={`${styles.panel} ${styles.basePanel}`}><div className={styles.sectionHeading}><h2>{t("上传原始底图")} <small>{t("可选")}</small></h2></div>
        {!items.length ? <div className={styles.baseEmpty}><ImagePlus size={30} aria-hidden /><span>{t("先选择原始素材")}</span></div> : <div className={styles.baseList}>{items.map(item => <div key={item.id} className={styles.baseItem}>
          {item.base ? <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={item.base.previewUrl} alt={t("底图 {name}", { name: item.originalName })} /></> : <ImagePlus size={22} aria-hidden />}
          <div><strong title={item.originalName}>{item.originalName}</strong><label className={styles.textButton}>{item.base ? t("更换对应底图") : t("上传对应底图")}<input aria-label={t("上传底图 {name}", { name: item.originalName })} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={blocked} onChange={event => { void pairBase(item.id, event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
          {item.base ? <button type="button" className={styles.textButton} disabled={blocked} aria-label={t("移除底图 {name}", { name: item.originalName })} onClick={() => { if (!active.current && !preparingRef.current) setItems(current => current.map(value => value.id === item.id ? { ...value, base: undefined } : value)); }}>{t("移除底图")}</button> : null}</div>
        </div>)}</div>}
      </section>
    </div>
    <div className={styles.bottomRow}>
      <section className={styles.panel}><h2>{t("选择目标语言")}</h2><div className={styles.marketFields}>
        <label>{t("目标语言")}<div className={styles.language}><Languages size={19} aria-hidden /><select aria-label={t("目标语言")} value={targetLanguage} disabled={blocked} onChange={event => { marketEdited.current = true; setTargetLanguage(event.target.value); }}>{[...new Set([...languages, targetLanguage])].map(language => <option key={language} value={language}>{languageLabels[language] ?? language}</option>)}</select></div></label>
        <label>{t("目标国家")}<select aria-label={t("目标国家")} value={targetCountry} disabled={blocked} onChange={event => { marketEdited.current = true; setTargetCountry(event.target.value); }}>{[...new Set([...countries, targetCountry])].map(country => <option key={country}>{country}</option>)}</select></label>
      </div>{settingsError ? <p role="status" className={styles.hint}>{settingsError}</p> : null}</section>
      <section className={`${styles.panel} ${styles.generatePanel}`}><ImageModelSelector disabled={blocked} onChange={setImageModel} value={imageModel} /><p className={styles.hint}>{t("{count} 项物料 · 目标语言：{language}", { count: items.length, language: languageLabels[targetLanguage] ?? targetLanguage })}</p><button data-generate-action="true" className={styles.primary} type="button" disabled={blocked || !items.length || !settingsLoaded} onClick={() => void execute({ country: targetCountry, language: targetLanguage, imageModel, jobs: items.map(item => ({ ...item, state: "pending" })) })}><WandSparkles size={17} aria-hidden />{running
            ? t("正在生成适配图片…")
            : preparing
              ? t("正在准备素材…")
              : t("生成适配图片（{count}）", { count: items.length })}</button></section>
    </div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {run ? <section className={styles.panel}><div className={styles.sectionHeading}><h2>{t("适配结果")} <small>{t("{done}/{total} 已完成 · {language} / {country}", { done: completed, total: run.jobs.length, language: run.language, country: run.country })}</small></h2>{failed ? <button type="button" className={styles.secondary} disabled={blocked} onClick={() => void execute(run, true)}>{t("重试失败项（{count}）", { count: failed })}</button> : null}</div>
      <div className={styles.results}>{run.jobs.map(job => <article key={job.id} className={styles.result}><div className={styles.sectionHeading}><strong>{job.originalName}</strong><span role="status">{job.state === "done"
                ? t("转换完成")
                : job.state === "failed"
                  ? t("转换失败：{error}", { error: job.error ?? "" })
                  : job.state === "running"
                    ? t("正在识别并适配文字…")
                    : t("等待生成")}</span></div><div className={styles.comparison}>
        <figure>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={job.previewUrl} alt={t("结果对照原图 {name}", { name: job.originalName })} /><figcaption>{t("原始素材")}{job.base ? t(" · 已配对无文字底图") : ""}</figcaption></figure>
        {job.resultUrl ? <figure>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={job.resultUrl} alt={t("本地化结果 {name}", { name: job.originalName })} /><figcaption>{run.language}{job.width && job.height ? ` · ${job.width} × ${job.height}` : ""}<a href={job.resultUrl} download={`localized-${job.originalName.replace(/\.[^.]+$/, "")}.png`}><Download size={13} aria-hidden />{t("下载图片")}</a></figcaption></figure> : <div className={styles.resultEmpty}>{job.state === "failed" ? t("本项生成失败，可单独重试") : t("适配结果将在这里显示")}</div>}
      </div></article>)}</div>
    </section> : null}
  </section>;
}

function imageTypeFromName(name: string) { return /\.svg$/i.test(name) ? "image/svg+xml" : /\.webp$/i.test(name) ? "image/webp" : /\.jpe?g$/i.test(name) ? "image/jpeg" : "image/png"; }
async function normalizeUploadFile(file: File): Promise<File> {
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  if (!SUPPORTED_IMAGE_TYPES.has(file.type) && !isSvg) throw new Error("仅支持 PNG、JPEG、WebP 或 SVG 图片");
  if (!file.size) throw new Error("文件为空");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("文件不能超过 30 MB");
  return isSvg ? rasterizeSvgFile(file) : file;
}
async function imageSize(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try { const image = await loadImage(url); return { width: image.naturalWidth, height: image.naturalHeight }; }
  finally { revokeObjectUrl(url); }
}
async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("图片读取失败")); image.src = url; });
  return image;
}
async function rasterizeSvgFile(file: File): Promise<File> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    const sourceWidth = image.naturalWidth || image.width || 1024;
    const sourceHeight = image.naturalHeight || image.height || 1024;
    const scale = Math.min(1, SVG_RASTER_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale)); canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持 SVG 栅格化");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => { canvas.toBlob(value => value ? resolve(value) : reject(new Error("SVG 栅格化失败")), "image/png"); });
    return new File([blob], `${file.name.replace(/\.svg$/i, "") || "localized-source"}.png`, { type: "image/png" });
  } finally { revokeObjectUrl(sourceUrl); }
}
function revokeObjectUrl(url: string) { if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url); }
function createUploadId() { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
