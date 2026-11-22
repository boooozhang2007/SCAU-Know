import seedNotices from "./seed-notices.json";
import type { Notice } from "./types";

/**
 * 内置真实首屏通知快照（由 `pnpm export:seed` 从华南农业大学公开采集数据生成）。
 * 每条均带真实官网/公众号原文链接；本地存在 `data/notices.json` 时自动由实时采集库接管。
 */
export const NOTICES: Notice[] = seedNotices as Notice[];
