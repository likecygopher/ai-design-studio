# 运维手册（Runbook）

> 适用版本：Commercial Platform v1（SDD 规格 `docs/sdd/specs/2026-10-26-commercial-platform/`）。
> 部署形态：Next.js Web（standalone）+ Worker 进程 + PostgreSQL 16 + 持久化存储卷。

## 1. 架构与进程模型

```
浏览器 ──HTTPS──▶ web (Next.js standalone, :3000)
                   ├─ middleware: 会话门禁 / 登录限流 / 安全头
                   ├─ /api/*   REST（handleApi: requestId/认证/限流/日志/错误契约）
                   └─ /api/jobs POST ──写入 GenerationJob(queued)──┐
                                                                  ▼
                                        PostgreSQL ◀── worker (scripts/worker.ts)
                                            ▲              ├─ claimJobs (SKIP LOCKED)
                                            │              ├─ executeJob → AI Provider
                                            │              └─ complete/fail/cancel
                                            └── AuditLog / CostRecord / WorkerHeartbeat

存储卷（STORAGE_ROOT，容器内 /data）
  /data/uploads/<userId>/...     用户上传
  /data/generated/<userId>/...   AI 生成产物
```

- Web 只负责入队与读取结果；**不要让 Web 直接执行耗时的 AI 生成**（超时、重启丢任务）。
- Worker 可水平扩展：`FOR UPDATE SKIP LOCKED` 保证不重复领取。
- 单实例内存限流；多副本部署前必须替换为 Redis 实现（`src/platform/rate-limit.ts` 的 `RateLimiter` 接口）。

## 2. 环境变量

完整模板见 `.env.example`。关键项：

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | 是 | — | PostgreSQL 连接串 |
| `AUTH_SECRET` | 是 | — | ≥32 字符；生产缺失/过短则启动失败。`openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | 建议 | — | 反向代理场景设为 `true` |
| `AI_CONFIG_SECRET` | 建议 | 回退 `AUTH_SECRET` | 加密 `/admin/ai` 保存的供应商密钥；轮换后已存密钥需重新录入 |
| `DEFAULT_MONTHLY_BUDGET_UNITS` | 可选 | 不限制 | 每用户每月默认 AI 预算（估算单位）；用户级可覆盖，0=不限 |
| `STORAGE_ROOT` | 否 | `public` | 存储根目录；容器为 `/data` |
| `JOB_CONCURRENCY` | 否 | 3 | Worker 同时执行任务数 |
| `MAX_USER_ACTIVE_JOBS` | 否 | 2 | 单用户排队+运行任务上限（超出 429） |
| `JOB_LOCK_MS` | 否 | 900000 | 任务租约；超时未续即为僵死，会被回收 |
| `JOB_MAX_ATTEMPTS` | 否 | 3 | 最大尝试次数 |
| `JOB_RETRY_BASE_MS` / `JOB_RETRY_MAX_MS` | 否 | 5000 / 300000 | 指数退避区间 |
| `WORKER_HEARTBEAT_MS` / `WORKER_HEARTBEAT_STALE_MS` | 否 | 10000 / 60000 | 心跳间隔 / 判定失联阈值 |
| `READY_REQUIRE_WORKER` | 否 | 生产 true | `/api/ready` 是否要求 worker 心跳 |
| `MAX_UPLOAD_BYTES` | 否 | 30 MB | 单文件上限（413） |
| `MAX_FILES_PER_REQUEST` | 否 | 10 | 单请求文件数上限 |
| `USER_STORAGE_QUOTA_BYTES` | 否 | 2 GB | 单用户存储配额（413） |
| `BCRYPT_COST` | 否 | 12 | 密码哈希成本（10–15） |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MS` | 否 | 5 / 15min | 登录失败限流窗口 |
| `RATE_LIMIT_LIMIT` / `RATE_LIMIT_WINDOW_MS` | 否 | 30 / 60s | 默认 API 限流 |
| `CLEANUP_RETENTION_DAYS` | 否 | 30 | 清理脚本保留生成产物天数 |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | 生产必填密码 | 演示值 | 生产禁止默认口令，否则 seed 拒绝执行 |

