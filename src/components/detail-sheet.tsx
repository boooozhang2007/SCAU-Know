"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  MapPin,
  Maximize2,
  Paperclip,
  Presentation,
  Share2,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import type { Notice, NoticeAttachment, TableBlock } from "@/lib/types";
import { CATEGORY_MAP } from "@/lib/site";
import {
  categoryName,
  formatFullTime,
  formatRange,
  meaningfulSummary,
  subjectName,
} from "@/lib/format";
import { mediaThumbUrl } from "@/lib/media-url";
import { resolveUrl, sourceHost } from "@/lib/sources";
import { usePreferences } from "@/lib/preferences";
import { Icon } from "./icon";
import { ModalDialog } from "./dialog";
import { ImageLightbox, type LightboxImage } from "./lightbox";

const DETAIL_CACHE = new Map<string, Notice>();

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ATT_ARCHIVE_EXTS = new Set(["zip", "rar", "7z"]);
const ATT_PPT_EXTS = new Set(["ppt", "pptx", "pptm", "ppsx", "dps", "odp"]);

/** 把抓取/解析的原始错误翻成人话，避免页面上出现 "fetch failed" 这类字样 */
function describeAttachmentError(err: string, en: boolean): string {
  if (/^HTTP 404/.test(err)) return en ? "original file removed (404)" : "原文件已失效（404）";
  if (/附件过大/.test(err)) return en ? "file too large — download from source" : "文件过大，请到原站下载";
  if (/^HTTP 4\d\d/.test(err)) return en ? `source rejected (${err})` : `源站拒绝访问（${err}）`;
  if (/aborted|timeout|ECONN|ENOTFOUND|fetch failed|proxy|socket/i.test(err)) {
    return en ? "source unreachable — open on campus network" : "源站不可达，需校园网/VPN 打开";
  }
  return en ? `parse hint: ${err}` : `解析提示：${err}`;
}
const ATT_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);

