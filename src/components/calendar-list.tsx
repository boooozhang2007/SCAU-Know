"use client";

import { useMemo, useState } from "react";
import {
  Calendar,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  List,
  MapPin,
  Star,
} from "lucide-react";
import type { Notice } from "@/lib/types";
import { CATEGORY_MAP } from "@/lib/site";
import {
  addDaysKey,
  categoryName,
  cstDateHead,
  cstDateKey,
  cstTimeLabel,
  formatRange,
  formatWeekRange,
  mondayOfKey,
} from "@/lib/format";
import { shortSourceName } from "@/lib/sources";
import { usePreferences } from "@/lib/preferences";
import { DetailSheet } from "./notice";
import { Icon } from "./icon";

/**
 * 活动日历（参照 pkuknow.cn/thu/calendar 周视图 + 全部排期双视图）：
 * - 顶部周范围标题（11月16日 — 11月22日）+ 上一周 / 今天 / 下一周 / 只看星标 / 日期选择
 * - 7 天快捷切换胶囊（周一至周日，实时显示每日场次）
 * - 支持一键切换「按周按天查看」与「全部排期列表」，点击任意卡片直接打开详情弹层
 */
export function CalendarList({
  notices,
  now,
}: {
  notices: Notice[];
  now: string;
}) {
  const { lang, isStarred } = usePreferences();
  const en = lang === "en";
  const todayKey = useMemo(() => cstDateKey(now), [now]);

  const [starOnly, setStarOnly] = useState(false);
  const [viewAll, setViewAll] = useState(false);
  const [openNotice, setOpenNotice] = useState<Notice | null>(null);

  const scheduledEvents = useMemo(() => {
    return notices
      .filter((n) => n.startsAt && (!starOnly || isStarred(n.source)))
      .sort(
        (a, b) =>
          new Date(a.startsAt!).getTime() - new Date(b.startsAt!).getTime(),
      );
  }, [notices, starOnly, isStarred]);

  // 按日分组
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

  // 默认选中「今天」（若今天无排期则定位到最近一场未来/近期活动所在日期，确保首屏即有内容）
  const initialSelectedDay = useMemo(() => {
    if (byDate.has(todayKey)) return todayKey;
    const keys = [...byDate.keys()].sort();
    const upcoming = keys.find((k) => k >= todayKey);
    return upcoming ?? keys[keys.length - 1] ?? todayKey;
  }, [byDate, todayKey]);

  const [selectedDay, setSelectedDay] = useState<string>(initialSelectedDay);
  const [weekMonday, setWeekMonday] = useState<string>(() =>
    mondayOfKey(initialSelectedDay),
  );

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysKey(weekMonday, i)),
    [weekMonday],
  );

  const jumpToDate = (dateKey: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
    setSelectedDay(dateKey);
    setWeekMonday(mondayOfKey(dateKey));
    setViewAll(false);
  };

  const shiftWeek = (deltaWeeks: number) => {
    const nextMon = addDaysKey(weekMonday, deltaWeeks * 7);
    const nextDay = addDaysKey(selectedDay, deltaWeeks * 7);
    setWeekMonday(nextMon);
    setSelectedDay(nextDay);
    setViewAll(false);
  };

  const selectedDayEvents = byDate.get(selectedDay) ?? [];
  const weekEventsCount = weekDays.reduce(
    (sum, k) => sum + (byDate.get(k)?.length ?? 0),
    0,
  );
  const allDaysSorted = useMemo(
    () => [...byDate.entries()].sort(([a], [b]) => b.localeCompare(a)),
    [byDate],
  );

  return (
    <>
      {/* 顶部周视图控制面板 */}
      <section className="calendar-panel" aria-label={en ? "Week switcher" : "周历导航"}>
        <div className="calendar-week-title">{formatWeekRange(weekMonday, lang)}</div>

        <div className="calendar-controls">
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

          <button
            type="button"
            className="cal-ctrl-btn"
            data-active={starOnly ? "true" : undefined}
            aria-pressed={starOnly}
            onClick={() => setStarOnly((v) => !v)}
          >
            <Star className="cal-ctrl-star" aria-hidden="true" />
            <span>{en ? "Starred only" : "只看星标"}</span>
          </button>

          <label className="cal-date-picker" title={en ? "Jump to date" : "选择日期"}>
            <Calendar aria-hidden="true" />
            <input
              type="date"
              value={selectedDay}
              aria-label={en ? "Select date" : "选择日期"}
              onChange={(e) => {
                if (e.target.value) jumpToDate(e.target.value);
              }}
            />
          </label>

          <button
            type="button"
            className="cal-ctrl-btn"
            data-active={viewAll ? "true" : undefined}
            aria-pressed={viewAll}
            onClick={() => setViewAll((v) => !v)}
          >
            <List style={{ width: 15, height: 15 }} aria-hidden="true" />
            <span>
              {en
                ? `All (${scheduledEvents.length})`
                : `全部排期 (${scheduledEvents.length})`}
            </span>
          </button>
        </div>

        {/* 7 天切换条 */}
        <div className="calendar-week-strip" role="tablist" aria-label={en ? "Days of week" : "本周日期"}>
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
                onClick={() => {
                  setSelectedDay(key);
                  setViewAll(false);
                }}
              >
                <span className="cal-pill-week">
                  {isTodayCell ? (en ? "Today" : "今天") : head.week}
                </span>
                <strong className="cal-pill-num">{head.dayNum}</strong>
                <span className="cal-pill-count">
                  {count > 0
                    ? en
                      ? `${count} evt`
                      : `${count} 场`
                    : en
                      ? "—"
                      : "无"}
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
                ? "No scheduled events in this category"
                : "该分类暂无排期活动"}
          </strong>
          <p>
            {starOnly
              ? en
                ? "Turn off Starred Only or star more sources."
                : "关闭「只看星标」或添加更多星标来源后再查看。"
              : en
                ? "Try switching to another category."
                : "换一个分类，或查看全部活动。"}
          </p>
        </div>
      ) : viewAll ? (
        <div className="calendar-list">
          {allDaysSorted.map(([key, items]) => {
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
                <CalendarEventRows items={items} onOpen={setOpenNotice} lang={lang} />
              </section>
            );
          })}
        </div>
      ) : selectedDayEvents.length > 0 ? (
        <section className="calendar-day calendar-day-single">
          <div className="calendar-day-head">
            <span className="calendar-day-date">
              {cstDateHead(selectedDay, lang).date}
            </span>
            <span className="calendar-day-week">
              {selectedDay === todayKey
                ? en
                  ? "Today"
                  : "今天"
                : cstDateHead(selectedDay, lang).week}
            </span>
            <span className="calendar-day-count">
              {en
                ? `${selectedDayEvents.length} events`
                : `当日共 ${selectedDayEvents.length} 场`}
            </span>
          </div>
          <CalendarEventRows
            items={selectedDayEvents}
            onOpen={setOpenNotice}
            lang={lang}
          />
        </section>
      ) : (
        <div className="calendar-empty-day">
          <p>
            {en
              ? `No events scheduled on ${cstDateHead(selectedDay, lang).date}.`
              : `${cstDateHead(selectedDay, lang).date} 暂无排期活动。`}
            {weekEventsCount > 0
              ? en
                ? ` There are ${weekEventsCount} events on other days this week.`
                : ` 本周其他日期共有 ${weekEventsCount} 场活动，可点击上方有场次的日期查看。`
              : ""}
          </p>
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

      <DetailSheet notice={openNotice} onClose={() => setOpenNotice(null)} />
    </>
  );
}