AI Provider（可选，真实生成才需要）：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_IMAGE_MODEL`、`ARK_API_KEY`、`ARK_BASE_URL` 等，见 `.env.example`。

## 3. 首次部署

**一键（推荐）**：

```bash
pnpm deploy:docker
```

自动生成 `.env.docker`（AUTH_SECRET + 管理员随机强密码）→ 构建 → `migrate deploy` → seed → 等待健康检查 → 打印 URL/账号。可选参数：

```bash
WEB_PORT=8080 POSTGRES_PORT=15433 ADMIN_EMAIL=owner@acme.com ADMIN_PASSWORD='StrongPass1234' pnpm deploy:docker
SKIP_SEED=1 pnpm deploy:docker          # 已有管理员/数据
docker compose --env-file .env.docker logs -f web worker
docker compose --env-file .env.docker down
```

手动分步：

```bash
export AUTH_SECRET="$(openssl rand -base64 32)"
export SEED_ADMIN_EMAIL=admin@example.com
export SEED_ADMIN_PASSWORD='<12+位含字母数字>'

docker compose up -d --build              # migrate 容器先执行 prisma migrate deploy
docker compose --profile seed run --rm seed
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/ready
```

非容器（裸机/PM2）：

```bash
pnpm install --frozen-lockfile
pnpm db:deploy        # 生产用迁移，不要用 db:push
pnpm db:seed          # 仅首次
pnpm build
pnpm start            # web
pnpm worker           # 另一进程/服务
```

## 4. 升级与回滚

- **升级**：拉代码 → `pnpm install --frozen-lockfile` → `pnpm db:deploy`（迁移向后兼容，新增表/字段）→ 重新构建 → 滚动重启 web/worker。
- **回滚**：切回上一镜像/commit → 重启进程。数据库迁移若含破坏性变更，需按迁移目录中的 SQL 手工回退（本版迁移均为新增，回退无需删表）。
- **迁移前备份**：`pg_dump "$DATABASE_URL" -Fc -f backup-$(date +%F).dump`，并备份存储卷。
- 迁移状态：`npx prisma migrate status`；历史库（曾用 `db:push` 建表）首次接入迁移需：
  `npx prisma migrate resolve --applied 20261026000000_init`。

## 5. 健康检查与监控

| 端点 | 鉴权 | 语义 |
|---|---|---|
| `GET /api/health` | 公开 | 存活探针，不查 DB；用于容器 liveness / 负载均衡快速判断 |
| `GET /api/ready` | 公开 | 就绪探针：DB 连通 +（生产）60s 内有 worker 心跳；不满足 503 |
| `GET /api/admin/health` | admin | 队列积压、失败数、worker 心跳、限流键数、内存 |
| `GET /api/admin/stats` | admin | 用户数、任务状态分布、24h 失败、存储用量 TopN |
| `GET /api/admin/jobs` | admin | 全平台任务分页检索 |

告警建议：`/api/ready` 持续 503；`admin.stats.jobs.failedLast24h` 突增；`admin.health.workers.alive = 0`；磁盘使用率 >80%。

## 6. 任务卡死 / 队列异常处理

1. 查看：`GET /api/admin/health`（队列积压）或 SQL：
   `SELECT status, count(*) FROM "GenerationJob" GROUP BY status;`
2. **僵死 running**：worker 每轮会自动回收 `lockedAt < now - JOB_LOCK_MS` 的任务。急时可手动：
   ```sql
   UPDATE "GenerationJob"
   SET status='queued', "lockedAt"=NULL, "lockedBy"=NULL, "startedAt"=NULL
   WHERE status='running' AND "lockedAt" < now() - interval '15 minutes';
   ```
3. **worker 未启动**：`docker compose logs -f worker`；确认 `/api/ready` 的 worker 检查与心跳表 `WorkerHeartbeat` 有记录。
4. **任务一直 queued**：检查 `nextAttemptAt`（退避中）、`MAX_USER_ACTIVE_JOBS` 是否被同用户占满、worker 并发是否被长任务占满。
5. **单任务反复失败**：`GET /api/admin/jobs?status=failed` 查看 `error`；`attempts >= maxAttempts` 后进入 failed，需修复原因后让用户重新提交。
6. 管理员可通过 `POST /api/jobs/{id}/cancel` 语义接口取消（需该任务属主；管理员可用 SQL 兜底）。

## 7. 限流（429）处理

- 响应：`429` + `Retry-After`（秒）+ `{ code: "RATE_LIMITED" }`。
- 登录：同 IP 30 次/15min；同 IP+邮箱 5 次/15min（middleware 前置拦截）。
- 注册：同 IP 10 次/小时。API 默认：30 次/分钟/用户；生成类接口更严格。
- 调整阈值：修改 `RATE_LIMIT_*` / `LOGIN_*` 环境变量后重启 web。
- 误伤排查：`grep '"code":"RATE_LIMITED"'` 日志，按 `requestId` 与 `ip` 聚簇；**多副本部署时内存限流各自计数**，需先接 Redis。

## 8. 存储配额与清理

- 配额：`sum(Asset.sizeBytes) + 本次上传 > USER_STORAGE_QUOTA_BYTES` → 413 `STORAGE_QUOTA_EXCEEDED`。管理员可在 `/api/admin/stats` 的 `storage.topUsers` 定位大户。
- 清理（安全，默认只删「无 DB 记录的孤儿文件」；生成产物额外要求超过保留期）：
  ```bash
  pnpm cleanup -- --dry-run   # 先看将删除什么
  pnpm cleanup                # 实际删除
  ```
- 注意：清理脚本会扫描全部租户存储，属运维操作，应在低峰执行并先备份。

## 9. 日志与排障

- 全部服务端日志为单行 JSON：`{ts, level, msg, requestId, path, method, status, durationMs, userId, code, ...}`，敏感字段自动打码（`password/token/secret/apiKey/authorization/cookie`）。
- 每个 HTTP 响应头带 `x-request-id`；客户端报障时提供该 id，直接 `grep <requestId>` 即可串起请求链路。
- NextAuth 登录失败只返回通用提示（不区分账号/密码），失败详情见 `auth.login_failed` 日志。
- 审计：`AuditLog` 表记录 `auth.register/auth.login/job.*/admin.*/rate_limit.exceeded` 等；排查越权/滥用时按 `userId`、`action`、`createdAt` 查询。

## 10. 备份与恢复

```bash
# 数据库
pg_dump "$DATABASE_URL" -Fc -f db-$(date +%F).dump
pg_restore --clean --if-exists -d "$DATABASE_URL" db-2026-10-26.dump

