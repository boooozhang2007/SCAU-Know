"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

let cachedDisplayTransition: boolean | undefined;

/**
 * 探测浏览器是否真正支持 display 离散过渡（绕开 Firefox 129+ 仅解析但未实现的问题）。
 */
function canTransitionDisplay(): boolean {
  if (cachedDisplayTransition !== undefined) return cachedDisplayTransition;
  if (
    typeof window === "undefined" ||
    !window.CSS?.supports?.("transition-behavior", "allow-discrete") ||
    !document.body
  ) {
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText =
    "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  cachedDisplayTransition = getComputedStyle(probe).display === "block";
  probe.remove();
  return cachedDisplayTransition;
}

function supportsTopLayerExit(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.CSS?.supports?.("overlay", "auto") &&
    canTransitionDisplay()
  );
}

async function closeDialogSmoothly(el: HTMLDialogElement) {
  if (!el.open) return;
  if (!supportsTopLayerExit()) {
    el.setAttribute("data-closing", "");
    const animations = el.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 320)),
      ]);
    }
    if (!el.hasAttribute("data-closing")) return;
    el.removeAttribute("data-closing");
  }
  if (el.open) el.close();
}

/**
 * 原生 `<dialog>` 模态弹层封装：
 * - 始终挂载 `<dialog>`，通过 `showModal()` 进顶层（无需手动 role="dialog"/aria-modal/body overflow 锁屏）
 * - 支持 `closedby="any"` 点击遮罩关闭，并为不支持 `closedby` 的 Safari 提供 pointerdown+pointerup 坐标回退
 * - 支持 `@starting-style` + `transition-behavior: allow-discrete` 入场与退场过渡
 */
export function ModalDialog({
  open,
  onClose,
  className,
  labelledBy,
  label,
  tone,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className: string;
  labelledBy?: string;
  label?: string;
  tone?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [rendered, setRendered] = useState(open);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (open) {
      setRendered(true);
      el.removeAttribute("data-closing");
      if (!el.open) {
        el.showModal();
      }
    } else if (el.open) {
      void closeDialogSmoothly(el);
    } else {
      setRendered(false);
    }
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleClose = () => {
      el.returnValue = "";
      el.removeAttribute("data-closing");
      setRendered(false);
      onCloseRef.current();
    };

    const handleCancel = (e: Event) => {
      if (!supportsTopLayerExit()) {
        e.preventDefault();
        void closeDialogSmoothly(el);
      }
    };

    el.addEventListener("close", handleClose);
    el.addEventListener("cancel", handleCancel);

    // Safari 暂不支持 closedby="any" 时，用 pointerdown + pointerup 坐标判断外部点击，
    // 要求按下与抬起均落在弹层外部，避免拖选正文时误关闭。
    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };
    const needsLightDismissFallback =
      typeof HTMLDialogElement !== "undefined" &&
      !("closedBy" in HTMLDialogElement.prototype);

    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        void closeDialogSmoothly(el);
      }
      pressedOutside = false;
    };

    if (needsLightDismissFallback) {
      el.addEventListener("pointerdown", onPointerDown);
      el.addEventListener("pointerup", onPointerUp);
    }

    return () => {
      el.removeEventListener("close", handleClose);
      el.removeEventListener("cancel", handleCancel);
      if (needsLightDismissFallback) {
        el.removeEventListener("pointerdown", onPointerDown);
        el.removeEventListener("pointerup", onPointerUp);
      }
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      aria-label={!labelledBy ? label : undefined}
      data-tone={tone}
      {...({ closedby: "any" } as Record<string, string>)}
    >
      {rendered ? children : null}
    </dialog>
  );
}
