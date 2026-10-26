"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, FolderOpen, ImagePlus, Loader2, Plus, RefreshCcw, Sparkles, X } from "lucide-react";
import { WHITE_BACKGROUND_SIZE_OPTIONS, WHITE_BACKGROUND_VIEW_OPTIONS, validateWhiteBackgroundReferences, type WhiteBackgroundOutput, type WhiteBackgroundRequest, type WhiteBackgroundViewId } from "@/src/domain/white-background";
import { DEFAULT_IMAGE_MODEL_CHOICE, type ImageModelChoice } from "@/src/domain/generation-models";
import type { Asset, ProductWithProfile } from "@/src/domain/types";
import { mapWithConcurrency } from "@/src/lib/concurrency";
import { ImageModelSelector } from "./ImageModelSelector";
import { StudioDialog } from "./StudioDialog";
import styles from "./WhiteBackgroundRunner.module.css";
import { useI18n } from "@/src/i18n/I18nProvider";

type Snapshot = Omit<WhiteBackgroundRequest, "angle"> & { productName: string };
type ResultRow = { angle: WhiteBackgroundViewId; state: "running" | "done" | "failed"; output?: WhiteBackgroundOutput; error?: string };
type Run = { snapshot: Snapshot; rows: ResultRow[] };
const referenceTypes = new Set(["product-photo", "phone-shot", "white-background-closed", "white-background-open"]);

