"use client";

import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { Check, Copy, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import styles from "./GlassTuner.module.css";
import { useI18n } from "@/src/i18n/I18nProvider";

export const GLASS_TUNER_STORAGE_KEY = "midea-home-glass-tuner-v2";

export type EdgeTunerSettings = {
  edgeBorderColor: string;
  edgeBorderMidColor: string;
  edgeBorderEndColor: string;
  edgeBorderGradientAngle: number;
  edgeBorderGradientMidpoint: number;
  edgeBorderOpacity: number;
  edgeBorderWidth: number;
  edgeGlowColor: string;
  edgeGlowBrightness: number;
  edgeGlowSize: number;
  edgeGlowSpan: number;
  edgeGlowSpeed: number;
  navBorderColor: string;
  navBorderEndColor: string;
  navBorderGradientAngle: number;
  navBorderOpacity: number;
  navBorderWidth: number;
  navGlowColor: string;
  navGlowBrightness: number;
  navGlowSize: number;
  navGlowSpan: number;
  navGlowSpeed: number;
};

export type GlassTunerSettings = EdgeTunerSettings & {
  frameColor: string;
  surfaceColor: string;
  frameOpacity: number;
  surfaceOpacity: number;
  controlOpacity: number;
  blur: number;
  saturation: number;
  overlayOpacity: number;
};

export const DEFAULT_EDGE_TUNER_SETTINGS: EdgeTunerSettings = {
  edgeBorderColor: "#e6e6e6",
  edgeBorderMidColor: "#b5b5b5",
  edgeBorderEndColor: "#696969",
  edgeBorderGradientAngle: 78,
  edgeBorderGradientMidpoint: 52,
  edgeBorderOpacity: 0.1,
  edgeBorderWidth: 1,
  edgeGlowColor: "#ffffff",
  edgeGlowBrightness: 1,
  edgeGlowSize: 27,
  edgeGlowSpan: 80,
  edgeGlowSpeed: 5.6,
  navBorderColor: "#ffffff",
  navBorderEndColor: "#999999",
  navBorderGradientAngle: 128,
  navBorderOpacity: 0.06,
  navBorderWidth: 0.9,
  navGlowColor: "#ffffff",
  navGlowBrightness: 1,
  navGlowSize: 8,
  navGlowSpan: 106,
  navGlowSpeed: 3
};

export const DEFAULT_GLASS_TUNER_SETTINGS: GlassTunerSettings = {
  frameColor: "#f0f5f7",
  surfaceColor: "#ffffff",
  frameOpacity: 0.18,
  surfaceOpacity: 0.18,
  controlOpacity: 0.24,
  blur: 24,
  saturation: 128,
  overlayOpacity: 0.14,
  ...DEFAULT_EDGE_TUNER_SETTINGS
};

type GlassTunerProps = {
  resetSettings: () => void;
  setSettings: Dispatch<SetStateAction<GlassTunerSettings>>;
  settings: GlassTunerSettings;
  triggerClassName: string;
  embedded?: boolean;
};

type ColorControlProps = {
  label: string;
  onChange: (value: string) => void;
  value: string;
};

type RangeControlProps = {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  suffix?: string;
  value: number;
};

export function useGlassTunerSettings() {
  const [settings, setSettings] = useState(DEFAULT_GLASS_TUNER_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(GLASS_TUNER_STORAGE_KEY);
      if (stored) {
        setSettings(normalizeSettings(JSON.parse(stored) as Partial<GlassTunerSettings>));
      }
    } catch {
      window.localStorage.removeItem(GLASS_TUNER_STORAGE_KEY);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (loaded) {
      window.localStorage.setItem(GLASS_TUNER_STORAGE_KEY, JSON.stringify(settings));
    }
  }, [loaded, settings]);

  const resetSettings = () => {
    setSettings(DEFAULT_GLASS_TUNER_SETTINGS);
  };

  return { resetSettings, setSettings, settings };
}

