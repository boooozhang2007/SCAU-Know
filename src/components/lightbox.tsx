"use client";

import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { ModalDialog } from "./dialog";

export interface LightboxImage {
  src: string;
  originalSrc?: string;
  alt?: string;
}

/**
 * 原图灯箱：
 * - 基于原生 `<dialog>` 顶层渲染，支持 Esc / 点击外侧关闭
 * - 支持「适应屏幕 ↔ 1:1 原始像素尺寸」一键切换（1:1 下可自由上下左右滚动浏览超长海报/高清图）
 * - 支持多图键盘 ←/→ 切换与新窗口直开原图
 */
export function ImageLightbox({
  images,
  index,
  onClose,
  onIndexChange,
}: {
  images: LightboxImage[];
  index: number | null;
  onClose: () => void;
  onIndexChange: (next: number) => void;
}) {
  const [originalMode, setOriginalMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  const open = index !== null && index >= 0 && index < images.length;
  const current = open ? images[index!] : null;

  useEffect(() => {
    setNaturalSize(null);
    setZoom(1);
    setOriginalMode(false);
  }, [index]);

  useEffect(() => {
    if (!open || images.length <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onIndexChange((index! - 1 + images.length) % images.length);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onIndexChange((index! + 1) % images.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, images.length, onIndexChange]);

  const imgUrl = current ? current.originalSrc || current.src : "";

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      className="modal-dialog lightbox-dialog"
      label="原图预览灯箱"
    >
      {current && (
        <>
          <div className="lightbox-toolbar">
            <div className="lightbox-info">
              {images.length > 1 && (
                <span className="lightbox-counter">
                  {(index ?? 0) + 1} / {images.length}
                </span>
              )}
              {naturalSize && (
                <span className="lightbox-dims">
                  {naturalSize.w} × {naturalSize.h}px
                </span>
              )}
              {current.alt && <span className="lightbox-caption">{current.alt}</span>}
            </div>

            <div className="lightbox-actions">
              <button
                type="button"
                className="lightbox-btn"
                data-active={originalMode ? "true" : undefined}
                onClick={() => {
                  setOriginalMode((v) => !v);
                  setZoom(1);
                }}
                title="切换适应屏幕与 1:1 原始像素尺寸"
              >
                {originalMode ? <Minimize2 /> : <Maximize2 />}
                <span>{originalMode ? "适应屏幕" : "1:1 原尺寸"}</span>
              </button>

              {!originalMode && (
                <>
                  <button
                    type="button"
                    className="lightbox-btn lightbox-btn-icon"
                    aria-label="缩小"
                    onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                  >
                    <ZoomOut />
                  </button>
                  <button
                    type="button"
                    className="lightbox-btn"
                    onClick={() => setZoom(1)}
                    title="重置缩放"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    className="lightbox-btn lightbox-btn-icon"
                    aria-label="放大"
                    onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                  >
                    <ZoomIn />
                  </button>
                </>
              )}

              <a
                href={imgUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="lightbox-btn"
                title="在新标签页打开原图"
              >
                <span>打开原图</span>
                <ArrowUpRight />
              </a>

              <button
                type="button"
                className="lightbox-btn lightbox-btn-icon"
                aria-label="关闭灯箱"
                onClick={onClose}
              >
                <X />
              </button>
            </div>
          </div>

          <div
            className={`lightbox-stage ${originalMode ? "is-original" : "is-fit"}`}
          >
            {images.length > 1 && (
              <button
                type="button"
                className="lightbox-nav lightbox-prev"
                aria-label="上一张"
                onClick={() => onIndexChange((index! - 1 + images.length) % images.length)}
              >
                <ChevronLeft />
              </button>
            )}

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imgUrl}
              alt={current.alt || "通知图片原图"}
              style={
                originalMode
                  ? undefined
                  : zoom !== 1
                    ? { transform: `scale(${zoom})`, transformOrigin: "center center" }
                    : undefined
              }
              onLoad={(e) => {
                const el = e.currentTarget;
                if (el.naturalWidth && el.naturalHeight) {
                  setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight });
                }
              }}
            />

            {images.length > 1 && (
              <button
                type="button"
                className="lightbox-nav lightbox-next"
                aria-label="下一张"
                onClick={() => onIndexChange((index! + 1) % images.length)}
              >
                <ChevronRight />
              </button>
            )}
          </div>
        </>
      )}
    </ModalDialog>
  );
}