function CalendarEventRows({
  items,
  onOpen,
  lang,
}: {
  items: Notice[];
  onOpen: (n: Notice) => void;
  lang: "zh" | "en";
}) {
  return (
    <ul className="calendar-rows">
      {items.map((n) => {
        const cat = CATEGORY_MAP.get(n.category);
        const time = cstTimeLabel(n.startsAt!, lang);
        const range = formatRange(n.startsAt, n.endsAt, lang);
        const clockText =
          range && range.includes("–")
            ? range.replace(/^.*?\s/, "")
            : time.text;

        return (
          <li key={n.id}>
            <button
              type="button"
              className="calendar-row-card"
              data-tone={cat?.tone ?? "leaf"}
              aria-haspopup="dialog"
              onClick={() => onOpen(n)}
            >
              <span className="calendar-row-badge" aria-hidden="true">
                {cat && <Icon name={cat.icon} />}
              </span>
              <span className="calendar-row-main">
                <span className="calendar-row-title">{n.title}</span>
                <span className="calendar-row-meta">
                  <span
                    className="calendar-row-time"
                    data-allday={time.allDay ? "true" : undefined}
                  >
                    <CalendarClock aria-hidden="true" />
                    <span>{clockText}</span>
                  </span>
                  {n.venue && (
                    <span className="calendar-row-venue">
                      <MapPin aria-hidden="true" />
                      <span>{n.venue}</span>
                    </span>
                  )}
                  <span className="calendar-row-cat">
                    {categoryName(n.category, lang)}
                  </span>
                  <span className="calendar-row-source" title={n.source}>
                    {shortSourceName(n.source)}
                  </span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
