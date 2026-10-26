"use client";

import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { Check, Copy, RotateCcw, Sparkles, X } from "lucide-react";
import {
  DEFAULT_EDGE_TUNER_SETTINGS,
  type EdgeTunerSettings,
  type GlassTunerSettings
} from "./GlassTuner";
import styles from "./GlassTuner.module.css";
import { useI18n } from "@/src/i18n/I18nProvider";

type EdgeTunerProps = {
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

export function EdgeTuner({ setSettings, settings, triggerClassName, embedded = false }: EdgeTunerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const serializedSettings = serializeEdgeSettings(settings);

  const updateSetting = <Key extends keyof EdgeTunerSettings>(
    key: Key,
    value: EdgeTunerSettings[Key]
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const resetSettings = () => {
    setSettings((current) => ({ ...current, ...DEFAULT_EDGE_TUNER_SETTINGS }));
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
    if (copySucceeded) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
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
        <Sparkles size={18} />
        <span>{t("边框参数")}</span>
      </button> : null}

      {open || embedded ? (
        <aside aria-label={t("边框与流光参数调节")} className={embedded ? styles.embeddedPanel : styles.panel}>
          <header className={styles.header}>
            <div>
              {!embedded ? <span>TEMP</span> : null}
              <strong>{t("边框与流光参数")}</strong>
            </div>
            {!embedded ? <button
              aria-label={t("关闭边框与流光参数")}
              className={styles.iconButton}
              onClick={() => setOpen(false)}
              type="button"
            >
              <X size={17} />
            </button> : null}
          </header>

          <h3 className={styles.subheading}>{t("主工作台")}</h3>
          <div className={styles.colorGrid}>
            <ColorControl label={t("边框起始色")} onChange={(value) => updateSetting("edgeBorderColor", value)} value={settings.edgeBorderColor} />
            <ColorControl label={t("边框中间色")} onChange={(value) => updateSetting("edgeBorderMidColor", value)} value={settings.edgeBorderMidColor} />
            <ColorControl label={t("边框结束色")} onChange={(value) => updateSetting("edgeBorderEndColor", value)} value={settings.edgeBorderEndColor} />
            <ColorControl label={t("主窗流光色")} onChange={(value) => updateSetting("edgeGlowColor", value)} value={settings.edgeGlowColor} />
          </div>
          <div className={styles.rangeList}>
            <RangeControl label={t("渐变方向")} max={360} min={0} onChange={(value) => updateSetting("edgeBorderGradientAngle", value)} step={1} suffix="deg" value={settings.edgeBorderGradientAngle} />
            <RangeControl label={t("渐变中心")} max={90} min={10} onChange={(value) => updateSetting("edgeBorderGradientMidpoint", value)} step={1} suffix="%" value={settings.edgeBorderGradientMidpoint} />
            <RangeControl label={t("边框透明度")} max={1} min={0} onChange={(value) => updateSetting("edgeBorderOpacity", value)} step={0.01} value={settings.edgeBorderOpacity} />
            <RangeControl label={t("边框宽度")} max={4} min={0.5} onChange={(value) => updateSetting("edgeBorderWidth", value)} step={0.1} suffix="px" value={settings.edgeBorderWidth} />
            <RangeControl label={t("流光亮度")} max={1} min={0} onChange={(value) => updateSetting("edgeGlowBrightness", value)} step={0.01} value={settings.edgeGlowBrightness} />
            <RangeControl label={t("流光光晕")} max={30} min={0} onChange={(value) => updateSetting("edgeGlowSize", value)} step={1} suffix="px" value={settings.edgeGlowSize} />
            <RangeControl label={t("流光弧长")} max={180} min={20} onChange={(value) => updateSetting("edgeGlowSpan", value)} step={1} suffix="deg" value={settings.edgeGlowSpan} />
            <RangeControl label={t("流动速度")} max={20} min={1.5} onChange={(value) => updateSetting("edgeGlowSpeed", value)} step={0.1} suffix="s" value={settings.edgeGlowSpeed} />
          </div>

          <h3 className={styles.subheading}>{t("当前菜单")}</h3>
          <div className={styles.colorGrid}>
            <ColorControl label={t("菜单边框起始色")} onChange={(value) => updateSetting("navBorderColor", value)} value={settings.navBorderColor} />
            <ColorControl label={t("菜单边框结束色")} onChange={(value) => updateSetting("navBorderEndColor", value)} value={settings.navBorderEndColor} />
            <ColorControl label={t("菜单流光色")} onChange={(value) => updateSetting("navGlowColor", value)} value={settings.navGlowColor} />
          </div>
          <div className={styles.rangeList}>
            <RangeControl label={t("菜单渐变方向")} max={360} min={0} onChange={(value) => updateSetting("navBorderGradientAngle", value)} step={1} suffix="deg" value={settings.navBorderGradientAngle} />
            <RangeControl label={t("菜单边框透明度")} max={1} min={0} onChange={(value) => updateSetting("navBorderOpacity", value)} step={0.01} value={settings.navBorderOpacity} />
            <RangeControl label={t("菜单边框宽度")} max={3} min={0.5} onChange={(value) => updateSetting("navBorderWidth", value)} step={0.1} suffix="px" value={settings.navBorderWidth} />
            <RangeControl label={t("菜单流光亮度")} max={1} min={0} onChange={(value) => updateSetting("navGlowBrightness", value)} step={0.01} value={settings.navGlowBrightness} />
            <RangeControl label={t("菜单流光光晕")} max={24} min={0} onChange={(value) => updateSetting("navGlowSize", value)} step={1} suffix="px" value={settings.navGlowSize} />
            <RangeControl label={t("菜单流光弧长")} max={180} min={20} onChange={(value) => updateSetting("navGlowSpan", value)} step={1} suffix="deg" value={settings.navGlowSpan} />
            <RangeControl label={t("菜单流动速度")} max={20} min={1.5} onChange={(value) => updateSetting("navGlowSpeed", value)} step={0.1} suffix="s" value={settings.navGlowSpeed} />
          </div>

          <code className={styles.values}>{serializedSettings}</code>
          <div className={styles.actions}>
            <button onClick={resetSettings} type="button">
              <RotateCcw size={15} />
              {t("恢复边框默认值")}
            </button>
            <button className={styles.copyButton} onClick={copySettings} type="button">
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? t("已复制") : t("复制边框参数")}
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
        <input aria-label={label} onChange={(event) => onChange(event.target.value)} type="color" value={value} />
        <output>{value.toUpperCase()}</output>
      </span>
    </label>
  );
}

function RangeControl({ label, max, min, onChange, step, suffix = "", value }: RangeControlProps) {
  return (
    <label className={styles.rangeControl}>
      <span>{label}</span>
      <input aria-label={label} max={max} min={min} onChange={(event) => onChange(Number(event.target.value))} step={step} type="range" value={value} />
      <output>
        {step < 1 ? value.toFixed(2) : value}
        {suffix}
      </output>
    </label>
  );
}

function serializeEdgeSettings(settings: EdgeTunerSettings) {
  return [
    `edgeBorder=${settings.edgeBorderColor}>${settings.edgeBorderMidColor}@${settings.edgeBorderGradientMidpoint}%>${settings.edgeBorderEndColor}/${settings.edgeBorderGradientAngle}deg/${settings.edgeBorderOpacity.toFixed(2)}/${settings.edgeBorderWidth.toFixed(1)}px`,
    `edgeGlow=${settings.edgeGlowColor}/${settings.edgeGlowBrightness.toFixed(2)}/${settings.edgeGlowSize}px/${settings.edgeGlowSpan}deg/${settings.edgeGlowSpeed.toFixed(1)}s`,
    `navBorder=${settings.navBorderColor}>${settings.navBorderEndColor}/${settings.navBorderGradientAngle}deg/${settings.navBorderOpacity.toFixed(2)}/${settings.navBorderWidth.toFixed(1)}px`,
    `navGlow=${settings.navGlowColor}/${settings.navGlowBrightness.toFixed(2)}/${settings.navGlowSize}px/${settings.navGlowSpan}deg/${settings.navGlowSpeed.toFixed(1)}s`
  ].join("; ");
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
