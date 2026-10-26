"use client";

import Link from "next/link";
import type { CSSProperties, ComponentType } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Box,
  Boxes,
  CalendarDays,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  FileImage,
  Film,
  Globe2,
  ImageIcon,
  Languages,
  LayoutTemplate,
  PanelTop,
  ScanLine,
  Sparkles,
  Sun,
  SwatchBook,
  WandSparkles
} from "lucide-react";
import styles from "./GlassHomeStudio.module.css";
import { StudioNavigation } from "./StudioNavigation";
import { useI18n } from "@/src/i18n/I18nProvider";
import { WorkspaceLayoutToggle } from "./WorkspaceLayoutToggle";
import { useWorkspaceLayout } from "./useWorkspaceLayout";
import { StudioSettings } from "./StudioSettings";
import { getGlassTunerStyle, useGlassTunerSettings } from "./GlassTuner";
import { useStudioBackground } from "./useStudioBackground";

type StudioLink = {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
};

type WeatherData = {
  condition: string;
  temperature: number;
  weatherCode: number;
};

const quickTools: StudioLink[] = [
  { href: "/white-background", label: "白底多角度", icon: Box },
  { href: "/phone-standardize", label: "手机图标准化", icon: ScanLine },
  { href: "/sku-variants", label: "SKU 局部替换", icon: WandSparkles },
  { href: "/style-transfer", label: "风格迁移", icon: SwatchBook },
  { href: "/icon-design", label: "Icon Design", icon: Sparkles },
  { href: "/product-video", label: "产品视频", icon: Film },
  { href: "/pop", label: "POP 设计", icon: PanelTop },
  { href: "/pdp", label: "PDP 构建", icon: LayoutTemplate },
  { href: "/localize", label: "本地化", icon: Languages },
  { href: "/assets", label: "素材库", icon: Boxes }
];

