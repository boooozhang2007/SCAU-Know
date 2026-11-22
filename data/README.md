# 数据目录

本目录存放抓取结果，不纳入版本控制。

```
notices.json     归一化后的全部通知条目
state.json       增量游标、各源最近成功时间、最近报告摘要
reports/         每次抓取的详细报告（保留最近 30 份）
inbox/           微信公众号手工导入的原始记录（JSON）
```

运行 `node scripts/crawl.mjs` 生成。
