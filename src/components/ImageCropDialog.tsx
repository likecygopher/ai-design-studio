"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { Crop, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { computeCoverCropPlacement } from "@/src/domain/image-crop";
import styles from "./ImageCropDialog.module.css";
import { useI18n } from "@/src/i18n/I18nProvider";

type ImageCropDialogProps = {
  file: File;
  aspectRatio: number;
  title?: string;
  onCancel: () => void;
  onConfirm: (file: File) => void | Promise<void>;
};

type DragState = {
  pointerId: number;
  clientX: number;
  clientY: number;
  panX: number;
  panY: number;
};

const PREVIEW_WIDTH = 720;
const OUTPUT_WIDTH = 1600;

export function ImageCropDialog({
  file,
  aspectRatio,
  title = "编辑替换图片",
  onCancel,
  onConfirm
}: ImageCropDialogProps) {
  const { t } = useI18n();
  const safeAspect = Math.min(Math.max(aspectRatio || 1, 0.35), 4);
  const previewHeight = Math.round(PREVIEW_WIDTH / safeAspect);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      imageRef.current = image;
      setReady(true);
    };
    image.src = url;
    return () => {
      if (typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(url);
      }
      imageRef.current = null;
    };
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !ready) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    drawCrop(context, image, canvas.width, canvas.height, zoom, panX, panY);
  }, [panX, panY, previewHeight, ready, zoom]);

  function startDrag(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!ready || event.button !== 0) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      panX,
      panY
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !canvas || !image) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const placement = computeCoverCropPlacement({
      imageWidth: image.naturalWidth,
      imageHeight: image.naturalHeight,
      viewportWidth: canvas.width,
      viewportHeight: canvas.height,
      zoom
    });
    const scaleX = canvas.width / Math.max(rect.width, 1);
    const scaleY = canvas.height / Math.max(rect.height, 1);
    const deltaX = (event.clientX - drag.clientX) * scaleX;
    const deltaY = (event.clientY - drag.clientY) * scaleY;
    setPanX(clamp(drag.panX + deltaX / Math.max(placement.maxPanX, 1), -1, 1));
    setPanY(clamp(drag.panY + deltaY / Math.max(placement.maxPanY, 1), -1, 1));
  }

  function finishDrag(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
  }

  function reset() {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }

  async function confirm() {
    const image = imageRef.current;
    if (!image || saving) {
      return;
    }
    setSaving(true);
    try {
      const output = document.createElement("canvas");
      output.width = OUTPUT_WIDTH;
      output.height = Math.max(1, Math.round(OUTPUT_WIDTH / safeAspect));
      const context = output.getContext("2d");
      if (!context) {
        throw new Error(t("当前浏览器不支持图片裁切"));
      }
      drawCrop(context, image, output.width, output.height, zoom, panX, panY);
      const blob = await canvasToBlob(output);
      const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
      await onConfirm(new File([blob], `${baseName}-cropped.png`, { type: "image/png" }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.backdrop} onPointerDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section aria-modal="true" className={styles.dialog} role="dialog">
        <header className={styles.header}>
          <div>
            <span>IMAGE CROP</span>
            <h2>{t(title)}</h2>
          </div>
          <button aria-label={t("关闭图片编辑器")} className={styles.iconButton} onClick={onCancel} type="button">
            <X aria-hidden size={18} />
          </button>
        </header>

        <div className={styles.canvasStage}>
          <canvas
            aria-label={t("图片裁切画布")}
            className={styles.canvas}
            height={previewHeight}
            onPointerCancel={finishDrag}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            ref={canvasRef}
            width={PREVIEW_WIDTH}
          />
          <span className={styles.cropGuide}>
            <Crop aria-hidden size={17} /> {t("拖动图片调整取景")}
          </span>
        </div>

        <div className={styles.controls}>
          <button
            aria-label={t("缩小图片")}
            className={styles.iconButton}
            onClick={() => setZoom((current) => clamp(current - 0.1, 0.25, 3))}
            type="button"
          >
            <ZoomOut aria-hidden size={16} />
          </button>
          <input
            aria-label={t("图片缩放")}
            max="3"
            min="0.25"
            onChange={(event) => setZoom(Number(event.target.value))}
            step="0.01"
            type="range"
            value={zoom}
          />
          <button
            aria-label={t("放大图片")}
            className={styles.iconButton}
            onClick={() => setZoom((current) => clamp(current + 0.1, 0.25, 3))}
            type="button"
          >
            <ZoomIn aria-hidden size={16} />
          </button>
          <output>{Math.round(zoom * 100)}%</output>
          <button className={styles.secondaryButton} onClick={reset} type="button">
            <RotateCcw aria-hidden size={15} /> {t("重置")}
          </button>
        </div>

        <footer className={styles.footer}>
          <span>{t("支持 25%–300% 缩放；留白区域将保持透明。")}</span>
          <div>
            <button className={styles.secondaryButton} onClick={onCancel} type="button">
          {t("取消")}
        </button>
            <button className={styles.primaryButton} disabled={!ready || saving} onClick={confirm} type="button">
              <Crop aria-hidden size={16} /> {saving ? t("处理中") : t("应用裁切")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function drawCrop(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  zoom: number,
  panX: number,
  panY: number
) {
  const placement = computeCoverCropPlacement({
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight,
    viewportWidth: width,
    viewportHeight: height,
    zoom,
    panX,
    panY
  });
  context.clearRect(0, 0, width, height);

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, placement.x, placement.y, placement.width, placement.height);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("图片裁切失败"));
    }, "image/png", 0.95);
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