# 存储卷（docker）
docker run --rm -v midea-ai-pic-studio_studio-storage:/data -v "$PWD":/backup alpine \
  tar czf /backup/storage-$(date +%F).tgz -C /data .
```

恢复顺序：先 DB（资产元数据），再存储卷（文件）。两者需来自同一时间点，否则会出现有记录无文件或孤儿文件（可用 `pnpm cleanup` 清理后者）。

## 11. 常见故障

| 现象 | 排查 |
|---|---|
| 启动即失败，日志含 `Platform configuration is invalid` | `AUTH_SECRET` 缺失/不足 32 字符，或 `DATABASE_URL` 缺失 |
| `/api/ready` 503，`database.ok=false` | DB 未启动/连接串错误/网络策略；`docker compose logs postgres` |
| `/api/ready` 503，`worker.ok=false` | worker 未运行或心跳过期；`docker compose ps worker`、查看 `WorkerHeartbeat` |
| 页面无限跳转 `/login` | 反向代理未透传 `x-forwarded-proto`/Host；设置 `AUTH_TRUST_HOST=true` 并保持 TLS 终止头 |
| 登录 401 但账号正确 | 检查 `AUTH_SECRET` 是否在滚动发布中被更换；检查登录限流是否触发 |
| 生成 401/超时（Provider） | 校验 Provider Key/BaseURL/代理；日志 `api.error` 与 requestId |
| 上传 415 | 文件真实类型不在 PNG/JPEG/WebP/PDF/MP4（SVG 被禁止） |
| 上传 413 | 单文件/批量/用户配额超限，见第 8 节 |
| 任务成功但图片 404 | 存储卷未挂载/`STORAGE_ROOT` 不一致；检查 `/data/{uploads,generated}` 与 DB `storageKey` |
| pnpm 报 `EPERM`（Windows） | 用 Node 24 + `npm install --no-package-lock --cache=.npm-cache` 过渡，或升级 pnpm |

## 12. 用户与账户管理

入口：管理员登录后左侧「平台管理 → 用户管理」（`/admin/users`）；所有用户可在「账户设置」（`/account`）自助改密。

| 操作 | 入口 | 行为 |
|---|---|---|
| 创建用户 | 用户管理 → 新建用户 | 可指定昵称/角色/初始密码；留空则生成 16 位一次性密码，**仅响应中展示一次**（不落日志/审计） |
| 修改昵称/角色 | 用户管理 → 编辑 | 角色即时生效（每次请求从 DB 读取角色） |
| 禁用/启用 | 用户管理 → 编辑 → 禁用该账户 | 立即生效：受保护 API 返回 401，页面跳 `/api/auth/expire` 清 Cookie 后回登录页 |
| 重置密码 | 用户管理 → 改密 | `User.authVersion += 1`，该用户所有既有 JWT 立即失效；管理员重置自己密码会强制重新登录 |
| 自助改密 | 账户设置 | 需校验当前密码；成功后旧会话失效并跳登录页 |

守卫与错误码：

- `CANNOT_MODIFY_SELF (400)`：管理员不能禁用/降级自己，避免自锁。
- `LAST_ADMIN (409)`：不能移除最后一名可用管理员（降级或禁用时校验）。
- 被禁用用户登录：与密码错误返回同一通用提示（不泄露账号状态），实际原因写入 `auth.login_failed` 审计。
- 审计动作：`admin.user.create` / `admin.user.update` / `admin.user.password_reset` / `account.password_change`。

注意：
- 会话校验为**每请求一次主键查询**（`getSessionUser` 回查 `User` 的 `disabled/authVersion/role`）。这是即时吊销的代价，规模化时可加短 TTL 缓存（P1）。
- 禁用用户不会删除其数据；如需彻底移除请走数据保留/删除流程（本版未提供删除用户 API，避免误删级联业务数据）。

## 13. AI 引擎与审计日志

### 配置供应商

1. 管理员登录 → 「平台管理 → AI 引擎」。
2. 「新增供应商」→ 选预设（OpenAI / DeepSeek / Moonshot / 通义 / OpenRouter / 火山方舟）或「自定义 OpenAI 兼容」→ 填写名称、渠道、Base URL、代理（可选）、API Key、模型 → 保存。
3. 同渠道可保留多个供应商；**第一行启用项生效**（priority 小优先，其次创建时间），其余作为备份。用行内星标「设为生效」快速切换。
4. 行内可「测试」：请求 `{Base URL}/models`，区分成功 / 鉴权失败（401/403）/ 地址错误（404）/ 网络错误 / 超时；结果写入该行「最近测试」。
5. 「编辑」可改 Base URL、代理、模型、启用状态、替换密钥或清除密钥；「删除」不可撤销。

生效方式：管理端保存后立即写入当前 Web 进程 env；Worker 每 60s 重新加载，Web 进程在首次使用后每 60s 刷新。多 Web 副本部署时，其他实例最多 60s 后生效（P1 可改为配置中心/Redis 通知）。未配置数据库供应商时回退 `.env` 的 `OPENAI_*` / `ARK_*`。

故障切换：Worker 每次任务尝试会归因到任务渠道的当前供应商（视频→ARK；`imageModel=doubao`→ARK；其余→OpenAI 兼容）。同渠道连续失败 2 次时自动把下一个启用供应商提升为生效项并写审计 `admin.ai_config.failover`，下一次重试使用备用供应商；只有一个供应商时不切换。管理端表格展示成功/失败/连续失败，可手动「设为生效」覆盖。注意：属工作负载级切换（下一次尝试生效），同步路由可能需最多 60s 感知。

密钥安全：数据库中以 AES-256-GCM 密文保存；列表只显示末四位；接口与审计日志不含明文。轮换 `AI_CONFIG_SECRET` 后旧密文无法解密，需要重新录入密钥。

### 审计日志

「平台管理 → 审计日志」可按操作类型或关键词（邮箱/动作/目标 ID/目标类型）筛选；记录包含时间、操作、操作者、目标、`requestId` 与元数据摘要。登录失败、用户管理、AI 配置变更、任务取消、限流触发等均会留痕。

## 14. 任务运维与月度预算

### 失败任务重试

- 用户：任务中心 → 失败/已取消任务 → 「重试任务」；系统复制原任务类型与 payload 新建任务（原任务保留）。
- 管理员：`/admin/jobs` 可按状态/用户 ID 检索，失败任务可重试、排队/运行任务可取消；操作写审计（`job.retry` / `admin.job.cancel`）。
- 已完成任务不可重试（409 `JOB_NOT_RETRYABLE`）；重试同样受并发配额与月度预算约束。

### 月度预算

- 默认值：`DEFAULT_MONTHLY_BUDGET_UNITS`（未设置=不限制）。管理员可在 `/admin/users` 编辑单个用户预算：留空=平台默认，`0`=不限制，正数=上限。
- 用量 = 当月 `CostRecord.estimatedUnits` 之和（UTC 月初起）；`/costs` 展示进度与明细。
- 用尽后新任务返回 `429 COST_BUDGET_EXCEEDED` 并记录 `job.blocked_budget`；调整预算或下月自动重置。
- 多实例部署时预算校验以数据库为准，不存在缓存不一致问题。

## 15. 质量门禁与 E2E

- CI（`.github/workflows/ci.yml`）依次执行：安装依赖 → `pnpm audit`（生产依赖 high+）→ Prisma generate/migrate → typecheck → 单测 → build → seed → Playwright Chromium → `pnpm e2e`。
- 本地 E2E：`pnpm build` + `pnpm db:seed` 后运行 `pnpm e2e`（`playwright.config.ts` 会用 `pnpm start` 自动拉起 3000 端口；可用 `E2E_BASE_URL` 指向已有实例）。
- E2E 使用一次登录并复用 `storageState`，避免触发 `LOGIN_MAX_ATTEMPTS` 登录限流；种子账号由 `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` 覆盖。
- 依赖升级：Next 15.5.28、undici 6.29.1、sharp 0.35.5、Zod 4.6.7；传递依赖安全版本固定在 `pnpm-workspace.yaml#overrides`（pnpm 11 不再读取 `package.json#pnpm`）。

