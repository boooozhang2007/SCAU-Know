"use client";

import { memo, useEffect, useRef, useState } from "react";
import { CalendarClock, Check, Clock, Paperclip, Star, Users } from "lucide-react";
import type { Notice } from "@/lib/types";
import { formatDeadlineChip, formatEventChip, meaningfulSummary } from "@/lib/format";
import { mediaThumbUrl } from "@/lib/media-url";
import { shortSourceName } from "@/lib/sources";
import { observeViewport } from "@/lib/viewport-observer";
import { usePreferences, type ViewMode } from "@/lib/preferences";

export const NoticeCard = memo(function NoticeCard({
  notice,
  index,
  lang,
  onOpen,
  timeDesktop,
  timeMobile,
  starred,
  priorityCover = false,
}: {
  notice: Notice;
  index: number;
  lang: "zh" | "en";
  onOpen: (n: Notice) => void;
  timeDesktop: string;
  timeMobile: string;
  starred?: boolean;
  priorityCover?: boolean;
}) {
  const en = lang === "en";
  const excerpt = meaningfulSummary(notice.title, notice.summary);
  const shortSrc = shortSourceName(notice.source);
  const eventChip = notice.startsAt ? formatEventChip(notice.startsAt, lang) : null;
  const deadlineChip =
    !eventChip && notice.registrationDeadline
      ? formatDeadlineChip(notice.registrationDeadline, lang)
      : null;
  const audienceList = notice.audience ?? notice.ai?.audience ?? [];
  const specificAudience = audienceList.find(
    (a) => a && a !== "全校师生" && a !== "全校" && a.length <= 12,
  );
  const isImportant = Boolean(notice.important ?? notice.ai?.isImportant);
  const importantReason = notice.importantReason ?? notice.ai?.importantReason;
  const attCount = notice.attachments?.length ?? notice.attachmentCount ?? 0;
  const coverThumb = notice.cover ? mediaThumbUrl(notice.cover, 480) : undefined;
  const coverRef = useRef<HTMLSpanElement>(null);
  const [brokenCoverSrc, setBrokenCoverSrc] = useState<string | null>(null);
  const mountImmediately = priorityCover || index < 12;
  const [coverMounted, setCoverMounted] = useState<boolean>(mountImmediately);
  const showCover = Boolean(coverThumb && brokenCoverSrc !== coverThumb);

  useEffect(() => {
    if (mountImmediately) {
      setCoverMounted(true);
      return;
    }
    const el = coverRef.current;
    if (!showCover || !el) return;
    return observeViewport(el, setCoverMounted);
  }, [mountImmediately, showCover]);

  return (
    <li
      className="notice-block-enter"
      data-tone={notice.tone}
      style={{ ["--i" as string]: Math.min(index, 14) }}
    >
      <button
        type="button"
        className="notice-block"
        data-tone={notice.tone}
        data-new={notice.isNew ? "true" : undefined}
        data-starred={starred ? "true" : undefined}
        data-important={isImportant ? "true" : undefined}
        data-registration={notice.registration ? "true" : undefined}
        aria-haspopup="dialog"
        onClick={() => onOpen(notice)}
      >
        {showCover && coverThumb && (
          <span className="notice-cover" ref={coverRef}>
            {coverMounted && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverThumb}
                alt=""
                width={450}
                height={200}
                loading={priorityCover ? "eager" : "lazy"}
                fetchPriority={priorityCover ? "high" : undefined}
                decoding="async"
                referrerPolicy={coverThumb.startsWith("http") ? "no-referrer" : undefined}
                onError={() => setBrokenCoverSrc(coverThumb)}
              />
            )}
          </span>
        )}

        <span className="notice-block-body">
          <span className="notice-block-title" title={notice.title}>
            {isImportant && (
              <span
                className="notice-important-badge"
                title={importantReason || (en ? "Important notice" : "重要通知")}
              >
                <span aria-hidden="true">{en ? "KEY" : "重要"}</span>
                <span className="sr-only">{en ? "Important notice" : "重要通知"}</span>
              </span>
            )}
            {notice.registration && (
              <span
                className="notice-registration"
                title={en ? "Registration required" : "需报名"}
              >
                <span aria-hidden="true">{en ? "REG" : "报"}</span>
                <span className="sr-only">{en ? "Registration required" : "需报名"}</span>
              </span>
            )}
            {notice.title}
          </span>

          {excerpt && !showCover && (
            <span className="notice-block-excerpt">{excerpt}</span>
          )}

          {(eventChip || deadlineChip || specificAudience || attCount > 0) && (
            <span className="notice-chips-row">
              {eventChip && (
                <span className="notice-event-chip">
                  <CalendarClock aria-hidden="true" />
                  <span className="notice-event-date">{eventChip}</span>
                  {notice.venue && (
                    <span className="notice-event-venue">· {notice.venue}</span>
                  )}
                </span>
              )}
              {deadlineChip && (
                <span className="notice-deadline-chip">
                  <Clock aria-hidden="true" />
                  <span>{deadlineChip}</span>
                </span>
              )}
              {specificAudience && (
                <span
                  className="notice-audience-chip"
                  title={audienceList.join("、")}
                >
                  <Users aria-hidden="true" />
                  <span>{specificAudience}</span>
                </span>
              )}
              {attCount > 0 && (
                <span className="notice-att-chip" title={`包含 ${attCount} 个附件`}>
                  <Paperclip aria-hidden="true" />
                  <span>{attCount}</span>
                </span>
              )}
            </span>
          )}

          <span className="notice-block-meta">
            <time className="notice-block-time" dateTime={notice.publishedAt}>
              {notice.isNew && (
                <span
                  className="notice-arrival-dot"
                  role="img"
                  aria-label={en ? "Published today" : "今日收录"}
                />
              )}
              <span className="notice-time-desktop">{timeDesktop}</span>
              <span className="notice-time-mobile">{timeMobile}</span>
            </time>

            <span className="notice-block-source" title={notice.source}>
              {starred && <Star className="notice-source-star" aria-hidden="true" />}
              <span className="notice-source-text">{shortSrc}</span>
            </span>
          </span>
        </span>
      </button>
    </li>
  );
});

