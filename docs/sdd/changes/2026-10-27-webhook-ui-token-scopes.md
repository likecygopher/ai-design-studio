# 变更规格：Webhook 管理 UI + API Token 读写权限

- 变更 ID：`CHG-2026-10-27-WEBHOOK-UI-TOKEN-SCOPE`
- 补齐剩余清单第 6 项「Webhook 管理 UI 与 Token scope」。

## 1. API Token 权限

- 创建令牌可选 `scopes`：`read`（只读查询）或 `read + write`（默认，可创建任务等）。
- `handleApi` 对 Bearer 令牌执行写权限检查：非 GET/HEAD/OPTIONS 请求且令牌缺少 `write` → 403 `FORBIDDEN`。
- `/account` 令牌创建增加「权限」下拉；令牌列表展示权限。
- 只读令牌仍可访问 GET 类接口（如任务列表、审计自己的数据）。

## 2. Webhook 管理 UI

- `/account` 新增 Webhook 卡片：回调地址、订阅事件（job.succeeded / job.failed）、创建、一次性签名密钥展示、列表与删除（确认）。
- 复用既有 `/api/account/webhooks` 接口与 HMAC 签名机制；secret 仅创建时返回。
- 列表仅展示 URL 与事件，不回显 secret；删除立即生效。

## 3. 验收

1. 只读令牌 GET 成功、POST 403；读写令牌可提交任务（202）。
2. 账户页可创建 Webhook 并看到一次性 secret；列表可删除。
3. 门禁：tsc 0；126 测试文件 / 745 测试；next build 0；E2E 8/8。