export function GlassHomeStudio() {
  const { t } = useI18n();
  const { compact } = useWorkspaceLayout();
  const quickScrollerRef = useRef<HTMLDivElement>(null);
  const { backgroundUrl } = useStudioBackground();
  const glass = useGlassTunerSettings();
  const [quickPosition, setQuickPosition] = useState(0);

  const setQuickScroll = (position: number) => {
    setQuickPosition(position);
    const scroller = quickScrollerRef.current;
    if (!scroller) {
      return;
    }
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    scroller.scrollLeft = (position / 100) * maxScroll;
  };

  const syncQuickScroll = () => {
    const scroller = quickScrollerRef.current;
    if (!scroller) {
      return;
    }
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    setQuickPosition(maxScroll > 0 ? (scroller.scrollLeft / maxScroll) * 100 : 0);
  };

  const stageStyle = {
    ...getGlassTunerStyle(glass.settings),
    "--home-background": 'url("' + backgroundUrl + '")'
  } as CSSProperties;

  return (
    <main
      className={styles.stage}
      data-layout={compact ? "compact" : "comfortable"}
      style={stageStyle}
    >
      <div aria-hidden="true" className={styles.background} />

      <section
        aria-label={t("Midea AI Content Studio 工作台")}
        className={styles.workbench}
        data-layout={compact ? "compact" : "comfortable"}
      >
        <aside className={styles.sidebar}>          <div className={styles.brand}>
            <span className={styles.brandOverline}>Midea Overseas</span>
            <strong>AI Content Studio</strong>
          </div>

          <StudioNavigation home className={styles.navigation} />

          <div className={styles.sidebarFooter}>
            <span className={styles.onlineDot} />
            {t("在线生成模式")}
          </div>
        </aside>

        <div className={styles.content}>
          <header className={styles.topbar}>
            <div className={styles.heroCopy}>
              <h1>
                <span>Hi,</span>
                How Can I Help You?
              </h1>
            </div>

            <div className={styles.topbarSide}>
              <div className={styles.utilityGrid}>
                <WorkspaceLayoutToggle />
                <StudioSettings glass={glass} />
                <HomeInfoWidgets />
              </div>
            </div>
          </header>

          <section aria-label={t("从产品开始")} className={styles.startSection}>
            <div className={styles.featureGrid}>
              <Link className={styles.featureCard + " " + styles.productFeature} href="/assets">
                <span aria-hidden="true" className={styles.featureBackdrop} />
                <span className={styles.featureContent}>
                  <span className={styles.featureIcon}>
                    <ImageIcon size={19} />
                  </span>
                  <small>01 / PRODUCT INTAKE</small>
                  <strong>{t("上传产品素材")}</strong>
                  <span>{t("建立产品档案并识别卖点")}</span>
                </span>
                <ArrowUpRight className={styles.featureArrow} size={18} />
              </Link>

              <Link
                className={styles.featureCard + " " + styles.styleFeature}
                href="/style-transfer"
              >
                <span aria-hidden="true" className={styles.featureBackdrop} />
                <span className={styles.featureContent}>
                  <span className={styles.featureIcon}>
                    <SwatchBook size={19} />
                  </span>
                  <small>02 / STYLE SYSTEM</small>
                  <strong>{t("场景与风格")}</strong>
                  <span>{t("Keywords 驱动场景生成")}</span>
                </span>
                <ArrowUpRight className={styles.featureArrow} size={18} />
              </Link>

              <Link
                className={styles.featureCard + " " + styles.deliveryFeature}
                href="/localize"
              >
                <span className={styles.featureContent}>
                  <span className={styles.featureIcon}>
                    <Globe2 size={19} />
                  </span>
                  <small>03 / GLOBAL DELIVERY</small>
                  <strong>{t("全球市场交付")}</strong>
                  <span>{t("图像文字批量本地化")}</span>
                </span>
                <ArrowUpRight className={styles.featureArrow} size={18} />
              </Link>
            </div>
          </section>

          <section aria-label={t("快捷创作")} className={styles.toolsSection}>
            <h2 className={styles.visuallyHidden}>{t("快捷创作")}</h2>
            <label className={styles.quickSlider}>
              <span className={styles.visuallyHidden}>{t("快捷工具横向位置")}</span>
              <input
                aria-label={t("快捷工具横向位置")}
                max="100"
                min="0"
                onChange={(event) => setQuickScroll(Number(event.target.value))}
                step="1"
                type="range"
                value={quickPosition}
              />
            </label>

            <div
              className={styles.quickScroller}
              onScroll={syncQuickScroll}
              ref={quickScrollerRef}
            >
              <div className={styles.quickGrid}>
                {quickTools.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      className={styles.quickTool}
                      href={item.href}
                      key={item.href + "-" + index}
                    >
                      <span className={styles.quickIndex}>
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <Icon size={20} strokeWidth={1.7} />
                      <strong>{t(item.label)}</strong>
                      <ArrowUpRight className={styles.quickArrow} size={15} />
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>

          <footer className={styles.contentFooter}>
            <span>Midea AI Content Studio</span>
            <Link href="/costs">
              <FileImage size={14} /> {t("查看生成记录")}
            </Link>
          </footer>
        </div>
      </section>
    </main>
  );
}

function HomeInfoWidgets() {
  const [now, setNow] = useState<Date>();
  const [weather, setWeather] = useState<WeatherData>();
  const [weatherUnavailable, setWeatherUnavailable] = useState(false);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadWeather = async () => {
      try {
        const response = await fetch("/api/weather", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Weather request failed");
        }
        const nextWeather = (await response.json()) as WeatherData;
        if (!cancelled) {
          setWeather(nextWeather);
          setWeatherUnavailable(false);
        }
      } catch {
        if (!cancelled) {
          setWeather(undefined);
          setWeatherUnavailable(true);
        }
      }
    };

    void loadWeather();
    const timer = window.setInterval(loadWeather, 10 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const date = now
    ? new Intl.DateTimeFormat("en-US", {
        day: "2-digit",
        month: "short",
        timeZone: "Asia/Shanghai"
      }).format(now)
    : "--";
  const weekday = now
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        timeZone: "Asia/Shanghai"
      }).format(now)
    : "Today";
  const WeatherIcon = getWeatherIcon(weather?.weatherCode);

  return (
    <div className={styles.infoStack}>
      <article className={styles.infoCard}>
        <span aria-hidden="true" className={styles.infoBackdrop} />
        <CalendarDays size={18} />
        <span>
          <small>{weekday}</small>
          <strong>{date}</strong>
        </span>
      </article>

      <article className={styles.infoCard}>
        <span aria-hidden="true" className={styles.infoBackdrop} />
        <WeatherIcon size={19} />
        <span>
          <small>Shunde · {weather?.condition ?? (weatherUnavailable ? "Unavailable" : "Loading")}</small>
          <strong>{weather ? Math.round(weather.temperature) + "°C" : "--°C"}</strong>
        </span>
      </article>
    </div>
  );
}

function getWeatherIcon(code: number | undefined) {
  if (code === 0) {
    return Sun;
  }
  if (code === 45 || code === 48) {
    return CloudFog;
  }
  if (code !== undefined && code >= 95) {
    return CloudLightning;
  }
  if (code !== undefined && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))) {
    return CloudRain;
  }
  if (code !== undefined && ((code >= 71 && code <= 77) || (code >= 85 && code <= 86))) {
    return CloudSnow;
  }
  return CloudSun;
}
