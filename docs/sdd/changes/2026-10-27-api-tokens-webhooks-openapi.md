# 变更规格：API Token + Webhook + OpenAPI

- 变更 ID：`CHG-2026-10-27-API-ACCESS`
- 触发：已批准清单第 8 项「API Token/Webhook 与 OpenAPI」。

## 1. API Token（个人访问令牌）

- 数据：`ApiToken`（userId/name/prefix/tokenHash/scopes/lastUsedAt/expiresAt/revokedAt）。
  - 明文格式 `mcs_<base64url>`，仅在创建时返回一次；数据库只存 **SHA-256**，列表展示前 12 位前缀。
  - 可选 `expiresInDays`（1–365）；吊销后立即失效。
- 认证：`Authorization: Bearer mcs_...`
  - 中间件对带 Bearer 的请求放行到 Node 路由（Edge 不查库）；
  - `handleApi` 在无会话时调用 `authenticateApiToken`：校验哈希、吊销、过期、用户禁用，随后按用户角色鉴权（admin token 可访问管理端）。
  - 使用记录 `lastUsedAt` 异步更新。
- 接口：`GET/POST /api/account/api-tokens`、`DELETE /api/account/api-tokens/{id}`；审计 `account.api_token_create/revoke`。
- UI：`/account` 新增「API 令牌」卡片：创建（名称）、一次性展示、复制、吊销、前缀与最近使用时间。

## 2. Webhook

- 数据：`WebhookEndpoint`（url/加密 secret/events/enabled/lastDelivery*）与 `WebhookDelivery`（event/status/responseStatus/error）。
- 事件：`job.succeeded`、`job.failed`（Worker 在任务终态后投递）。
- 请求：
  - `POST <url>`，JSON `{ event, job:{id,type,status,error}, sentAt }`；
  - 头：`X-Studio-Event`、`X-Studio-Timestamp`（秒）、`X-Studio-Signature: sha256=HMAC_SHA256(secret, timestamp + "." + body)`；
  - 8s 超时，单次投递；结果写入 `WebhookDelivery` 并更新端点最近状态。
- 安全：仅允许 `https://`、拒绝 URL 凭据与 localhost/私网/`.local`/`.internal`（基础 SSRF 防护）；secret 以 AES-256-GCM 加密落库，创建时明文仅展示一次。
- 接口：`GET/POST /api/account/webhooks`、`DELETE /api/account/webhooks/{id}`；审计 `account.webhook_create/delete`。

## 3. OpenAPI

- `GET /api/openapi` 返回 OpenAPI 3.1 文档（公开、无敏感信息），覆盖认证、任务、账户安全、Token/Webhook、管理端、健康与 metrics，共 16 条路径。
- 安全方案：`sessionCookie`（NextAuth cookie）与 `bearerAuth`（个人 API Token）。

## 4. 验收

1. 创建令牌后，仅用 `Authorization: Bearer` 可调用 `/api/jobs` 与管理员接口；无效/吊销/过期令牌 401。
2. 中间件不再拦截 Bearer 请求；普通匿名请求仍 401。
3. 创建 Webhook 返回一次 secret；列表不含 secret；终态任务触发签名投递并记录结果；非法 URL 400。
4. `/api/openapi` 返回 3.1 文档。
5. 门禁：tsc 0；118 测试文件 / 705 测试；next build 0。