export function getGlassTunerStyle(settings: GlassTunerSettings): CSSProperties {
  const edgeStops = getConicStops(settings.edgeGlowSpan);
  const navStops = getConicStops(settings.navGlowSpan);
  return {
    "--home-frame-rgb": hexToRgbTuple(settings.frameColor),
    "--home-surface-rgb": hexToRgbTuple(settings.surfaceColor),
    "--home-frame-opacity": String(settings.frameOpacity),
    "--home-surface-opacity": String(settings.surfaceOpacity),
    "--home-control-opacity": String(settings.controlOpacity),
    "--home-glass-blur": settings.blur + "px",
    "--home-glass-saturation": settings.saturation + "%",
    "--home-overlay-opacity": String(settings.overlayOpacity),
    "--studio-border-start-rgb": hexToRgbTuple(settings.edgeBorderColor),
    "--studio-border-mid-rgb": hexToRgbTuple(settings.edgeBorderMidColor),
    "--studio-border-end-rgb": hexToRgbTuple(settings.edgeBorderEndColor),
    "--studio-border-gradient-angle": formatDegrees(settings.edgeBorderGradientAngle),
    "--studio-border-gradient-midpoint": settings.edgeBorderGradientMidpoint + "%",
    "--studio-border-opacity": formatCssNumber(settings.edgeBorderOpacity),
    "--studio-border-width": settings.edgeBorderWidth + "px",
    "--studio-edge-glow-rgb": hexToRgbTuple(settings.edgeGlowColor),
    "--studio-edge-glow-opacity": formatCssNumber(settings.edgeGlowBrightness),
    "--studio-edge-glow-mid-opacity": formatCssNumber(settings.edgeGlowBrightness * 0.52),
    "--studio-edge-glow-soft-opacity": formatCssNumber(settings.edgeGlowBrightness * 0.16),
    "--studio-edge-glow-size": settings.edgeGlowSize + "px",
    "--studio-edge-glow-speed": settings.edgeGlowSpeed + "s",
    "--studio-edge-glow-start": edgeStops.start,
    "--studio-edge-glow-leading": edgeStops.leading,
    "--studio-edge-glow-peak": edgeStops.peak,
    "--studio-edge-glow-trailing": edgeStops.trailing,
    "--studio-nav-border-start-rgb": hexToRgbTuple(settings.navBorderColor),
    "--studio-nav-border-end-rgb": hexToRgbTuple(settings.navBorderEndColor),
    "--studio-nav-border-gradient-angle": formatDegrees(settings.navBorderGradientAngle),
    "--studio-nav-border-opacity": formatCssNumber(settings.navBorderOpacity),
    "--studio-nav-border-width": settings.navBorderWidth + "px",
    "--studio-nav-glow-rgb": hexToRgbTuple(settings.navGlowColor),
    "--studio-nav-glow-opacity": formatCssNumber(settings.navGlowBrightness),
    "--studio-nav-glow-mid-opacity": formatCssNumber(settings.navGlowBrightness * 0.52),
    "--studio-nav-glow-soft-opacity": formatCssNumber(settings.navGlowBrightness * 0.16),
    "--studio-nav-glow-size": settings.navGlowSize + "px",
    "--studio-nav-glow-speed": settings.navGlowSpeed + "s",
    "--studio-nav-glow-start": navStops.start,
    "--studio-nav-glow-leading": navStops.leading,
    "--studio-nav-glow-peak": navStops.peak,
    "--studio-nav-glow-trailing": navStops.trailing
  } as CSSProperties;
}

export function serializeGlassTunerSettings(settings: GlassTunerSettings) {
  return [
    "frameColor=" + settings.frameColor,
    "surfaceColor=" + settings.surfaceColor,
    "frameOpacity=" + settings.frameOpacity.toFixed(2),
    "surfaceOpacity=" + settings.surfaceOpacity.toFixed(2),
    "controlOpacity=" + settings.controlOpacity.toFixed(2),
    "blur=" + settings.blur + "px",
    "saturation=" + settings.saturation + "%",
    "overlayOpacity=" + settings.overlayOpacity.toFixed(2)
  ].join("; ");
}