## 16. 两步验证与登录设备

- 用户在 `/account` 开启两步验证：扫描/手动输入 otpauth 密钥 → 输入 6 位验证码启用 → **立即保存一次性恢复码**。
- 登录时密码通过后需输入验证码或恢复码（登录页有可选字段）；失败与密码错误共用提示，避免账号枚举。
- 停用/重生成恢复码需要当前验证码；启用后请确认验证器时间同步（允许 ±1 个 30 秒窗口）。
- 登录设备：`/account` 展示浏览器/系统、IP、最近活跃与当前设备标记；可吊销任意设备（含当前设备，立即登出）。改密和管理员重置密码会吊销全部设备。
- 会话表由 `pnpm cleanup` 清理超过 `CLEANUP_RETENTION_DAYS`（默认 30 天）的过期/已吊销记录；排查登录问题时可按用户查 `AuthSession` 与审计 `auth.login_failed`。
- 2FA 密钥以 AES-256-GCM 加密落库（`AI_CONFIG_SECRET`/`AUTH_SECRET` 派生），恢复码仅存 SHA-256。

## 17. 语言切换（i18n）

- 默认中文；登录页/侧边栏的 `中文 / EN` 切换写入 cookie `studio_locale=zh|en`（一年期、SameSite=Lax），随后服务端重新渲染，无需登出。
- 字典位于 `src/i18n/core.ts`，缺失键回退中文；当前覆盖外壳/导航、登录注册、账户安全。管理端与工作流页面仍在迁移中，切换英文时这些页面会继续显示中文。
- 服务端业务错误消息暂为中文（按错误码映射英文列为后续项）；排查语言问题时检查浏览器 cookie 是否被上游网关覆盖。