export function WhiteBackgroundRunner() {
  const { t } = useI18n();
  const [products, setProducts] = useState<ProductWithProfile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [productId, setProductId] = useState("");
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [picker, setPicker] = useState(false);
  const [imageModel, setImageModel] = useState<ImageModelChoice>(DEFAULT_IMAGE_MODEL_CHOICE);
  const [sourceState, setSourceState] = useState<WhiteBackgroundRequest["sourceState"]>("as-reference");
  const [angles, setAngles] = useState<WhiteBackgroundViewId[]>(["front", "left-45", "right-45"]);
  const [autoRemoveBackground, setAutoRemoveBackground] = useState(true);
  const [whiteBackground, setWhiteBackground] = useState(true);
  const [naturalShadow, setNaturalShadow] = useState(true);
  const [size, setSize] = useState("square");
  const [customWidth, setCustomWidth] = useState("2000");
  const [customHeight, setCustomHeight] = useState("2000");
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");
  const [run, setRun] = useState<Run>();
  const [review, setReview] = useState<WhiteBackgroundOutput>();
  useEffect(() => {
    let cancelled = false;
    fetch("/api/products").then(async (response) => {
      if (!response.ok) throw new Error(t("产品加载失败，请刷新重试。"));
      const payload = await response.json();
      if (!Array.isArray(payload.products)) throw new Error(t("产品列表无效，请刷新重试。"));
      if (!cancelled) { setProducts(payload.products); setProductId(payload.products[0]?.id ?? ""); }
    }).catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : t("产品加载失败。")); }).finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);
  const product = products.find((item) => item.id === productId);
  const library = product?.assets.filter((asset) => referenceTypes.has(asset.type) && /\.(png|jpe?g|webp)$/i.test(asset.filename)) ?? [];
  const references = referenceIds.map((id) => library.find((asset) => asset.id === id)).filter((asset): asset is Asset => !!asset);
  const chosenSize = WHITE_BACKGROUND_SIZE_OPTIONS.find((item) => item.id === size);
  const width = chosenSize?.width ?? Number(customWidth);
  const height = chosenSize?.height ?? Number(customHeight);
  const validSize = [width, height].every((value) => Number.isInteger(value) && value >= 256 && value <= 4096);
  const validation = useMemo(() => {
    if (!referenceIds.length) return "";
    try { validateWhiteBackgroundReferences({ productId, referenceAssetIds: referenceIds, sourceState }, product?.assets ?? []); return ""; }
    catch (error) { return error instanceof Error ? error.message : t("参考图无效"); }
  }, [productId, product, referenceIds, sourceState]);
  const locked = running || uploading;
  const failures = run?.rows.filter((row) => row.state === "failed") ?? [];
  const completed = run?.rows.filter((row) => row.state !== "running").length ?? 0;

  async function upload(file: File, replaceId?: string) {
    if (!product || locked || busyRef.current) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) { setMessage("请选择不超过20 MB的PNG、JPG或WebP图片。"); return; }
    if (!replaceId && referenceIds.length >= 3) { setMessage(t("最多使用3张参考图，请先移除一张。")); return; }
    busyRef.current = true; setUploading(true); setMessage("");
    try {
      const form = new FormData(); form.set("projectId", product.projectId); form.set("productId", product.id);
      form.set("type", sourceState === "open" ? "white-background-open" : sourceState === "closed" ? "white-background-closed" : "product-photo"); form.append("files", file);
      const response = await fetch("/api/upload", { method: "POST", body: form }); const payload = await response.json();
      const asset = payload.assets?.[0] as Asset | undefined;
      if (!response.ok || payload.error || !asset?.id || asset.productId !== product.id) throw new Error(payload.error ?? t("上传失败，请重试。"));
      setProducts((current) => current.map((item) => item.id === product.id ? { ...item, assets: [...item.assets, asset] } : item));
      setReferenceIds((current) => replaceId ? current.map((id) => id === replaceId ? asset.id : id) : [...current, asset.id]);
      setMessage(t("参考图已上传并选中；原素材仍保留在素材库。"));
    } catch (error) { setMessage(error instanceof Error ? error.message : t("上传失败。")); }
    finally { setUploading(false); busyRef.current = false; }
  }

  async function generate(retry = false) {
    if (busyRef.current || locked) return;
    if (!retry && (!product || !references.length || !angles.length || !validSize || validation)) return;
    const snapshot: Snapshot | undefined = retry ? run?.snapshot : { productId, productName: product?.displayName ?? productId, referenceAssetIds: [...referenceIds], sourceState, autoRemoveBackground, whiteBackground, naturalShadow, width, height, imageModel };
    const requestedAngles = retry ? failures.map((row) => row.angle) : WHITE_BACKGROUND_VIEW_OPTIONS.filter((item) => angles.includes(item.id)).map((item) => item.id);
    if (!snapshot || !requestedAngles.length) return;
    busyRef.current = true; setRunning(true); setMessage("");
    setRun((current) => ({ snapshot, rows: retry ? (current?.rows ?? []).map((row) => requestedAngles.includes(row.angle) ? { angle: row.angle, state: "running" } : row) : requestedAngles.map((angle) => ({ angle, state: "running" })) }));
    await mapWithConcurrency(requestedAngles, 3, async (angle) => {
      let row: ResultRow;
      try {
        const { productName: _productName, ...settings } = snapshot;
        const response = await fetch("/api/white-background", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings, angle }) });
        const payload = await response.json();
        if (!response.ok || payload.error || !payload.output?.url || payload.output.angle !== angle) throw new Error(payload.error ?? "生成失败，请重试。");
        row = { angle, state: "done", output: payload.output };
      } catch (error) { row = { angle, state: "failed", error: error instanceof Error ? error.message : t("生成失败") }; }
      setRun((current) => current ? { ...current, rows: current.rows.map((item) => item.angle === angle ? row : item) } : current);
    });
    busyRef.current = false; setRunning(false);
  }

  if (loaded && !products.length) return <section className={styles.panel}>{loadError || <>{t("还没有产品，请先到")}<a href="/assets">{t("素材库")}</a>{t("创建产品并上传参考图。")}</>}</section>;
  return <div className={styles.runner}>
    <fieldset disabled={locked} className={styles.inputs}>
      <div className={styles.topBand}>
        <section className={styles.panel} aria-label={t("选择素材")}>
          <div className={styles.sectionHeader}><h2>{t("选择素材")}</h2><div className={styles.actions}>
            <button type="button" onClick={() => setPicker(true)} disabled={!product}><FolderOpen size={14} aria-hidden />{t("从素材库选择")}</button>
            <UploadControl label={t("本地上传")} disabled={!product || referenceIds.length >= 3} onUpload={upload} />
          </div></div>
          <div className={styles.productControls}>
            <label>{t("目标产品")}<select aria-label={t("目标产品")} value={productId} onChange={(event) => { setProductId(event.target.value); setReferenceIds([]); setSourceState("as-reference"); setMessage(""); }}>{products.map((item) => <option key={item.id} value={item.id}>{item.displayName ?? item.id}</option>)}</select></label>
            <label>{t("参考产品状态")}<select value={sourceState} onChange={(event) => setSourceState(event.target.value as WhiteBackgroundRequest["sourceState"])}><option value="as-reference">{t("保持第一张参考图状态")}</option><option value="closed">{t("关门 / 闭合状态")}</option><option value="open">{t("开门 / 展开状态")}</option></select></label>
          </div>
          <div className={styles.referenceStrip}>
            {references.map((asset, index) => <div className={styles.referenceCard} key={asset.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}<img alt={`${t("参考图")} ${index + 1}: ${asset.filename}`} src={asset.url} />
              <button type="button" aria-label={t("移除参考图 {name}", { name: asset.filename })} className={styles.remove} onClick={() => setReferenceIds((ids) => ids.filter((id) => id !== asset.id))}><X size={12} aria-hidden /></button>
              <span title={asset.filename}>{index === 0 ? t("主体参考") : t("细节参考")} · {asset.filename}</span>
              <UploadControl label={t("替换 {name}", { name: asset.filename })} disabled={false} onUpload={(file) => upload(file, asset.id)} />
            </div>)}
            {references.length < 3 ? <button className={styles.addReference} type="button" onClick={() => setPicker(true)} disabled={!product}><Plus size={24} aria-hidden /><span>{t("继续添加")}</span></button> : null}
          </div>
          <details className={styles.referenceHelp}><summary>{t("参考图规则 · {count}/3", { count: references.length })}</summary><p className={styles.hint}>{t("第一张确定产品状态，其余补充细节。开门与关门请分两次生成；未标注状态的图片请自行核对。JPG / PNG / WebP，单张≤20 MB。移除或替换只改变本次选择，原素材仍保留。")}</p></details>
        </section>
        <section className={`${styles.panel} ${styles.processing}`} aria-label={t("背景处理")}><h2>{t("背景处理")}</h2>
          <Toggle label={t("自动抠图")} checked={autoRemoveBackground} onChange={setAutoRemoveBackground} />
          <Toggle label={t("纯白背景")} checked={whiteBackground} onChange={setWhiteBackground} note={whiteBackground ? "#FFFFFF" : t("保留原背景")} />
          <Toggle label={t("保留自然阴影")} checked={naturalShadow} onChange={setNaturalShadow} />
        </section>
      </div>
      <section className={styles.panel} aria-label={t("选择生成角度")}>
        <div className={styles.sectionHeader}><h2>{t("选择生成角度")}</h2><span>{t("已选 {count} 个角度", { count: angles.length })}</span></div>
        <div className={styles.angleOptions}>{WHITE_BACKGROUND_VIEW_OPTIONS.map((angle) => <div className={styles.angleTile} data-selected={angles.includes(angle.id)} key={angle.id}>
          <button type="button" aria-pressed={angles.includes(angle.id)} aria-label={t(angle.label)} onClick={() => setAngles((current) => current.includes(angle.id) ? current.filter((id) => id !== angle.id) : [...current, angle.id])}>
            <span className={styles.selectionMark}>{angles.includes(angle.id) ? <Check size={12} aria-hidden /> : null}</span>
            <AngleDiagram angle={angle.id} mark={angle.mark} /><strong>{t(angle.label)}</strong>
          </button></div>)}</div>
      </section>
      <div className={styles.bottomBand}>
        <section className={styles.panel} aria-label={t("图片尺寸")}><h2>{t("图片尺寸")}</h2><div className={styles.sizeOptions}>
          {WHITE_BACKGROUND_SIZE_OPTIONS.map((option) => <div className={styles.sizeTile} data-selected={size === option.id} key={option.id}><button type="button" aria-pressed={size === option.id} onClick={() => setSize(option.id)}><span className={styles.ratioIcon} style={{ aspectRatio: `${option.width}/${option.height}` }} /><strong>{t(option.label)}</strong><span>{option.width} × {option.height} px</span><small>{t(option.hint)}</small></button></div>)}
          <div className={styles.sizeTile} data-selected={size === "custom"}><button type="button" aria-pressed={size === "custom"} onClick={() => setSize("custom")}><span className={styles.customIcon}>⌗</span><strong>{t("自定义")}</strong><span>{t("宽 × 高（px）")}</span><small>{t("按渠道规格设置")}</small></button></div>
        </div>{size === "custom" ? <div className={styles.customDimensions}><label>{t("宽度")}<input type="number" min="256" max="4096" step="1" value={customWidth} onChange={(event) => setCustomWidth(event.target.value)} /></label><span>×</span><label>{t("高度")}<input type="number" min="256" max="4096" step="1" value={customHeight} onChange={(event) => setCustomHeight(event.target.value)} /></label><span>256–4096 px</span></div> : null}
      </section>
        <section className={`${styles.panel} ${styles.generatePanel}`}><ImageModelSelector value={imageModel} onChange={setImageModel} disabled={locked} />
          <button type="button" data-generate-action="true" className={styles.generateButton} disabled={!product || !references.length || !angles.length || !validSize || !!validation} onClick={() => void generate()}>{running || uploading ? <Loader2 size={17} className={styles.spinner} aria-hidden /> : <Sparkles size={17} aria-hidden />}{running
              ? t("生成中 {done}/{total}", { done: completed, total: run?.rows.length ?? 0 })
              : uploading
                ? t("上传中…")
                : t("生成 {count} 张多角度图", { count: angles.length })}</button>
        </section>
      </div>
    </fieldset>
    {validation ? <p role="alert" className={styles.error}>{validation}</p> : null}
    {!validSize ? <p role="alert" className={styles.error}>{t("请输入256–4096px的整数宽度和高度。")}</p> : null}
    {message ? <p role="status" className={styles.hint}>{message}</p> : null}
    {run ? <section className={styles.panel} aria-label={t("生成结果")}>
      <div className={styles.sectionHeader}><div><h2>{t("生成结果 · {name}", { name: run.snapshot.productName })}</h2><p className={styles.hint}>
            {t("{width} × {height} px · {count} 张参考图 · {done}/{total} 已处理", {
              width: run.snapshot.width,
              height: run.snapshot.height,
              count: run.snapshot.referenceAssetIds.length,
              done: completed,
              total: run.rows.length
            })}
            {running ? t(" · 设置已锁定") : ""}
          </p></div>{failures.length && !running ? <button type="button" onClick={() => void generate(true)} disabled={uploading}><RefreshCcw size={13} aria-hidden />{t("仅重试 {count} 张失败图", { count: failures.length })}</button> : null}</div>
      {running ? <progress className={styles.progress} max={run.rows.length} value={completed} aria-label={t("生成进度")} /> : null}
      <div className={styles.results}>{run.rows.map((row) => {
        const label = WHITE_BACKGROUND_VIEW_OPTIONS.find((item) => item.id === row.angle)!.label;
        return <article className={styles.resultItem} key={row.angle}>
          <div className={styles.resultImage}>{row.output ? <button type="button" aria-label={t("预览 {label}", { label: t(label) })} onClick={() => setReview(row.output)}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={row.output.url} alt={t(label)} /></button> : row.state === "running" ? <Loader2 aria-label="生成中" className={styles.spinner} size={22} /> : <span>{t("生成失败")}</span>}</div>
          <div className={styles.resultMeta}><strong>{t(label)}</strong>{row.output ? <><span>{row.output.model}</span><a aria-label={t("下载 {label}", { label: t(label) })} href={row.output.url} download={`product-${row.angle}-${row.output.width}x${row.output.height}.png`}><Download size={13} aria-hidden />{t("下载")}</a></> : row.error ? <p role="alert" className={styles.error}>{row.error}</p> : <span>{t("正在生成")}</span>}</div>
        </article>;
      })}</div>
    </section> : null}
    {picker ? <StudioDialog title={t("选择产品参考图")} onClose={() => setPicker(false)}><p className={styles.hint}>{product?.displayName} · {t("已选 {count}/3", { count: referenceIds.length })}</p><div className={styles.libraryOptions}>{library.map((asset) => <label className={styles.libraryItem} key={asset.id}>
      {/* eslint-disable-next-line @next/next/no-img-element */}<img src={asset.url} alt="" /><span><input type="checkbox" aria-label={asset.filename} checked={referenceIds.includes(asset.id)} disabled={locked || (!referenceIds.includes(asset.id) && referenceIds.length >= 3)} onChange={(event) => setReferenceIds((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} />{asset.filename}</span><small>{asset.type === "white-background-open" ? t("开门") : asset.type === "white-background-closed" ? t("关门") : t("请核对产品状态")}</small></label>)}</div>{!library.length ? <p>{t("此产品暂无图片，请关闭后使用本地上传。")}</p> : null}<button type="button" onClick={() => setPicker(false)}>{t("完成选择")}</button></StudioDialog> : null}
    {review ? <StudioDialog title={t("检查生成结果")} onClose={() => setReview(undefined)}><div className={styles.review}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={review.url} alt={t("生成结果原图")} /><p>{t("请核对产品结构、Logo和细节。")}{review.width} × {review.height} px</p><a href={review.url} download>{t("下载PNG原图")}</a></div></StudioDialog> : null}
  </div>;
}

function UploadControl({ label, disabled, onUpload }: { label: string; disabled: boolean; onUpload: (file: File) => void }) {
  return <label className={styles.uploadButton}><ImagePlus size={14} aria-hidden /><span>{label}</span><input type="file" aria-label={label} accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ""; }} /></label>;
}
function Toggle({ label, checked, onChange, note }: { label: string; checked: boolean; onChange: (value: boolean) => void; note?: string }) {
  return <label className={styles.toggle}><span>{label}</span>{note ? <small>{note}</small> : null}<input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className={styles.toggleTrack} aria-hidden /></label>;
}
function AngleDiagram({ angle, mark }: { angle: WhiteBackgroundViewId; mark: string }) {
  const perspective = angle === "left-45" || angle === "right-45";
  return <svg viewBox="0 0 88 76" aria-hidden className={styles.angleDiagram}>
    <ellipse cx="44" cy="69" rx="28" ry="3" fill="#000" opacity=".05" />
    {perspective ? <g transform={angle === "left-45" ? "translate(88 0) scale(-1 1)" : undefined}><path d="M18 20 42 10 69 20 44 32Z" fill="#f6f8f8" stroke="currentColor" /><path d="M18 20 44 32 44 68 18 55Z" fill="#d9ece6" stroke="currentColor" /><path d="M44 32 69 20 69 55 44 68Z" fill="#edf0f1" stroke="currentColor" /><path d="M12 63q4 8 13 7m-2-4 2 4-5 2" fill="none" stroke="currentColor" /></g> : <><path d="M23 20 28 10 61 10 66 20Z" fill="#f6f8f8" stroke="currentColor" /><path d="M23 20H66V66H23Z" fill={angle === "front" || angle === "top" ? "#d9ece6" : "#edf0f1"} stroke="currentColor" /></>}
    <text x={perspective ? "33" : "44"} y={perspective ? "46" : "47"} fontSize="15" fontFamily="inherit" textAnchor="middle" fill="currentColor">{mark}</text>
  </svg>;
}
