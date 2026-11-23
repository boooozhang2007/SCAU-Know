"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  List,
  MapPin,
  RefreshCw,
  Star,
  Users,
} from "lucide-react";
import type { Notice } from "@/lib/types";
import { CATEGORY_MAP } from "@/lib/site";
import {
  addDaysKey,
  compareCalendarEvents,
  cstDateHead,
  cstDateKey,
  formatCalendarClock,
  formatWeekRange,
  mondayOfKey,
  normalizeCstIso,
} from "@/lib/format";
import { mediaThumbUrl } from "@/lib/media-url";
import { shortSourceName } from "@/lib/sources";
import { usePreferences } from "@/lib/preferences";
import { Icon } from "./icon";

const DetailSheet = dynamic(
  () => import("./detail-sheet").then((m) => m.DetailSheet),
  { ssr: false },
);

const MONTHS_ZH = [
  "一月",
  "二月",
  "三月",
  "四月",
  "五月",
  "六月",
  "七月",
  "八月",
  "九月",
  "十月",
  "十一月",
  "十二月",
];
const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEK_HEADERS_ZH = ["一", "二", "三", "四", "五", "六", "日"];
const WEEK_HEADERS_EN = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const pad = (n: number) => String(n).padStart(2, "0");

interface MonthCell {
  key: string;
  day: number;
  inMonth: boolean;
}

function buildMonthGrid(year: number, month1: number): MonthCell[] {
  const firstDow = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay(); // 0=Sun..6=Sat
  const lead = firstDow === 0 ? 6 : firstDow - 1; // 周一作为每行第一列
  const startUtc = Date.UTC(year, month1 - 1, 1 - lead);
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const dt = new Date(startUtc + i * 86400000);
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    cells.push({
      key: `${y}-${pad(m)}-${pad(d)}`,
      day: d,
      inMonth: y === year && m === month1,
    });
  }
  return cells;
}

interface TimeSlotGroup {
  slotKey: string;
  slotLabel: string;
  allDay: boolean;
  items: Notice[];
}

function groupEventsByTimeSlot(items: Notice[], lang: "zh" | "en"): TimeSlotGroup[] {
  const groups: TimeSlotGroup[] = [];
  for (const item of items) {
    const clock = formatCalendarClock(item.startsAt!, item.endsAt, lang);
    const last = groups[groups.length - 1];
    if (last && last.slotKey === clock.slotKey) {
      last.items.push(item);
    } else {
      groups.push({
        slotKey: clock.slotKey,
        slotLabel: clock.slotLabel,
        allDay: clock.allDay,
        items: [item],
      });
    }
  }
  return groups;
}

/**
 * 活动日历（桌面端与移动端统一采用清华知道手机版「左侧时间轴 + 同刻并排/横向滑动卡片」样式）：
 * - 居中周历卡片：周范围大标题 + `<` / `今天` / `>` / `只看星标` / 月历弹窗选日期 / `↻` 刷新 / `全部`
 * - 7 天等宽切换条（今天绿框标注，选中绿底双环高亮，显示每日场次）
 * - 日程主体：统一左侧时间轴（时刻 + 圆点 + 竖线）+ 右侧卡片轨（单场铺满，同开始时刻多场并排/横向滑屏）
 * - 时间排序：按 CST 严格升序，有明确时刻的活动排前，全天/无时刻事件排在当日末尾
 */
