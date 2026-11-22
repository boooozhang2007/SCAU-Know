import { useId } from "react";

/**
 * 站标：紫荆花圆角方章（独立绘制，融入华农标准绿 #007848）。
 * 紫荆（Bauhinia）是华南农业大学校园标志性花木。
 */
export function LogoMark({ className }: { className?: string }) {
  const gradId = useId();
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#089B60" />
          <stop offset="100%" stopColor="#006A40" />
        </linearGradient>
      </defs>

      {/* 圆润方章底板，呼应源站可爱圆润图标气质，同时融入华农生态绿 */}
      <rect width="64" height="64" rx="17" fill={`url(#${gradId})`} />
      <rect
        x="1"
        y="1"
        width="62"
        height="62"
        rx="16"
        stroke="#ffffff"
        strokeOpacity="0.16"
        strokeWidth="1.5"
      />

      {/* 五瓣紫荆花 */}
      <g transform="translate(32 32)">
        {[0, 72, 144, 216, 288].map((deg) => (
          <path
            key={deg}
            d="M0 -3.2 C-4.8 -6.8 -7.3 -13 -4.2 -17.8 C-2.4 -20.6 0 -22 0 -22 C0 -22 2.4 -20.6 4.2 -17.8 C7.3 -13 4.8 -6.8 0 -3.2 Z"
            fill="#ffffff"
            fillOpacity="0.95"
            transform={`rotate(${deg})`}
          />
        ))}
        {/* 花心与细蕊 */}
        <circle r="4.4" fill="#007848" />
        <circle r="2" fill="#bbf7d0" />
      </g>
    </svg>
  );
}

/** 水平单行组合字标：「华农知道」 SCAU Know */
export function BrandWordmark() {
  return (
    <span className="brand-wordmark">
      <span className="brand-cn" aria-hidden="true">
        <span className="brand-quote">「</span>
        华农知道
        <span className="brand-quote">」</span>
      </span>
      <span className="brand-en" aria-hidden="true" lang="en">
        SCAU Know
      </span>
    </span>
  );
}