/** 单个附件预览（支持 Excel 表格、Word/WPS/RTF/PDF/PPT/OFD/压缩包文本、图片附件预览及下载） */
function AttachmentCard({
  att,
  en,
}: {
  att: NoticeAttachment;
  en: boolean;
}) {
  const [expanded, setExpanded] = useState(
    Boolean(att.sheets && att.sheets.length > 0),
  );
  const [sheetIdx, setSheetIdx] = useState(0);

  const extLower = att.ext.toLowerCase();
  const isSpreadsheet = Boolean(att.sheets && att.sheets.length > 0);
  const isArchive = ATT_ARCHIVE_EXTS.has(extLower) || Boolean(att.archiveFiles?.length);
  const isPresentation = ATT_PPT_EXTS.has(extLower);
  const isImageAtt = ATT_IMAGE_EXTS.has(extLower);
  const currentSheet = isSpreadsheet ? att.sheets![sheetIdx] ?? att.sheets![0] : null;
  const downloadHref = att.localPath || att.url;
  const canPreview = isSpreadsheet || Boolean(att.parsedText) || isImageAtt;

  return (
    <div className="attachment-card">
      <div className="attachment-head">
        <span className="attachment-icon" aria-hidden="true">
          {isSpreadsheet ? (
            <FileSpreadsheet />
          ) : isArchive ? (
            <FileArchive />
          ) : isPresentation ? (
            <Presentation />
          ) : isImageAtt ? (
            <ImageIcon />
          ) : (
            <FileText />
          )}
        </span>
        <div className="attachment-meta">
          <span className="attachment-name" title={att.name}>
            {att.name}
          </span>
          <span className="attachment-sub">
            {att.ext.toUpperCase()}
            {att.embedded ? (en ? " · Main PDF" : " · 正文 PDF") : ""}
            {att.size ? ` · ${formatBytes(att.size)}` : ""}
            {att.archiveFiles?.length
              ? en
                ? ` · ${att.archiveFiles.length} files`
                : ` · 含 ${att.archiveFiles.length} 个文件`
              : ""}
            {att.sheets?.length
              ? ` · ${att.sheets.length} 个工作表 (${att.sheets.reduce((s, sh) => s + sh.totalRows, 0)} 行)`
              : ""}
            {att.needsOcr ? " · 扫描件 PDF（文字较少）" : ""}
            {att.error ? ` · ${describeAttachmentError(att.error, en)}` : ""}
          </span>
        </div>

        <div className="attachment-actions">
          {canPreview && (
            <button
              type="button"
              className="plain-button plain-button-sm"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (en ? "Collapse" : "收起内容") : en ? "Preview" : "解析预览"}
            </button>
          )}
          <a
            href={downloadHref}
            target="_blank"
            rel="noreferrer noopener"
            className="plain-button plain-button-sm"
            title={en ? "Download or open file" : "下载 / 查看原文件"}
          >
            <Download style={{ width: 13, height: 13 }} />
            <span>
              {att.ext === "pdf" && att.localPath
                ? en
                  ? "View PDF"
                  : "查看 PDF"
                : en
                  ? "Download"
                  : "原文件"}
            </span>
          </a>
        </div>
      </div>

      {expanded && isImageAtt && (
        <div className="attachment-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="attachment-img-preview"
            src={downloadHref}
            alt={att.name}
            loading="lazy"
            decoding="async"
            referrerPolicy={downloadHref.startsWith("http") ? "no-referrer" : undefined}
          />
        </div>
      )}

      {expanded && isSpreadsheet && currentSheet && (
        <div className="attachment-preview">
          {att.sheets!.length > 1 && (
            <div className="sheet-tabs" role="tablist">
              {att.sheets!.map((sh, i) => (
                <button
                  key={sh.name}
                  type="button"
                  role="tab"
                  className="sheet-tab"
                  aria-selected={i === sheetIdx}
                  onClick={() => setSheetIdx(i)}
                >
                  {sh.name} ({sh.totalRows})
                </button>
              ))}
            </div>
          )}

          {/* 遵循 modern-web-guidance `responsive-table`：tabIndex=0 + role=region + @container 自适应堆叠 */}
          <div
            tabIndex={0}
            role="region"
            aria-label={`${att.name} - ${currentSheet.name}`}
            className="table-wrapper"
          >
            <table className="parsed-sheet-table">
              <thead>
                <tr>
                  {currentSheet.headers.map((h, ci) => (
                    <th key={ci} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentSheet.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => {
                      const label = currentSheet.headers[ci] || `列${ci + 1}`;
                      return ci === 0 ? (
                        <th key={ci} scope="row" data-label={label}>
                          {cell || "—"}
                        </th>
                      ) : (
                        <td key={ci} data-label={label}>
                          {cell || "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {currentSheet.totalRows > currentSheet.rows.length && (
            <p className="sheet-truncate-note">
              仅预览前 {currentSheet.rows.length} 行（全表共 {currentSheet.totalRows} 行；监控规则匹配会扫描全部行）。
            </p>
          )}
        </div>
      )}

      {expanded && att.parsedText && (!isSpreadsheet || isArchive) && (
        <div
          className="attachment-preview"
          style={isSpreadsheet ? { paddingTop: 0 } : undefined}
        >
          <pre className="attachment-text-preview">{att.parsedText.slice(0, 12000)}</pre>
        </div>
      )}
    </div>
  );
}

/** 正文内嵌 HTML 表格响应式渲染（遵循 modern-web-guidance `responsive-table`） */
function InlineTableBlock({
  block,
  en,
}: {
  block: TableBlock;
  en: boolean;
}) {
  const captionId = useId();
  let headerRowCount = 0;
  for (const r of block.rows) {
    if (r.length > 0 && r.every((c) => c.header)) headerRowCount++;
    else break;
  }
  const headerRows = block.rows.slice(0, headerRowCount);
  const bodyRows = block.rows.slice(headerRowCount);
  const colCount = Math.max(
    block.headers.length,
    ...block.rows.map((r) => r.length),
    1,
  );
  const hasSpans = Boolean(block.hasSpans);
  const headerSpansAcross =
    hasSpans &&
    headerRows.some((r, ri) =>
      r.some((c) => (c.rowSpan ?? 1) > headerRows.length - ri),
    );
  const useSeparateHead =
    !hasSpans
      ? headerRows.length > 0 || block.headers.length > 0
      : headerRows.length > 0 && !headerSpansAcross;

  return (
    <div
      tabIndex={0}
      role="region"
      aria-labelledby={block.caption ? captionId : undefined}
      aria-label={
        block.caption ? undefined : en ? "Inline notice table" : "正文数据表格"
      }
      className="table-wrapper inline-table-wrapper"
    >
      <table
        className="parsed-sheet-table notice-inline-table"
        data-has-spans={hasSpans ? "true" : undefined}
        data-cols={colCount}
      >
        {block.caption && (
          <caption id={captionId} className="inline-table-caption">
            {block.caption}
          </caption>
        )}

        {!hasSpans ? (
          <>
            {useSeparateHead && (
              <thead>
                {headerRows.length > 0 ? (
                  headerRows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <th key={ci} scope="col">
                          {cell.text || "—"}
                        </th>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    {block.headers.map((h, ci) => (
                      <th key={ci} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                )}
              </thead>
            )}
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => {
                    const label = block.headers[ci] || `列${ci + 1}`;
                    return ci === 0 ? (
                      <th key={ci} scope="row" data-label={label}>
                        {cell.text || "—"}
                      </th>
                    ) : (
                      <td key={ci} data-label={label}>
                        {cell.text || "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </>
        ) : (
          <>
            {useSeparateHead && (
              <thead>
                {headerRows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <th
                        key={ci}
                        scope="col"
                        rowSpan={cell.rowSpan}
                        colSpan={cell.colSpan}
                      >
                        {cell.text || "—"}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
            )}
            <tbody>
              {(useSeparateHead ? bodyRows : block.rows).map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) =>
                    cell.header ? (
                      <th
                        key={ci}
                        scope={ri === 0 && !useSeparateHead ? "col" : "row"}
                        rowSpan={cell.rowSpan}
                        colSpan={cell.colSpan}
                      >
                        {cell.text || "—"}
                      </th>
                    ) : (
                      <td key={ci} rowSpan={cell.rowSpan} colSpan={cell.colSpan}>
                        {cell.text || "—"}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </>
        )}
      </table>
    </div>
  );
}

export function DetailSheet({
  notice,
  onClose,
}: {
  notice: Notice | null;
  onClose: () => void;
}) {
  const { lang, isStarred, toggleStar } = usePreferences();
  const en = lang === "en";
  const bodyRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [fetchedDetail, setFetchedDetail] = useState<Notice | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [brokenImgs, setBrokenImgs] = useState<Record<string, true>>({});

  const activeNotice = useMemo(() => {
    if (!notice) return null;
    if (!notice.summaryOnly) return notice;
    const cached = DETAIL_CACHE.get(notice.id);
    if (cached) return cached;
    if (fetchedDetail && fetchedDetail.id === notice.id) return fetchedDetail;
    return notice;
  }, [notice, fetchedDetail]);

  useEffect(() => {
    if (progressBarRef.current) {
      progressBarRef.current.style.transform = "scaleX(0)";
    }
    setCopied(false);
    setLightboxIdx(null);
    setBrokenImgs({});
    if (bodyRef.current) bodyRef.current.scrollTop = 0;

    if (!notice) {
      setDetailLoading(false);
      return;
    }

    if (!notice.summaryOnly) {
      DETAIL_CACHE.set(notice.id, notice);
      setDetailLoading(false);
      return;
    }

    if (DETAIL_CACHE.has(notice.id)) {
      setFetchedDetail(DETAIL_CACHE.get(notice.id)!);
      setDetailLoading(false);
      return;
    }

    const ctrl = new AbortController();
    const isStatic = process.env.NEXT_PUBLIC_STATIC_MODE === "1";
    const detailUrl = isStatic
      ? `/static-data/details/${encodeURIComponent(notice.id)}.json`
      : `/api/notices?id=${encodeURIComponent(notice.id)}`;

    setDetailLoading(true);
    fetch(detailUrl, {
      cache: isStatic ? "default" : "no-cache",
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: (Notice & { ok?: boolean; notice?: Notice }) | null) => {
        const full =
          payload && "notice" in payload && payload.ok && payload.notice
            ? payload.notice
            : payload && "id" in payload && payload.id
              ? (payload as Notice)
              : null;
        if (full) {
          DETAIL_CACHE.set(notice.id, full);
          setFetchedDetail(full);
        }
      })
      .catch(() => {
        /* 取消或网络异常时保留已展示摘要 */
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setDetailLoading(false);
      });

    return () => {
      ctrl.abort();
    };
  }, [notice]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // 收集封面与正文所有原始图片供原图灯箱浏览
  const lightboxImages = useMemo<LightboxImage[]>(() => {
    if (!activeNotice) return [];
    const list: LightboxImage[] = [];
    const seen = new Set<string>();
    const pushImg = (src: string, originalSrc?: string, alt?: string) => {
      const key = originalSrc || src;
      if (!key || seen.has(key)) return;
      seen.add(key);
      list.push({ src, originalSrc: originalSrc || src, alt });
    };
    if (activeNotice.cover) {
      pushImg(activeNotice.cover, activeNotice.cover, `${activeNotice.title} 封面`);
    }
    for (const blk of activeNotice.blocks ?? []) {
      if (blk.type === "image") {
        pushImg(blk.src, blk.originalSrc, blk.alt || activeNotice.title);
      }
    }
    return list;
  }, [activeNotice]);

  const openImageBySrc = (src: string) => {
    const idx = lightboxImages.findIndex((i) => i.src === src || i.originalSrc === src);
    setLightboxIdx(idx >= 0 ? idx : 0);
  };

  const handleScroll = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = bodyRef.current;
      const bar = progressBarRef.current;
      if (!el || !bar) return;
      const max = el.scrollHeight - el.clientHeight;
      const ratio = max <= 8 ? 0 : Math.min(1, Math.max(0, el.scrollTop / max));
      bar.style.transform = `scaleX(${ratio})`;
    });
  };

  const handleShare = async () => {
    if (!activeNotice || typeof window === "undefined") return;
    const shareUrl = `${window.location.origin}/?notice=${encodeURIComponent(activeNotice.id)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        const input = document.createElement("input");
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* 忽略 */
      }
    }
  };

  const catMeta = activeNotice ? CATEGORY_MAP.get(activeNotice.category) : null;
  const range = activeNotice ? formatRange(activeNotice.startsAt, activeNotice.endsAt, lang) : null;
  const starred = activeNotice ? isStarred(activeNotice.source) : false;
  const summaryText = activeNotice ? meaningfulSummary(activeNotice.title, activeNotice.summary) : null;
  const targetUrl = activeNotice ? resolveUrl(activeNotice.source, activeNotice.url) : "#";
  const host = activeNotice ? sourceHost(activeNotice.source, activeNotice.url) : "www.scau.edu.cn";
  const hasBlocks = Boolean(activeNotice?.blocks && activeNotice.blocks.length > 0);
  const coverAlreadyInBlocks = Boolean(
    activeNotice?.cover &&
      activeNotice.blocks?.some((b) => b.type === "image" && b.src === activeNotice.cover),
  );

  return (
    <>
      <ModalDialog
        open={Boolean(activeNotice)}
        onClose={onClose}
        className="modal-dialog detail-sheet"
        labelledBy="detail-title"
        tone={activeNotice?.tone}
      >
        {activeNotice && (
          <>
            <div className="detail-topbar">
              <div className="detail-topbar-tags">
                <span className="detail-pill" data-tone={activeNotice.tone}>
                  {catMeta && <Icon name={catMeta.icon} />}
                  <span>{categoryName(activeNotice.category, lang)}</span>
                </span>
                <span className="detail-pill detail-pill-neutral">
                  {subjectName(activeNotice.subject, lang)}
                </span>
                {activeNotice.registration && (
                  <span className="detail-pill detail-pill-accent">
                    {en ? "Registration" : "需报名"}
                  </span>
                )}
                {activeNotice.ai?.importance && activeNotice.ai.importance >= 4 && (
                  <span className="detail-pill detail-pill-amber">
                    {en ? `Priority ${activeNotice.ai.importance}/5` : `重点 ${activeNotice.ai.importance}/5`}
                  </span>
                )}
              </div>

              <div className="detail-topbar-actions">
                <button
                  type="button"
                  className="detail-share-btn"
                  data-copied={copied ? "true" : undefined}
                  onClick={handleShare}
                >
                  {copied ? <Check /> : <Share2 />}
                  <span>
                    {copied
                      ? en
                        ? "Copied"
                        : "已复制链接"
                      : en
                        ? "Share"
                        : "分享活动"}
                  </span>
                </button>

                <a
                  className="primary-button detail-origin-btn"
                  href={targetUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={en ? `Open original on ${host}` : `在新标签页打开 ${host}`}
                >
                  <span>{en ? "Original" : "查看原文"}</span>
                  <ArrowUpRight />
                </a>

                <button
                  type="button"
                  className="modal-close"
                  aria-label={en ? "Close" : "关闭"}
                  onClick={onClose}
                >
                  <X />
                </button>
              </div>

              <div
                ref={progressBarRef}
                className="reading-progress"
                style={{ transform: "scaleX(0)" }}
                aria-hidden="true"
              />
            </div>

            <div className="detail-body" ref={bodyRef} onScroll={handleScroll}>
              <h2 className="detail-title" id="detail-title">
                {activeNotice.title}
              </h2>

              <div className="detail-submeta">
                <span>
                  {en ? "Published: " : "发布时间："}
                  <time dateTime={activeNotice.publishedAt}>
                    {formatFullTime(activeNotice.publishedAt, lang)}
                  </time>
                </span>
                <span className="detail-submeta-source">
                  <span>
                    {en ? "Source: " : "来源："}
                    <strong>{activeNotice.source}</strong>
                  </span>
                  <button
                    type="button"
                    className="source-star-button"
                    data-starred={starred ? "true" : undefined}
                    aria-pressed={starred}
                    title={
                      starred
                        ? en
                          ? "Unstar this source"
                          : "取消星标该来源"
                        : en
                          ? "Star this source"
                          : "星标该来源"
                    }
                    onClick={() => toggleStar(activeNotice.source)}
                  >
                    <Star />
                    <span>
                      {starred
                        ? en
                          ? "Starred"
                          : "已星标"
                        : en
                          ? "Star"
                          : "星标"}
                    </span>
                  </button>
                </span>
              </div>

              {activeNotice.cover && !coverAlreadyInBlocks && !brokenImgs[activeNotice.cover] && (
                <button
                  type="button"
                  className="detail-cover-btn"
                  onClick={() => openImageBySrc(activeNotice.cover!)}
                  title={en ? "View original image" : "点击查看原尺寸封面"}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mediaThumbUrl(activeNotice.cover, 1200)}
                    alt={activeNotice.title}
                    decoding="async"
                    referrerPolicy={activeNotice.cover.startsWith("http") ? "no-referrer" : undefined}
                    onError={() =>
                      setBrokenImgs((prev) => ({ ...prev, [activeNotice.cover!]: true }))
                    }
                  />
                  <span className="detail-img-zoom-hint">
                    <Maximize2 />
                    <span>{en ? "Original" : "原图"}</span>
                  </span>
                </button>
              )}

              {(range ||
                activeNotice.venue ||
                activeNotice.ai?.registrationDeadline ||
                activeNotice.ai?.audience?.length) && (
                <dl className="detail-facts">
                  {range && (
                    <div className="detail-fact">
                      <dt>
                        <CalendarClock />
                        <span>{en ? "Event Time" : "活动时间"}</span>
                      </dt>
                      <dd>{range}</dd>
                    </div>
                  )}
                  {activeNotice.venue && (
                    <div className="detail-fact">
                      <dt>
                        <MapPin />
                        <span>{en ? "Location" : "活动地点"}</span>
                      </dt>
                      <dd>{activeNotice.venue}</dd>
                    </div>
                  )}
                  {activeNotice.ai?.registrationDeadline && (
                    <div className="detail-fact">
                      <dt>
                        <CalendarClock />
                        <span>{en ? "Deadline" : "报名截止"}</span>
                      </dt>
                      <dd>{activeNotice.ai.registrationDeadline}</dd>
                    </div>
                  )}
                  {activeNotice.ai?.audience && activeNotice.ai.audience.length > 0 && (
                    <div className="detail-fact">
                      <dt>
                        <Users />
                        <span>{en ? "Audience" : "面向群体"}</span>
                      </dt>
                      <dd>{activeNotice.ai.audience.join("、")}</dd>
                    </div>
                  )}
                </dl>
              )}

              {summaryText && (
                <section className="detail-summary-box" aria-label={en ? "Summary" : "摘要"}>
                  <div className="detail-summary-head">
                    {activeNotice.ai?.enrichedBy === "ai" ? (
                      <Sparkles aria-hidden="true" />
                    ) : (
                      <FileText aria-hidden="true" />
                    )}
                    <span>
                      {activeNotice.ai?.enrichedBy === "ai"
                        ? en
                          ? "AI Summary"
                          : "AI 结构化摘要"
                        : en
                          ? "Summary"
                          : "摘要"}
                    </span>
                  </div>
                  <p className="detail-summary">{summaryText}</p>
                </section>
              )}

              <section className="detail-content-section" aria-label={en ? "Content" : "正文"}>
                <h3 className="detail-section-label">{en ? "Full Text" : "正文"}</h3>
                {detailLoading && !hasBlocks && activeNotice.paragraphs.length === 0 ? (
                  <p className="detail-loading-hint" role="status">
                    {en ? "Loading full content & tables..." : "正在加载完整正文、表格与附件…"}
                  </p>
                ) : hasBlocks ? (
                  <div className="detail-blocks">
                    {activeNotice.blocks!.map((blk, i) =>
                      blk.type === "text" ? (
                        <p key={i} className="detail-block-text">
                          {blk.text}
                        </p>
                      ) : blk.type === "table" ? (
                        <InlineTableBlock key={i} block={blk} en={en} />
                      ) : brokenImgs[blk.src] ? null : (
                        <button
                          key={i}
                          type="button"
                          className="detail-inline-img-btn"
                          onClick={() => openImageBySrc(blk.src)}
                          title={en ? "View original size" : "点击查看原尺寸图片"}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={mediaThumbUrl(blk.src, 1200)}
                            alt={blk.alt || ""}
                            loading="lazy"
                            decoding="async"
                            referrerPolicy={blk.src.startsWith("http") ? "no-referrer" : undefined}
                            onError={() =>
                              setBrokenImgs((prev) => ({ ...prev, [blk.src]: true }))
                            }
                          />
                          <span className="detail-img-zoom-hint">
                            <Maximize2 />
                            <span>{en ? "Original size" : "查看原图"}</span>
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                ) : activeNotice.paragraphs.length > 0 ? (
                  <div className="detail-paragraphs">
                    {activeNotice.paragraphs.map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                  </div>
                ) : activeNotice.requiresAuth ? (
                  <p className="detail-empty-body">
                    {en
                      ? "This notice requires SCAU CAS campus login. Click Original above to sign in and view full details on the official portal."
                      : "该条通知需登录华南农业大学统一身份认证（CAS / 校内账号）后查看，请点击右上角「查看原文」前往校网登录阅读。"}
                  </p>
                ) : (
                  <p className="detail-empty-body">
                    {en
                      ? "This notice only provides a link or attachment on the original portal. Click Original above to view full details."
                      : "该条通知原文为附件或外链展示，请点击右上角「查看原文」前往学校官方网站阅读完整内容。"}
                  </p>
                )}
              </section>

              {activeNotice.attachments && activeNotice.attachments.length > 0 && (
                <section
                  className="detail-attachments-section"
                  aria-label={en ? "Attachments" : "附件与解析内容"}
                >
                  <h3 className="detail-section-label">
                    <Paperclip style={{ width: 14, height: 14, verticalAlign: -2, marginRight: 5 }} />
                    {en
                      ? `Attachments (${activeNotice.attachments.length})`
                      : `附件与内容解析（${activeNotice.attachments.length}）`}
                  </h3>
                  <div className="attachments-stack">
                    {activeNotice.attachments.map((att) => (
                      <AttachmentCard key={att.id} att={att} en={en} />
                    ))}
                  </div>
                </section>
              )}

              <p className="detail-disclaimer">
                {en
                  ? `Details are subject to the official announcement on ${host}.`
                  : `具体安排以发布单位原文为准 · 原文域名：${host}`}
              </p>
            </div>
          </>
        )}
      </ModalDialog>

      <ImageLightbox
        images={lightboxImages}
        index={lightboxIdx}
        onClose={() => setLightboxIdx(null)}
        onIndexChange={setLightboxIdx}
      />
    </>
  );
}