export function CalendarList({
  notices,
  now,
  initialDate = null,
  syncing = false,
  onRefresh,
}: {
  notices: Notice[];
  now: string;
  initialDate?: string | null;
  syncing?: boolean;
  onRefresh?: () => void;
}) {
  const { lang, isStarred } = usePreferences();
  const en = lang === "en";
  const todayKey = useMemo(() => cstDateKey(now), [now]);
  const pickerId = useId();
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [starOnly, setStarOnly] = useState(false);
  const [viewAll, setViewAll] = useState(false);
  const [sheetActivated, setSheetActivated] = useState(false);
  const [openNotice, setOpenNotice] = useState<Notice | null>(null);
  const [brokenCovers, setBrokenCovers] = useState<Record<string, true>>({});

  const handleOpenNotice = useCallback((n: Notice) => {
    setSheetActivated(true);
    setOpenNotice(n);
  }, []);

  // 清洗去重并严格按时间排序（有时刻升序在前，全天/00:00 排当日末尾）
  const scheduledEvents = useMemo(() => {
    const seen = new Set<string>();
    const valid: Notice[] = [];
    for (const n of notices) {
      if (seen.has(n.id)) continue;
      if (n.noticeKind === "recap" || n.noticeKind === "editorial") continue;
      const normStart = normalizeCstIso(n.startsAt);
      if (!normStart) continue;
      if (starOnly && !isStarred(n.source)) continue;
      seen.add(n.id);
      valid.push(normStart === n.startsAt ? n : { ...n, startsAt: normStart });
    }
    return valid.sort(compareCalendarEvents);
  }, [notices, starOnly, isStarred]);

  // 按 CST 日期分组（每组内部已保持严格升序）
  const byDate = useMemo(() => {
    const map = new Map<string, Notice[]>();
    for (const e of scheduledEvents) {
      const k = cstDateKey(e.startsAt!);
      const arr = map.get(k) ?? [];
      arr.push(e);
      map.set(k, arr);
    }
    return map;
  }, [scheduledEvents]);

  const resolvedStartDay =
    initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : todayKey;

  const [selectedDay, setSelectedDay] = useState<string>(resolvedStartDay);
  const [weekMonday, setWeekMonday] = useState<string>(() => mondayOfKey(resolvedStartDay));
  const [pickerYM, setPickerYM] = useState<{ year: number; month: number }>(() => {
    const [y, m] = resolvedStartDay.split("-").map(Number);
    return { year: y, month: m };
  });

  // 响应 URL ?date= 更新
  useEffect(() => {
    if (initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)) {
      setSelectedDay(initialDate);
      setWeekMonday(mondayOfKey(initialDate));
      const [y, m] = initialDate.split("-").map(Number);
      setPickerYM({ year: y, month: m });
      setViewAll(false);
    }
  }, [initialDate]);

  // 不支持 CSS Anchor Positioning 时，在 popover 打开前用 trigger 的几何位置对齐（遵循 modern-web-guidance）
  useEffect(() => {
    const el = pickerRef.current;
    if (!el) return;
    const onBeforeToggle = (ev: Event) => {
      const toggleEv = ev as Event & { newState?: string };
      if (toggleEv.newState !== "open") return;
      const [y, m] = selectedDay.split("-").map(Number);
      setPickerYM({ year: y, month: m });

      if (
        typeof CSS !== "undefined" &&
        typeof CSS.supports === "function" &&
        CSS.supports("position-area: block-end")
      ) {
        return;
      }
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const popWidth = 304;
      const left = Math.min(
        Math.max(12, rect.left + rect.width / 2 - popWidth / 2),
        window.innerWidth - popWidth - 12,
      );
      const top = Math.min(rect.bottom + 8, window.innerHeight - 340);
      el.style.right = "auto";
      el.style.bottom = "auto";
      el.style.left = `${left}px`;
      el.style.top = `${Math.max(12, top)}px`;
    };
    el.addEventListener("beforetoggle", onBeforeToggle);
    return () => el.removeEventListener("beforetoggle", onBeforeToggle);
  }, [selectedDay]);

  const syncUrlDate = useCallback((dateKey: string) => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (dateKey === todayKey) {
        url.searchParams.delete("date");
      } else {
        url.searchParams.set("date", dateKey);
      }
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    } catch {
      /* ignore */
    }
  }, [todayKey]);

  const jumpToDate = useCallback(
    (dateKey: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
      setSelectedDay(dateKey);
      setWeekMonday(mondayOfKey(dateKey));
      const [y, m] = dateKey.split("-").map(Number);
      setPickerYM({ year: y, month: m });
      setViewAll(false);
      syncUrlDate(dateKey);
      try {
        (pickerRef.current as (HTMLDivElement & { hidePopover?: () => void }) | null)?.hidePopover?.();
      } catch {
        /* ignore */
      }
    },
    [syncUrlDate],
  );

  const shiftWeek = (deltaWeeks: number) => {
    const nextMon = addDaysKey(weekMonday, deltaWeeks * 7);
    const nextDay = addDaysKey(selectedDay, deltaWeeks * 7);
    setWeekMonday(nextMon);
    setSelectedDay(nextDay);
    const [y, m] = nextDay.split("-").map(Number);
    setPickerYM({ year: y, month: m });
    setViewAll(false);
    syncUrlDate(nextDay);
  };

  const shiftPickerMonth = (delta: number) => {
    setPickerYM((prev) => {
      const dt = new Date(Date.UTC(prev.year, prev.month - 1 + delta, 1));
      return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1 };
    });
  };

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysKey(weekMonday, i)),
    [weekMonday],
  );

  const monthCells = useMemo(
    () => buildMonthGrid(pickerYM.year, pickerYM.month),
    [pickerYM.year, pickerYM.month],
  );

  const selectedDayEvents = useMemo(
    () => byDate.get(selectedDay) ?? [],
    [byDate, selectedDay],
  );

  /** 按开始时刻分组（桌面端与移动端统一呈现左侧时间轴 + 同刻并排/横向滑动卡片） */
  const selectedDayGroups = useMemo<TimeSlotGroup[]>(
    () => groupEventsByTimeSlot(selectedDayEvents, lang),
    [selectedDayEvents, lang],
  );

  /** 近期有活动的日期快捷推荐（当前选中日期无活动时帮助用户一键直达） */
  const suggestedDays = useMemo(() => {
    const keys = [...byDate.keys()].sort();
    const upcoming = keys.filter((k) => k >= todayKey).slice(0, 4);
    if (upcoming.length > 0) return upcoming;
    return keys.slice(-4).reverse();
  }, [byDate, todayKey]);

  /** 全部排期列表：近期/未来按时间升序（最近优先），往期按时间倒序 */
  const allDaysSorted = useMemo(() => {
    const entries = [...byDate.entries()];
    const upcoming = entries
      .filter(([k]) => k >= todayKey)
      .sort(([a], [b]) => a.localeCompare(b));
    const past = entries
      .filter(([k]) => k < todayKey)
      .sort(([a], [b]) => b.localeCompare(a));
    return { upcoming, past };
  }, [byDate, todayKey]);

  const selectedHead = cstDateHead(selectedDay, lang);
  const currentYear = Number(todayKey.slice(0, 4));
  const pickerMonthLabel = en
    ? `${MONTHS_EN[pickerYM.month - 1]} ${pickerYM.year}`
    : pickerYM.year === currentYear
      ? MONTHS_ZH[pickerYM.month - 1]
      : `${pickerYM.year}年 ${MONTHS_ZH[pickerYM.month - 1]}`;

  const renderCard = (n: Notice) => {
    const cat = CATEGORY_MAP.get(n.category);
    const clock = formatCalendarClock(n.startsAt!, n.endsAt, lang);
    const isImportant = Boolean(n.important ?? n.ai?.isImportant);
    const importantReason = n.importantReason ?? n.ai?.importantReason;
    const coverThumb = n.cover ? mediaThumbUrl(n.cover, 480) : undefined;
    const showCover = Boolean(coverThumb && !brokenCovers[coverThumb]);
    const audienceList = n.audience ?? n.ai?.audience ?? [];
    const specificAudience = audienceList.find(
      (a) => a && a !== "全校师生" && a !== "全校" && a.length <= 12,
    );

    return (
      <button
        key={n.id}
        type="button"
        className="cal-event-card"
        data-tone={cat?.tone ?? "leaf"}
        data-important={isImportant ? "true" : undefined}
        aria-haspopup="dialog"
        onClick={() => handleOpenNotice(n)}
      >
        <span className="cal-event-top">
          {showCover && coverThumb ? (
            <span className="cal-event-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={coverThumb}
                alt=""
                width={96}
                height={56}
                loading="lazy"
                decoding="async"
                referrerPolicy={coverThumb.startsWith("http") ? "no-referrer" : undefined}
                onError={() =>
                  setBrokenCovers((prev) => ({ ...prev, [coverThumb]: true }))
                }
              />
            </span>
          ) : (
            <span className="cal-event-icon-thumb" aria-hidden="true">
              {cat && <Icon name={cat.icon} />}
            </span>
          )}

          <span className="cal-event-title">
            {isImportant && (
              <span
                className="notice-important-badge"
                title={importantReason || (en ? "Important notice" : "重要通知")}
              >
                <span aria-hidden="true">{en ? "KEY" : "重要"}</span>
              </span>
            )}
            {n.registration && (
              <span
                className="notice-registration"
                title={en ? "Registration required" : "需报名"}
              >
                <span aria-hidden="true">{en ? "REG" : "报"}</span>
              </span>
            )}
            {n.title}
          </span>
        </span>

        <span className="cal-event-meta">
          <span
            className="cal-event-time"
            data-allday={clock.allDay ? "true" : undefined}
          >
            {n.isNew && (
              <span
                className="notice-arrival-dot"
                role="img"
                aria-label={en ? "Published today" : "今日收录"}
              />
            )}
            <Clock aria-hidden="true" />
            <span>{clock.text}</span>
          </span>

          {n.venue && (
            <span className="cal-event-venue">
              <MapPin aria-hidden="true" />
              <span>{n.venue}</span>
            </span>
          )}

          <span className="cal-event-footer">
            <span className="cal-event-source" title={n.source}>
              {shortSourceName(n.source)}
            </span>
            {specificAudience && (
              <span className="cal-event-audience">
                <Users aria-hidden="true" />
                <span>{specificAudience}</span>
              </span>
            )}
          </span>
        </span>
      </button>
    );
  };

  const renderTimeline = (groups: TimeSlotGroup[], label: string) => (
    <div className="cal-timeline" aria-label={label}>
      {groups.map((group) => (
        <div key={group.slotKey} className="cal-tl-row">
          <div className="cal-tl-rail" aria-hidden="true">
            <span
              className="cal-tl-time"
              data-allday={group.allDay ? "true" : undefined}
            >
              {group.slotLabel}
            </span>
            <span
              className="cal-tl-dot"
              data-allday={group.allDay ? "true" : undefined}
            />
            <span className="cal-tl-line" />
          </div>
          <div
            className={`cal-tl-track ${group.items.length > 1 ? "is-multi" : ""}`}
            data-count={group.items.length === 2 ? "2" : group.items.length >= 3 ? "3+" : "1"}
            role="region"
            aria-label={group.slotLabel}
          >
            {group.items.map((n) => renderCard(n))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* 居中周历控制卡片（1:1 参照清华知道） */}
      <section className="calendar-panel" aria-label={en ? "Week navigator" : "周历导航"}>
        <div className="calendar-week-title">{formatWeekRange(weekMonday, lang)}</div>

        <div className="calendar-controls">
          <div className="cal-ctrl-group">
            <button
              type="button"
              className="cal-ctrl-btn cal-ctrl-icon"
              aria-label={en ? "Previous week" : "上一周"}
              title={en ? "Previous week" : "上一周"}
              onClick={() => shiftWeek(-1)}
            >
              <ChevronLeft />
            </button>

            <button
              type="button"
              className="cal-ctrl-btn"
              onClick={() => jumpToDate(todayKey)}
            >
              {en ? "Today" : "今天"}
            </button>

            <button
              type="button"
              className="cal-ctrl-btn cal-ctrl-icon"
              aria-label={en ? "Next week" : "下一周"}
              title={en ? "Next week" : "下一周"}
              onClick={() => shiftWeek(1)}
            >
              <ChevronRight />
            </button>
          </div>

          <button
            type="button"
            className="cal-ctrl-btn cal-ctrl-star-btn"
            data-active={starOnly ? "true" : undefined}
            aria-pressed={starOnly}
            onClick={() => setStarOnly((v) => !v)}
          >
            <Star className="cal-ctrl-star" aria-hidden="true" />
            <span>{en ? "Starred only" : "只看星标"}</span>
          </button>

          {/* 原生 Popover 月历日期选择器（遵循 viewport-aware-dropdowns） */}
          <button
            ref={triggerRef}
            type="button"
            className="cal-ctrl-btn cal-date-trigger"
            popoverTarget={pickerId}
            aria-label={en ? "Choose date" : "选择日期"}
            title={en ? "Choose date" : "选择日期"}
          >
            <span>{selectedHead.date}</span>
            <Calendar aria-hidden="true" />
          </button>

          <div
            ref={pickerRef}
            id={pickerId}
            popover="auto"
            className="cal-datepicker-popover"
            role="dialog"
            aria-label={en ? "Calendar date picker" : "选择日期"}
          >
            <div className="cal-dp-head">
              <button
                type="button"
                className="cal-dp-nav"
                aria-label={en ? "Previous month" : "上个月"}
                onClick={() => shiftPickerMonth(-1)}
              >
                <ChevronLeft />
              </button>
              <strong className="cal-dp-month">{pickerMonthLabel}</strong>
              <button
                type="button"
                className="cal-dp-nav"
                aria-label={en ? "Next month" : "下个月"}
                onClick={() => shiftPickerMonth(1)}
              >
                <ChevronRight />
              </button>
            </div>

            <div className="cal-dp-weekdays" aria-hidden="true">
              {(en ? WEEK_HEADERS_EN : WEEK_HEADERS_ZH).map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>

            <div className="cal-dp-grid">
              {monthCells.map((cell) => {
                const count = byDate.get(cell.key)?.length ?? 0;
                const isSelected = cell.key === selectedDay;
                const isTodayCell = cell.key === todayKey;
                return (
                  <button
                    key={cell.key}
                    type="button"
                    className="cal-dp-cell"
                    data-muted={!cell.inMonth ? "true" : undefined}
                    data-today={isTodayCell ? "true" : undefined}
                    data-selected={isSelected ? "true" : undefined}
                    data-has-events={count > 0 ? "true" : undefined}
                    aria-pressed={isSelected}
                    title={
                      count > 0
                        ? en
                          ? `${cell.key} (${count} events)`
                          : `${cell.key}（${count} 场活动）`
                        : cell.key
                    }
                    onClick={() => jumpToDate(cell.key)}
                  >
                    <span>{cell.day}</span>
                    {count > 0 && <i className="cal-dp-dot" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            className="cal-ctrl-btn cal-ctrl-icon"
            aria-label={en ? "Refresh calendar" : "刷新活动日历"}
            title={en ? "Refresh calendar" : "刷新活动日历"}
            disabled={syncing}
            onClick={() => onRefresh?.()}
          >
            <RefreshCw className={syncing ? "spin" : ""} />
          </button>

          <button
            type="button"
            className="cal-ctrl-btn cal-ctrl-all-btn"
            data-active={viewAll ? "true" : undefined}
            aria-pressed={viewAll}
            onClick={() => setViewAll((v) => !v)}
            title={en ? "Toggle all scheduled events" : "切换全部已排期列表"}
          >
            <List aria-hidden="true" />
            <span>
              {en
                ? `All (${scheduledEvents.length})`
                : `全部 (${scheduledEvents.length})`}
            </span>
          </button>
        </div>

        {/* 7 天切换条 */}
        <div
          className="calendar-week-strip"
          role="tablist"
          aria-label={en ? "Select day of week" : "选择本周日期"}
        >
          {weekDays.map((key) => {
            const head = cstDateHead(key, lang);
            const count = byDate.get(key)?.length ?? 0;
            const isTodayCell = key === todayKey;
            const isSelected = !viewAll && key === selectedDay;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                className="calendar-day-pill"
                aria-selected={isSelected}
                data-today={isTodayCell ? "true" : undefined}
                data-has-events={count > 0 ? "true" : undefined}
                onClick={() => jumpToDate(key)}
              >
                <span className="cal-pill-week">
                  {isTodayCell ? (en ? "Today" : "今天") : head.week}
                </span>
                <strong className="cal-pill-num">{head.dayNum}</strong>
                <span className="cal-pill-count">
                  {en ? `${count}` : `${count} 场`}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 日程列表主体 */}
      {scheduledEvents.length === 0 ? (
        <div className="empty-state">
          <strong>
            {starOnly
              ? en
                ? "No scheduled events from starred sources"
                : "星标来源暂无排期活动"
              : en
                ? "No scheduled events found"
                : "暂无已识别排期的活动"}
          </strong>
          <p>
            {starOnly
              ? en
                ? "Turn off Starred Only or star more colleges."
                : "关闭「只看星标」或添加更多星标来源后再查看。"
              : en
                ? "Check back after the next crawl & AI extraction run."
                : "待下一次抓取与 AI 提取完成后将自动更新日程。"}
          </p>
        </div>
      ) : viewAll ? (
        <div className="calendar-list">
          {allDaysSorted.upcoming.length > 0 && (
            <div className="cal-all-group">
              <h2 className="cal-all-group-title">
                {en ? "Upcoming & Today" : "近期与即将开始"}
              </h2>
              {allDaysSorted.upcoming.map(([key, items]) => {
                const head = cstDateHead(key, lang);
                const isTodayRow = key === todayKey;
                return (
                  <section key={key} className="calendar-day">
                    <div className="calendar-day-head">
                      <span className="calendar-day-date">{head.date}</span>
                      <span className="calendar-day-week">
                        {isTodayRow ? (en ? "Today" : "今天") : head.week}
                      </span>
                      <span className="calendar-day-count">
                        {en ? `${items.length} events` : `${items.length} 场`}
                      </span>
                    </div>
                    {renderTimeline(
                      groupEventsByTimeSlot(items, lang),
                      `${head.date} ${en ? "timeline" : "时间轴"}`,
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {allDaysSorted.past.length > 0 && (
            <div className="cal-all-group">
              <h2 className="cal-all-group-title">
                {en ? "Recent Past Events" : "近期已结束"}
              </h2>
              {allDaysSorted.past.map(([key, items]) => {
                const head = cstDateHead(key, lang);
                return (
                  <section key={key} className="calendar-day">
                    <div className="calendar-day-head">
                      <span className="calendar-day-date">{head.date}</span>
                      <span className="calendar-day-week">{head.week}</span>
                      <span className="calendar-day-count">
                        {en ? `${items.length} events` : `${items.length} 场`}
                      </span>
                    </div>
                    {renderTimeline(
                      groupEventsByTimeSlot(items, lang),
                      `${head.date} ${en ? "timeline" : "时间轴"}`,
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      ) : selectedDayEvents.length > 0 ? (
        /* 桌面端与移动端统一采用左侧时间轴 + 同刻并排/横向滑动卡片布局 */
        renderTimeline(
          selectedDayGroups,
          en ? "Daily timeline" : "当日时间轴",
        )
      ) : (
        <div className="calendar-empty-day">
          <p>
            {en
              ? `No events scheduled on ${selectedHead.date}.`
              : `${selectedHead.date} 暂无排期活动。`}
          </p>
          {suggestedDays.length > 0 && (
            <div className="cal-suggest-chips">
              <span className="cal-suggest-label">
                {en ? "Jump to:" : "近期有活动日期："}
              </span>
              {suggestedDays.map((dayKey) => {
                const h = cstDateHead(dayKey, lang);
                const c = byDate.get(dayKey)?.length ?? 0;
                return (
                  <button
                    key={dayKey}
                    type="button"
                    className="cal-suggest-btn"
                    onClick={() => jumpToDate(dayKey)}
                  >
                    <span>
                      {h.date} {h.week}
                    </span>
                    <small>{en ? `${c}` : `${c}场`}</small>
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            className="plain-button"
            onClick={() => setViewAll(true)}
          >
            {en
              ? `Browse all ${scheduledEvents.length} scheduled events`
              : `查看全部 ${scheduledEvents.length} 场已排期活动`}
          </button>
        </div>
      )}

      {sheetActivated && (
        <DetailSheet notice={openNotice} onClose={() => setOpenNotice(null)} />
      )}
    </>
  );
}
