"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { CLUSTERS, categoriesOf, type CategoryIntent } from "@/lib/site";
import { usePreferences } from "@/lib/preferences";
import { Icon } from "./icon";

/**
 * 吸顶分类导航栏（参照 pkuknow.cn/thu 单行三胶囊架构）：
 * - 左侧独立「全部」胶囊
 * - 中间「活动」胶囊组（含该组「全部」+ 6 个活动子类）
 * - 右侧「通知」胶囊组（含该组「全部」+ 8 个通知子类）
 *
 * 在活动日历页自动切换为 `/calendar?category=xxx`，在搜索态保留 `?q=` 参数。
 */
export function CategoryNav({
  counts,
  activeCategory,
  activeCluster,
  currentQuery,
}: {
  counts: Record<string, number>;
  activeCategory?: string | null;
  activeCluster?: CategoryIntent | null;
  currentQuery?: string;
}) {
  const pathname = usePathname() ?? "/";
  const { lang } = usePreferences();
  const en = lang === "en";
  const inCalendar = pathname.startsWith("/calendar");
  const inSources = pathname.startsWith("/sources");
  const [mobileOpenCluster, setMobileOpenCluster] = useState<CategoryIntent | null>(null);

  const routeActiveCategory =
    activeCategory ?? pathname.match(/\/category\/([a-z-]+)/)?.[1] ?? null;

  const qSuffix = currentQuery?.trim() ? `?q=${encodeURIComponent(currentQuery.trim())}` : "";

  const hrefForCategory = (slug: string) =>
    inCalendar ? `/calendar?category=${slug}` : `/category/${slug}${qSuffix}`;

  const hrefForCluster = (cluster: CategoryIntent) => {
    if (inCalendar) return "/calendar";
    const params = new URLSearchParams();
    params.set("cluster", cluster);
    if (currentQuery?.trim()) params.set("q", currentQuery.trim());
    return `/?${params.toString()}`;
  };

  const allHref = inCalendar ? "/calendar" : qSuffix ? `/search${qSuffix}` : "/";
  const isAllActive = !inSources && !routeActiveCategory && !activeCluster;

  return (
    <div className="category-shell">
      <nav
        className="category-bar"
        aria-label={en ? "Category navigation" : "分类导航"}
      >
        {/* 桌面端：单行三胶囊结构 */}
        <div className="category-desktop-row">
          <Link
            className="category-all-pill"
            href={allHref}
            aria-current={isAllActive ? "page" : undefined}
            title={en ? "Browse all events and notices" : "浏览全部活动与通知"}
          >
            <Icon name="layout-grid" />
            <span>{en ? "All" : "全部"}</span>
          </Link>

          {CLUSTERS.map((cluster) => {
            const items = categoriesOf(cluster.key);
            const isClusterAll = !inCalendar && !routeActiveCategory && activeCluster === cluster.key;
            return (
              <div
                key={cluster.key}
                className="category-capsule"
                data-tone={cluster.tone}
                role="group"
                aria-label={en ? cluster.labelEn : cluster.label}
              >
                <span className="category-capsule-label">
                  <Icon name={cluster.icon} />
                  <span>{en ? cluster.labelEn : cluster.label}</span>
                </span>
                <span className="category-capsule-sep" aria-hidden="true" />
                {!inCalendar && (
                  <Link
                    href={hrefForCluster(cluster.key)}
                    className="category-chip category-chip-suball"
                    aria-current={isClusterAll ? "page" : undefined}
                    title={
                      en
                        ? `All ${cluster.labelEn}`
                        : `浏览全部${cluster.label}`
                    }
                  >
                    <Icon name="layout-grid" />
                    <span>{en ? "All" : "全部"}</span>
                  </Link>
                )}
                {items.map((c) => (
                  <Link
                    key={c.slug}
                    href={hrefForCategory(c.slug)}
                    className="category-chip"
                    data-tone={c.tone}
                    aria-current={routeActiveCategory === c.slug ? "page" : undefined}
                    title={
                      counts[c.slug]
                        ? `${c.hint}（共 ${counts[c.slug]} 条）`
                        : c.hint
                    }
                  >
                    <Icon name={c.icon} />
                    <span>{en ? c.nameEn : c.name}</span>
                  </Link>
                ))}
              </div>
            );
          })}
        </div>

        {/* 移动端：三等分主按钮 + 全宽展开托盘 */}
        <div className="category-mobile-wrap">
          <div className="category-mobile-tabs">
            <Link
              className="category-mobile-tab"
              href={allHref}
              aria-current={isAllActive ? "page" : undefined}
              onClick={() => setMobileOpenCluster(null)}
            >
              <Icon name="layout-grid" />
              <span>{en ? "All" : "全部"}</span>
            </Link>
            {CLUSTERS.map((cluster) => {
              const items = categoriesOf(cluster.key);
              const isOpen = mobileOpenCluster === cluster.key;
              const containsActive =
                activeCluster === cluster.key ||
                items.some((c) => c.slug === routeActiveCategory);
              return (
                <button
                  key={cluster.key}
                  type="button"
                  className="category-mobile-tab"
                  data-tone={cluster.tone}
                  data-active={containsActive || isOpen ? "true" : undefined}
                  aria-expanded={isOpen}
                  onClick={() =>
                    setMobileOpenCluster((prev) =>
                      prev === cluster.key ? null : cluster.key,
                    )
                  }
                >
                  <Icon name={cluster.icon} />
                  <span>{en ? cluster.labelEn : cluster.label}</span>
                  <ChevronDown
                    className={`category-mobile-chevron ${isOpen ? "is-open" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>

          {mobileOpenCluster && (
            <div className="category-mobile-tray">
              {!inCalendar && (
                <Link
                  href={hrefForCluster(mobileOpenCluster)}
                  className="category-chip"
                  aria-current={
                    !routeActiveCategory && activeCluster === mobileOpenCluster
                      ? "page"
                      : undefined
                  }
                  onClick={() => setMobileOpenCluster(null)}
                >
                  <Icon name="layout-grid" />
                  <span>
                    {en
                      ? `All ${mobileOpenCluster === "activity" ? "Events" : "Notices"}`
                      : `全部${mobileOpenCluster === "activity" ? "活动" : "通知"}`}
                  </span>
                </Link>
              )}
              {categoriesOf(mobileOpenCluster).map((c) => (
                <Link
                  key={c.slug}
                  href={hrefForCategory(c.slug)}
                  className="category-chip"
                  data-tone={c.tone}
                  aria-current={routeActiveCategory === c.slug ? "page" : undefined}
                  onClick={() => setMobileOpenCluster(null)}
                >
                  <Icon name={c.icon} />
                  <span>{en ? c.nameEn : c.name}</span>
                  {counts[c.slug] ? (
                    <span className="category-chip-count">{counts[c.slug]}</span>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
        </div>
      </nav>
    </div>
  );
}