function ColumnBarsIcon({ count }: { count: number }) {
  const n = Math.min(count, 6);
  return (
    <span className="col-bars" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="col-bar" />
      ))}
    </span>
  );
}

export function ColumnPicker({
  value,
  options,
  onChange,
  mobile = false,
}: {
  value: number;
  options: readonly number[];
  onChange: (n: number) => void;
  mobile?: boolean;
}) {
  const { lang } = usePreferences();
  const en = lang === "en";
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      className={`dropdown-wrap ${mobile ? "column-picker-mobile" : "column-picker-desktop"}`}
      ref={wrap}
    >
      <button
        type="button"
        className="toolbar-select"
        data-open={open ? "true" : undefined}
        aria-label={en ? "Columns per row" : "每行显示列数"}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{en ? `${value} Cols` : `${value} 列`}</span>
        <svg className="toolbar-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          className="dropdown-menu"
          role="listbox"
          aria-label={en ? "Columns per row" : "每行显示列数"}
        >
          {options.map((n) => (
            <li key={n} role="presentation">
              <button
                type="button"
                role="option"
                className="dropdown-item"
                aria-selected={n === value}
                onClick={() => {
                  onChange(n);
                  setOpen(false);
                }}
              >
                <ColumnBarsIcon count={n} />
                <span>{en ? `${n} Cols` : `${n} 列`}</span>
                {n === value && <Check className="dropdown-check" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ViewModePicker({
  value,
  onChange,
  starCount,
}: {
  value: ViewMode;
  onChange: (m: ViewMode) => void;
  starCount: number;
}) {
  const { lang } = usePreferences();
  const en = lang === "en";
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const OPTIONS: { value: ViewMode; label: string; labelEn: string }[] = [
    { value: "time", label: "时间排序", labelEn: "Latest" },
    { value: "star-first", label: "星标优先", labelEn: "Starred first" },
    { value: "star-only", label: "只看星标", labelEn: "Starred only" },
  ];

  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];

  return (
    <div className="dropdown-wrap" ref={wrap}>
      <button
        type="button"
        className="toolbar-select"
        data-active={value !== "time" ? "true" : undefined}
        data-open={open ? "true" : undefined}
        aria-label={en ? "Sort and view mode" : "浏览方式"}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <Star
          className="toolbar-star-icon"
          data-filled={value !== "time" ? "true" : undefined}
          aria-hidden="true"
        />
        <span>{en ? current.labelEn : current.label}</span>
        <svg className="toolbar-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          className="dropdown-menu dropdown-menu-wide"
          role="listbox"
          aria-label={en ? "Sort and view mode" : "浏览方式"}
        >
          {OPTIONS.map((opt) => (
            <li key={opt.value} role="presentation">
              <button
                type="button"
                role="option"
                className="dropdown-item"
                aria-selected={opt.value === value}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span>{en ? opt.labelEn : opt.label}</span>
                {opt.value === "star-only" && (
                  <span className="dropdown-hint">{starCount}</span>
                )}
                {opt.value === value && (
                  <Check className="dropdown-check" aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
