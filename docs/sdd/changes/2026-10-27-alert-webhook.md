# 变更规格：告警外发（Slack/Webhook）+ 统一健康快照

- 变更 ID：`CHG-2026-10-27-ALERT-WEBHOOK`
- 目标：在既有 `/api/admin/health` 告警基础上增加主动通知，避免必须盯着后台。

## 1. 统一健康快照

- 新增 `src/platform/alerting.ts#collectPlatformHealth()`：数据库探测、队列/运行/24h 失败率、Worker 在线、供应商连续失败 → 返回状态与 `alerts`。
- `/api/admin/health` 改为复用该快照，dashboard 与通知阈值不会漂移。

## 2. 告警外发

- 配置 `ALERT_WEBHOOK_URL`（Slack 兼容，POST `{ text }`）后：
  - Worker 启动即检查一次，之后每 60s 巡检；失败只记录日志，不影响任务处理；
  - 告警按「severity:id」签名去重，冷却 `ALERT_COOLDOWN_MS`（默认 15 分钟）内不重复发送；
  - 告警清零时发送一次恢复消息；
  - 5s 超时；投递指标 `studio_alerts_dispatched_total`、失败 `studio_alert_dispatch_failures_total`。
- 未配置 Webhook 时完全 no-op，不产生额外查询（`runAlertCheck` 直接返回）。

## 3. 验收

1. 配置 Webhook 后，Worker 将 critical/warning 告警以 Slack 文本格式推送；重复告警在冷却期内不重发。
2. 告警恢复后仅发送一次恢复通知。
3. 未配置时健康接口行为不变；Webhook 失败不影响 Worker。
4. 门禁：tsc 0；127 测试文件 / 750 测试；next build 0；E2E 8/8。