## 18. 可观测性（指标与告警）

- Prometheus 抓取：`GET /api/metrics`。二选一鉴权：
  - 设置 `METRICS_TOKEN`（≥16 字符）后使用 `Authorization: Bearer <token>`；
  - 否则使用管理员会话（浏览器/代理）。
- 抓取示例：`curl -H "Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:3000/api/metrics`。
- 关键指标：`studio_http_requests_total` / `studio_http_request_duration_ms`（按归一化路由）、`studio_jobs_*`、`studio_job_duration_ms`、`studio_provider_*`、`studio_jobs_blocked_budget_total`、进程内存/运行时长。
- 建议告警：24h 失败率、排队深度、Worker 在线数、供应商连续失败、5xx 比例；对应阈值可用 `ALERT_FAILURE_RATE`、`ALERT_QUEUE_DEPTH` 调整。
- `/admin` 概览顶部会展示 `/api/admin/health` 返回的告警（critical/warning）；健康状态为 `ok/degraded/unhealthy`。
- 指标是进程内的：多副本部署时逐个抓取；重启后计数清零（Prometheus `rate()` 可跨重启容忍）。

## 19. API Token、Webhook 与 OpenAPI

### 个人 API Token

- 在 `/account` →「API 令牌」创建；明文只显示一次，数据库仅保留 SHA-256 哈希。
- 调用方式：`curl -H "Authorization: Bearer mcs_..." https://<host>/api/jobs`；令牌继承创建者角色（管理员令牌可访问管理端）。
- 支持 `expiresInDays`（1–365）与吊销；`lastUsedAt` 记录最近使用。令牌泄露时立即在账户页吊销。
- 中间件允许带 Bearer 的请求进入 Node 路由，实际校验在 `handleApi`（含吊销/过期/禁用用户检查）。

