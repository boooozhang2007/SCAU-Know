type VisibilityCallback = (visible: boolean) => void;

const callbacks = new WeakMap<Element, VisibilityCallback>();
let sharedObserver: IntersectionObserver | null = null;

function getObserver(): IntersectionObserver | null {
  if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
    return null;
  }
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const cb = callbacks.get(entry.target);
          if (cb) cb(entry.isIntersecting);
        }
      },
      {
        rootMargin: "320px 0px 420px 0px",
        threshold: 0,
      },
    );
  }
  return sharedObserver;
}

/**
 * 共享单个 IntersectionObserver 按视口缓冲动态挂载/卸载卡片封面 `<img>`。
 */
export function observeViewport(el: Element, cb: VisibilityCallback): () => void {
  const observer = getObserver();
  if (!observer) {
    cb(true);
    return () => {};
  }
  callbacks.set(el, cb);
  observer.observe(el);
  return () => {
    callbacks.delete(el);
    observer.unobserve(el);
  };
}