export function GlassTuner({
  resetSettings,
  setSettings,
  settings,
  triggerClassName,
  embedded = false
}: GlassTunerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const serializedSettings = serializeGlassTunerSettings(settings);

  const updateSetting = <Key extends keyof GlassTunerSettings>(
    key: Key,
    value: GlassTunerSettings[Key]
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const copySettings = async () => {
    let copySucceeded = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(serializedSettings);
        copySucceeded = true;
      }
    } catch {
      copySucceeded = false;
    }

    if (!copySucceeded) {
      copySucceeded = copyWithTemporaryInput(serializedSettings);
    }
    if (!copySucceeded) {
      return;
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={styles.root}>
      {!embedded ? <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={triggerClassName}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <SlidersHorizontal size={18} />
        <span>{t("玻璃参数")}</span>
      </button> : null}

      {open || embedded ? (
        <aside aria-label={t("毛玻璃参数调节")} className={embedded ? styles.embeddedPanel : styles.panel}>
          <header className={styles.header}>
            <div>
              {!embedded ? <span>TEMP</span> : null}
              <strong>{t("毛玻璃参数")}</strong>
            </div>
            {!embedded ? <button
              aria-label={t("关闭毛玻璃参数")}
              className={styles.iconButton}
              onClick={() => setOpen(false)}
              type="button"
            >
              <X size={17} />
            </button> : null}
          </header>

          <div className={styles.colorGrid}>
            <ColorControl
              label={t("主窗玻璃色")}
              onChange={(value) => updateSetting("frameColor", value)}
              value={settings.frameColor}
            />
            <ColorControl
              label={t("内层玻璃色")}
              onChange={(value) => updateSetting("surfaceColor", value)}
              value={settings.surfaceColor}
            />
          </div>

          <div className={styles.rangeList}>
            <RangeControl
              label={t("主窗透明度")}
              max={0.7}
              min={0}
              onChange={(value) => updateSetting("frameOpacity", value)}
              step={0.01}
              value={settings.frameOpacity}
            />
            <RangeControl
              label={t("卡片透明度")}
              max={0.8}
              min={0}
              onChange={(value) => updateSetting("surfaceOpacity", value)}
              step={0.01}
              value={settings.surfaceOpacity}
            />
            <RangeControl
              label={t("控件透明度")}
              max={0.9}
              min={0}
              onChange={(value) => updateSetting("controlOpacity", value)}
              step={0.01}
              value={settings.controlOpacity}
            />
            <RangeControl
              label={t("模糊强度")}
              max={48}
              min={0}
              onChange={(value) => updateSetting("blur", value)}
              step={1}
              suffix="px"
              value={settings.blur}
            />
            <RangeControl
              label={t("色彩饱和度")}
              max={180}
              min={60}
              onChange={(value) => updateSetting("saturation", value)}
              step={1}
              suffix="%"
              value={settings.saturation}
            />
            <RangeControl
              label={t("底图遮罩")}
              max={0.5}
              min={0}
              onChange={(value) => updateSetting("overlayOpacity", value)}
              step={0.01}
              value={settings.overlayOpacity}
            />
          </div>

          <code className={styles.values}>{serializedSettings}</code>

          <div className={styles.actions}>
            <button onClick={resetSettings} type="button">
              <RotateCcw size={15} />
              {t("恢复默认")}
            </button>
            <button className={styles.copyButton} onClick={copySettings} type="button">
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? t("已复制") : t("复制参数")}
            </button>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function ColorControl({ label, onChange, value }: ColorControlProps) {
  return (
    <label className={styles.colorControl}>
      <span>{label}</span>
      <span className={styles.colorValue}>
        <input
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={value}
        />
        <output>{value.toUpperCase()}</output>
      </span>
    </label>
  );
}

function RangeControl({
  label,
  max,
  min,
  onChange,
  step,
  suffix = "",
  value
}: RangeControlProps) {
  return (
    <label className={styles.rangeControl}>
      <span>{label}</span>
      <input
        aria-label={label}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
      <output>
        {step < 1 ? value.toFixed(2) : value}
        {suffix}
      </output>
    </label>
  );
}

function normalizeSettings(input: Partial<GlassTunerSettings>): GlassTunerSettings {
  return {
    frameColor: normalizeColor(input.frameColor, DEFAULT_GLASS_TUNER_SETTINGS.frameColor),
    surfaceColor: normalizeColor(input.surfaceColor, DEFAULT_GLASS_TUNER_SETTINGS.surfaceColor),
    frameOpacity: normalizeNumber(input.frameOpacity, 0, 0.7, DEFAULT_GLASS_TUNER_SETTINGS.frameOpacity),
    surfaceOpacity: normalizeNumber(
      input.surfaceOpacity,
      0,
      0.8,
      DEFAULT_GLASS_TUNER_SETTINGS.surfaceOpacity
    ),
    controlOpacity: normalizeNumber(
      input.controlOpacity,
      0,
      0.9,
      DEFAULT_GLASS_TUNER_SETTINGS.controlOpacity
    ),
    blur: normalizeNumber(input.blur, 0, 48, DEFAULT_GLASS_TUNER_SETTINGS.blur),
    saturation: normalizeNumber(
      input.saturation,
      60,
      180,
      DEFAULT_GLASS_TUNER_SETTINGS.saturation
    ),
    overlayOpacity: normalizeNumber(
      input.overlayOpacity,
      0,
      0.5,
      DEFAULT_GLASS_TUNER_SETTINGS.overlayOpacity
    ),
    edgeBorderColor: normalizeLegacyEdgeColor(
      input.edgeBorderColor,
      DEFAULT_EDGE_TUNER_SETTINGS.edgeBorderColor,
      ["#ffffff"]
    ),
    edgeBorderMidColor: normalizeColor(input.edgeBorderMidColor, DEFAULT_EDGE_TUNER_SETTINGS.edgeBorderMidColor),
    edgeBorderEndColor: normalizeColor(input.edgeBorderEndColor, DEFAULT_EDGE_TUNER_SETTINGS.edgeBorderEndColor),
    edgeBorderGradientAngle: normalizeNumber(input.edgeBorderGradientAngle, 0, 360, DEFAULT_EDGE_TUNER_SETTINGS.edgeBorderGradientAngle),
    edgeBorderGradientMidpoint: normalizeNumber(input.edgeBorderGradientMidpoint, 10, 90, DEFAULT_EDGE_TUNER_SETTINGS.edgeBorderGradientMidpoint),
    edgeBorderOpacity: normalizeNumber(input.edgeBorderOpacity, 0, 1, DEFAULT_EDGE_TUNER_SETTINGS.edgeBorderOpacity),
    edgeBorderWidth: normalizeNumber(input.edgeBorderWidth, 0.5, 4, DEFAULT_EDGE_TUNER_SETTINGS.edgeBorderWidth),
    edgeGlowColor: normalizeLegacyEdgeColor(
      input.edgeGlowColor,
      DEFAULT_EDGE_TUNER_SETTINGS.edgeGlowColor,
      ["#dafff2"]
    ),
    edgeGlowBrightness: normalizeNumber(input.edgeGlowBrightness, 0, 1, DEFAULT_EDGE_TUNER_SETTINGS.edgeGlowBrightness),
    edgeGlowSize: normalizeNumber(input.edgeGlowSize, 0, 30, DEFAULT_EDGE_TUNER_SETTINGS.edgeGlowSize),
    edgeGlowSpan: normalizeNumber(input.edgeGlowSpan, 20, 180, DEFAULT_EDGE_TUNER_SETTINGS.edgeGlowSpan),
    edgeGlowSpeed: normalizeNumber(input.edgeGlowSpeed, 1.5, 20, DEFAULT_EDGE_TUNER_SETTINGS.edgeGlowSpeed),
    navBorderColor: normalizeLegacyEdgeColor(
      input.navBorderColor,
      DEFAULT_EDGE_TUNER_SETTINGS.navBorderColor,
      ["#ffffff"]
    ),
    navBorderEndColor: normalizeColor(input.navBorderEndColor, DEFAULT_EDGE_TUNER_SETTINGS.navBorderEndColor),
    navBorderGradientAngle: normalizeNumber(input.navBorderGradientAngle, 0, 360, DEFAULT_EDGE_TUNER_SETTINGS.navBorderGradientAngle),
    navBorderOpacity: normalizeNumber(input.navBorderOpacity, 0, 1, DEFAULT_EDGE_TUNER_SETTINGS.navBorderOpacity),
    navBorderWidth: normalizeNumber(input.navBorderWidth, 0.5, 3, DEFAULT_EDGE_TUNER_SETTINGS.navBorderWidth),
    navGlowColor: normalizeLegacyEdgeColor(
      input.navGlowColor,
      DEFAULT_EDGE_TUNER_SETTINGS.navGlowColor,
      ["#dafff2"]
    ),
    navGlowBrightness: normalizeNumber(input.navGlowBrightness, 0, 1, DEFAULT_EDGE_TUNER_SETTINGS.navGlowBrightness),
    navGlowSize: normalizeNumber(input.navGlowSize, 0, 24, DEFAULT_EDGE_TUNER_SETTINGS.navGlowSize),
    navGlowSpan: normalizeNumber(input.navGlowSpan, 20, 180, DEFAULT_EDGE_TUNER_SETTINGS.navGlowSpan),
    navGlowSpeed: normalizeNumber(input.navGlowSpeed, 1.5, 20, DEFAULT_EDGE_TUNER_SETTINGS.navGlowSpeed)
  };
}

function normalizeColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function normalizeLegacyEdgeColor(value: unknown, fallback: string, legacyColors: string[]) {
  const normalized = normalizeColor(value, fallback);
  return legacyColors.includes(normalized.toLowerCase()) ? "#4f99ff" : normalized;
}

function normalizeNumber(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function copyWithTemporaryInput(value: string) {
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  return copied;
}

function getConicStops(span: number) {
  const start = 360 - span;
  return {
    start: formatDegrees(start),
    leading: formatDegrees(start + span * 0.2),
    peak: formatDegrees(start + span * 0.5),
    trailing: formatDegrees(start + span * 0.82)
  };
}

function formatDegrees(value: number) {
  return value.toFixed(1).replace(/\.0$/, "") + "deg";
}

function formatCssNumber(value: number) {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
function hexToRgbTuple(hex: string) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  ].join(", ");
}