### Webhook

- 创建：`POST /api/account/webhooks` body `{ url, events:["job.succeeded","job.failed"] }`；返回一次性 `secret`。
- 仅接受 `https://`，拒绝内网/本机地址；签名头 `X-Studio-Signature: sha256=HMAC(secret, timestamp + "." + body)`，配合 `X-Studio-Timestamp` 防重放（接收端建议校验时间窗）。
- 投递为单次、8s 超时；结果在 `WebhookDelivery` 记录，端点行展示最近投递状态；失败不阻塞任务终态。
- 调试：接收端先校验 HMAC，再按 `event` 与 `job.status` 处理；可用 `WebhookDelivery.error` 排查网络/HTTP 问题。

### OpenAPI

- `GET /api/openapi` 返回 OpenAPI 3.1 文档（公开）；可用于生成客户端或导入 Postman/Apifox。
- 文档覆盖 session cookie 与 Bearer 两种安全方案；Bearer 需使用个人 API Token。

## 20. 数据治理（导出 / 注销 / 审计导出）

### 用户数据导出

- 用户：`/account` →「导出我的数据」；API `GET /api/account/export`（附件 JSON）。
- 内容：账号资料、设置、产品、素材元数据、任务（不含 payload）、成本、审计、API Token 元数据、Webhook、会话；每类最多 1000 条。
- 不包含：密码哈希、Token 哈希、Webhook secret、资产 storageKey（防路径泄露）。
- 导出会写审计 `account.data_export`，限流 3 次/15 分钟，避免批量拖库。

### 账号注销

- 用户：`/account` →「注销账号」→ 输入当前密码 → 永久删除。
- 服务端校验密码；最后一名可用管理员会收到 409 `LAST_ADMIN`；删除用户级联清理产品/素材/任务/成本/会话/令牌/Webhook。
- 资产文件在删除时尽力清理，剩余孤儿由 `pnpm cleanup` 处理；审计保留（userId 置空，记录邮箱与资产数量）。
- 旧会话/JWT 因用户行不存在而失效；如需保留审计追溯，请先导出。

### 审计日志导出

- 管理员：`/admin/audit` →「导出 CSV」（沿用操作类型筛选）；API `GET /api/admin/audit/export?action=&from=&to=&limit=`。
- CSV 带 UTF-8 BOM，Excel 直接打开；含 metadata JSON。默认 1000 行、上限 5000；导出动作本身写 `admin.audit_export`。
- 时间参数使用 ISO 8601（如 `2026-10-01T00:00:00.000Z`）。

