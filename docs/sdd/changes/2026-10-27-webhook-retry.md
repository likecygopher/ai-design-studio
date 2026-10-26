# 变更规格：Webhook 投递记录与失败重试

- 变更 ID：`CHG-2026-10-27-WEBHOOK-RETRY`
- 目标：补齐 Webhook 可靠性：持久化 payload、指数退避自动重试、账户页投递记录与手动重试。

## 1. 数据

`WebhookDelivery` 新增：
- `payload String?`：签名请求体（用于重试）；
- `attempts Int @default(0)`；
- `nextAttemptAt DateTime?`：下次自动重试时间；
- `updatedAt DateTime @updatedAt`；`status` 默认 `pending`。
- 迁移：`20261027100000_webhook_retry`（updatedAt 带默认值，兼容已有行）。

## 2. 投递与重试

- 首次投递：记录 payload、attempts=1；失败时 `nextAttemptAt = now + 30s * 2^(attempts-1)`，上限 1 小时。
- Worker 每 60s 扫描 `status=failed && attempts<5 && nextAttemptAt<=now` 的投递并重发；成功标记 delivered，达上限停止。
- 手动重试：`POST /api/account/webhooks/{id}/deliveries/{deliveryId}/retry`（仅本人 endpoint）。
- 列表：`GET /api/account/webhooks/{id}/deliveries`（最近 20 条）。
- 账户页 Webhook 卡片：投递记录展开、状态/尝试次数/错误、失败项手动重试。

## 3. 验收

1. 失败投递按退避自动重试，最多 5 次；成功即停止。
2. 账户页可查看投递记录并手动重试（仅本人数据）。
3. 门禁：tsc 0；129 测试文件 / 758 测试；next build 0；E2E 8/8。