## 21. Redis 分布式限流

- 单副本：不设置 `REDIS_URL`，使用进程内滑动窗口，无需额外依赖。
- 多副本：设置 `REDIS_URL=redis://[:password@]host:6379`；API 与登录限流键写入 Redis（`studio:rl:*`、`studio:login:*`），跨实例共享。
- 实现：Lua 原子 `INCR + PEXPIRE + PTTL` 固定窗口；请求/登录独立前缀；`RATE_LIMIT_*` 与 `LOGIN_*` 阈值不变。
- 故障：连接超时 2s、失败自动回退进程内限流并记录 `rate_limit.redis_unavailable/error`；不会阻塞登录/API，但多副本期间退化为单实例限流。
- 首次冷启动请求可能在 Redis 连接预热期走内存回退，随后自动使用 Redis。
- Edge middleware 的登录预检查仍为进程内（只做粗粒度 IP/账号限流）；最终登录校验在 Node 层使用 Redis。
- 观测：`/api/metrics` 提供限流拒绝计数；Redis 故障日志可在 `rate_limit.redis_*` 关键字检索。

## 22. 企业 SSO（OIDC）

- 在 IdP 创建 OIDC 应用，回调地址 `https://<域名>/api/auth/callback/enterprise-sso`，获取 issuer/client id/secret。
- 配置 `SSO_ISSUER`、`SSO_CLIENT_ID`、`SSO_CLIENT_SECRET`（可选 `SSO_NAME/SSO_SCOPES/SSO_ALLOWED_DOMAINS/SSO_AUTO_PROVISION/SSO_DEFAULT_ORG_SLUG`），重启服务。
- 登录页出现「使用企业 SSO 登录」；首次登录按邮箱关联已有账号，未知邮箱按 `SSO_AUTO_PROVISION` 自动开通（默认 true），可自动加入指定组织。
- 安全：建议配置域名白名单；禁用账号会被拒绝；SSO 不校验本地 TOTP（由 IdP MFA 负责）。审计日志可见 `auth.login`（provider=sso）与 `auth.sso_provision`。
- 排障：回调 400 多为 redirect URI 未注册或 issuer 不匹配；Auth.js 日志 `auth.sso_*`；本地账号可检查 `ssoProvider/ssoSubject`。
- 当前为平台级单 IdP；多组织独立 IdP/SCIM/SAML 尚未实现。

## 23. 组织级 IdP 与 SCIM

- 组织 owner/admin 在 `/account/organization/sso` 配置：
  - OIDC：issuer/clientId/clientSecret；IdP 回调填 `https://<域名>/api/auth/sso/oidc/callback`；
  - SAML：entryPoint/IdP issuer/签名证书；SP Metadata `https://<域名>/api/auth/sso/saml/metadata?org=<slug>`，ACS `https://<域名>/api/auth/sso/saml/callback`；
  - 邮箱域白名单、自动开通、默认角色、`groupRoleMap`（IdP 组→owner/admin/member）。
- 登录入口：登录页列出启用 SSO 的组织；也支持 `/api/auth/sso/start?org=<slug>`（或 `email=` 按域匹配）。
- SCIM：生成令牌（仅显示一次），IdP SCIM Base URL `https://<域名>/api/scim/v2`，Bearer 认证；用户/组增删改同步组织成员与角色。
- 排查：IdP 回调失败检查 redirect/ACS、issuer、证书、系统时间；审计 `organization.sso_update`/`organization.scim_token_rotate`/`auth.login`。
- 已知边界：无 SAML SLO、无 SCIM Bulk；SCIM 停用仅移除组织成员关系。

## 24. 告警外发（Slack/Webhook）

- 配置 `ALERT_WEBHOOK_URL`（Slack Incoming Webhook 或其他接受 `POST {text}` 的地址）后，Worker 每 60s 调用统一健康快照并推送告警。
- 告警来源：数据库不可用（critical）、无在线 Worker（critical）、排队深度超 `ALERT_QUEUE_DEPTH`、24h 失败率超 `ALERT_FAILURE_RATE`、供应商连续失败 ≥2。
- 去重：相同告警签名在 `ALERT_COOLDOWN_MS`（默认 15 分钟）内只发一次；全部恢复时发送一次 ✅ 恢复通知。
- 投递失败只写日志与指标 `studio_alert_dispatch_failures_total`，不影响 Worker 任务执行；未配置时无额外开销。
- 健康接口 `/api/admin/health` 与管理端概览使用同一快照，阈值保持一致。

## 23. 任务审批流

- 开启方式：管理员在 `/admin/users` 编辑用户 → 勾选「该用户的新任务需要管理员审批」；或平台级环境变量 `JOB_REQUIRE_APPROVAL=true`（所有用户）。
- 新任务入队后 `approvedAt=null`，Worker 不会领取；管理端 `/admin/jobs` 选择「审批=待审批」可查看并「批准/驳回」。
- 批准：设置 `approvedAt/approvedBy/approvalNote` 并重置 `nextAttemptAt`，下一次 Worker 轮询执行；驳回：任务置 cancelled，错误信息为「审批未通过：备注」。
- 审计：`admin.job.approve` / `admin.job.reject`；用户编辑开关记入 `admin.user.update`。
- 关闭审批后，新任务立即 `approvedAt=now()`；历史任务由迁移回填，不会被误判为待审批。
- 注意：审批只拦截新任务执行，不改变额度/并发校验（二者仍在入队时执行）。

## 23. 对象存储（S3/OSS）

- 默认 `STORAGE_DRIVER=local`：文件在 `STORAGE_ROOT`，资产直链为 `/uploads/...`、`/generated/...`。
- 切换 `STORAGE_DRIVER=s3` 并配置 `S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY`（凭据也可由 IAM Role 提供）；MinIO 需 `S3_FORCE_PATH_STYLE=true`。
- S3 模式：上传/生成资产写入 bucket（前缀 `S3_PREFIX`），数据库 `url` 统一为 `/api/assets/{id}/file`，浏览器通过鉴权代理读取，不暴露公共对象地址；删除资产同时删除对象。
- 阿里云 OSS 使用其 S3 兼容 endpoint；如遇签名差异，可改用 MinIO 网关或在 SDK 层扩展。
- 已知边界：localize/demo 模板导出仍写本地 `public/generated`；未实现预签名 URL 与分片上传。
- 回滚：改回 `STORAGE_DRIVER=local` 并重启；数据库 URL 指向代理路径的旧记录需重新生成或迁移。

## 24. Webhook 投递与重试

- 投递失败会按 30s、1m、2m、4m 退避重试，最多 5 次；Worker 每 60s 扫描到期记录。
- 账户页 Webhook 卡片 →「投递记录」查看最近 20 条；失败项可手动重试。
- 接口：`GET /api/account/webhooks/{id}/deliveries`、`POST /api/account/webhooks/{id}/deliveries/{deliveryId}/retry`。
- 排查：投递错误的 `responseStatus`/`error` 会记录；签名校验失败请核对 endpoint secret 与 `X-Studio-Signature` 计算方式。

## 25. 套餐（Plan）配额

- 管理员：`/admin/plans` 创建/编辑套餐，设置「月度预算（单位，空=平台默认，0=不限）」与「并发任务上限（空=平台默认）」。
- 绑定用户：`/admin/users` 编辑用户 → 套餐下拉；资源列显示套餐名。接口 `PATCH /api/admin/users/{id}` 的 `planId`（null 解绑）。
- 优先级：用户显式预算 > 套餐预算 > 平台默认；并发：套餐上限 > `MAX_USER_ACTIVE_JOBS`。
- 删除：套餐仍有成员时返回 409，需要先解绑；删除审计 `admin.plan_delete`。
- 当前不包含支付/订阅状态/账单：按产品要求不做 Web 支付；套餐仅作为配额模型（预算/并发/绑定用户）。

## 24. 已知边界（P1）

- 限流为单实例内存实现，多副本需 Redis。
- 存储为本地卷，尚不支持对象存储/S3 直传（接口已预留）。
- `public/uploads`、`public/generated` 静态 URL 仍可访问（历史兼容）；授权读取请用 `/api/assets/{id}/file`。
- POP 页面为本地合成导出（2026-07-22 决策），不恢复 AI 贴装。
