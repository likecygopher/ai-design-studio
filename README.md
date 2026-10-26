# Midea AI Content Studio

商业级多用户 AI 内容生产平台：Next.js 15（App Router）+ React 19 + PostgreSQL/Prisma + NextAuth v5 + 独立任务 Worker。

- **多用户与隔离**：邮箱密码登录、JWT 会话、所有资源按 `userId` 隔离，跨用户访问统一 404。
- **RBAC 与账户管理**：`user`/`admin` 角色；`/admin/users` 可创建用户、改昵称/角色、禁用/启用、重置密码（一次性密码仅展示一次）；最后一名管理员与自我降级有守卫；关键操作写 `AuditLog`。
- **账户安全**：`/account` 自助改密、TOTP 两步验证（含一次性恢复码）、登录设备列表与单个吊销；每次登录写入 `AuthSession`，JWT 携带 `sessionId` 并由服务端校验；禁用/改密会递增 `User.authVersion` 并吊销全部设备会话。
- **异步任务**：任务入队 → Worker 执行（幂等提交、指数退避重试、僵死租约回收、取消、心跳、优雅退出）。
- **统一 API 契约**：`{ error, code, requestId, details? }` + `x-request-id` + 结构化 JSON 日志 + 分桶限流。
- **存储安全**：上传魔数校验（PNG/JPEG/WebP/PDF/MP4，拒绝 SVG）、单文件/批量/用户配额、私有资产流式读取、清理脚本。
- **AI 引擎配置（管理员）**：`/admin/ai` 以表格管理任意 OpenAI 兼容 / 火山方舟供应商，可新增、编辑、停用、删除、一键设为生效、逐行连通性测试；预设覆盖 OpenAI / DeepSeek / Moonshot / 通义 / OpenRouter / 火山方舟，也可自定义；密钥 AES-256-GCM 加密落库、只展示掩码。
- **供应商健康与故障切换**：Worker 按任务渠道统计成功/失败/连续失败；同渠道连续 2 次失败自动切换到备用供应商并写审计，下一条重试即生效；Web 进程 60s 内同步。
- **任务运维与审批**：用户任务中心可重试失败/取消任务；`/admin/jobs` 可按状态/用户/审批状态检索、取消、重试、批准/驳回；管理员可为单个用户开启「任务需审批」，Worker 只领取已批准任务，均写审计。
- **用量预算与套餐**：按用户或套餐设置月度 AI 预算与并发上限（0=不限），`/costs` 展示进度；用尽后新任务返回 `429 COST_BUDGET_EXCEEDED`；管理员在 `/admin/plans` 管理套餐并绑定用户。
- **中英双语**：界面支持 `中文 / EN` 切换（cookie 持久化，服务端渲染同步 `<html lang>`）；已覆盖应用外壳/导航、登录注册、账户安全，以及管理端概览/任务/套餐、任务中心与成本页；其余管理页与工作流页面继续迁移。
- **管理端**：`/admin` 系统概览（用户/任务/队列/存储/Worker），`/admin/users` 账户与预算管理，`/admin/jobs` 任务管理，`/admin/audit` 审计日志检索。
- **数据治理**：`/account` 可导出本人数据（JSON 附件，不含密钥）与注销账号（密码确认、最后管理员守卫、级联清理）；管理端审计日志支持 CSV 导出。
- **机器访问**：个人 API Token（`Authorization: Bearer mcs_...`，仅存哈希、可吊销/过期、**只读/读写 scope**）；任务终态 Webhook（HMAC 签名、SSRF 防护、投递记录、**账户页可视化管理与失败重试（指数退避）**）；公开 OpenAPI 3.1 描述（`GET /api/openapi`）。
- **可扩展限流**：设置 `REDIS_URL` 后 API/登录限流跨副本共享（Lua 原子计数，Redis 故障自动回退进程内）。
- **对象存储**：`STORAGE_DRIVER=local|s3`，支持 AWS S3 / MinIO / 阿里云 OSS S3 兼容端点；S3 模式资产通过鉴权代理下载。
- **可运维**：`/api/health`、`/api/ready`、管理端健康/统计与告警、**`/api/metrics` Prometheus 指标**、**Slack/Webhook 告警外发（去重+恢复通知）**、Prisma migrations、Docker 多阶段构建、GitHub Actions CI（依赖审计 + Playwright E2E）。

业务工作流（13 个）：封面页、创作中心、资产库、产品档案、白底图多角度、手机图标准化、SKU 局部替换、风格迁移、Icon Design VI、产品视频、POP 物料、PDP 长图、多语言本地化；任务中心、成本记录、账户设置与用户管理为平台能力。

## 快速开始（本地开发）

要求 Node.js 24（`.nvmrc`）与 pnpm 11.15.1。

**一键启动（PostgreSQL + schema + demo 种子 + Web + Worker）：**

```bash
pnpm install --frozen-lockfile   # 首次
pnpm dev:all                     # Ctrl+C 同时停止 web/worker
```

访问 http://127.0.0.1:3000（`demo@midea.local` / `demo1234`）。

手动分步：

```bash
nvm use                       # 或 nvm install 24
corepack enable
pnpm install --frozen-lockfile

# 1) 启动 PostgreSQL（localhost:5433）
pnpm db:up

# 2) 配置环境变量
cp .env.example .env.local    # 至少填 DATABASE_URL 与 AUTH_SECRET（>=32 字符）

# 3) 建表 + 种子管理员（开发便捷；生产用 pnpm db:deploy）
pnpm db:push
pnpm db:seed

# 4) 两个终端分别启动
pnpm dev                      # http://127.0.0.1:3000
pnpm worker                   # 异步任务消费者
```

开发种子账号：`demo@midea.local` / `demo1234`（**仅非生产**允许该默认口令）。生产 seed 必须显式提供 `SEED_ADMIN_EMAIL` + 强 `SEED_ADMIN_PASSWORD`，否则脚本拒绝执行。

首次访问 `http://127.0.0.1:3000/` 为公开封面页；登录后进入 `/studio-home`。未登录访问受保护页面会重定向 `/login?callbackUrl=...`。

## 目录结构

```
app/                  页面与 API 路由（App Router）
  api/                REST 接口（health/ready/admin/jobs/assets/auth/各工作流）
  admin/users         用户管理页（仅管理员）
  login|register|jobs|account 平台页面（认证页统一玻璃视觉）
src/
  platform/           平台层：config/errors/logger/http/api(handleApi)/rate-limit/audit/auth/jobs/worker-heartbeat/workspace/user-*
    storage/          魔数校验、配额、清理、下载头
    client/           浏览器端任务客户端
  components/         业务 UI 组件（每个组件配 *.test.tsx）
  domain/             纯领域逻辑（模板、排版、提示词、工作流状态机）
  services/           Provider 适配、图像处理、成本账本、资产与产品仓储
  lib/                前端通用工具（api-client 等）
prisma/               schema、migrations、seed
scripts/              worker.ts、cleanup.ts
docs/
  sdd/                SDD 宪法/规格/设计/计划/任务（本次改造依据）
  runbook.md          部署/回滚/排障/限流/配额/备份运维手册
```

## 常用命令

```bash
pnpm dev            # 开发服务器
pnpm build          # prisma generate + next build（standalone）
pnpm start          # 生产启动
pnpm worker         # 任务 Worker
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run（全量单测/组件测试）
pnpm test:watch     # 监听模式
pnpm db:deploy      # 生产迁移（prisma migrate deploy）
pnpm db:seed        # 幂等种子（管理员）
pnpm cleanup -- --dry-run   # 存储清理预览
```

## 配置

完整变量表见 [`.env.example`](.env.example) 与 `docs/runbook.md` §2。核心项：

- `DATABASE_URL`（必填）、`AUTH_SECRET`（必填，≥32 字符）
- 任务：`JOB_CONCURRENCY`、`MAX_USER_ACTIVE_JOBS`、`JOB_LOCK_MS`、`JOB_MAX_ATTEMPTS`
- 上传：`MAX_UPLOAD_BYTES`、`MAX_FILES_PER_REQUEST`、`USER_STORAGE_QUOTA_BYTES`
- 限流：`RATE_LIMIT_LIMIT`、`RATE_LIMIT_WINDOW_MS`、`LOGIN_MAX_ATTEMPTS`；`REDIS_URL`（可选，多副本共享限流，未设置则进程内）
- 可观测性：`METRICS_TOKEN`（可选，Prometheus Bearer）、`ALERT_QUEUE_DEPTH`、`ALERT_FAILURE_RATE`、`ALERT_WEBHOOK_URL`、`ALERT_COOLDOWN_MS`
- 预算：`DEFAULT_MONTHLY_BUDGET_UNITS`（可选，每用户每月默认估算单位；未设置=不限；用户可单独覆盖）
- AI Provider：可在 `/admin/ai` 中配置（数据库优先），或使用 `.env` 的 `OPENAI_*` / `ARK_*`；`AI_CONFIG_SECRET`（可选）用于加密平台密钥，未设置时回退 `AUTH_SECRET`

生产启动时会校验关键配置（缺失/过短的 `AUTH_SECRET` 直接失败）。

依赖安全：生产依赖高危漏洞门禁为 `pnpm audit`（`--prod --audit-level=high`，CI 强制执行）；Next.js / undici / sharp / zod 已升级到修复版本，`pnpm-workspace.yaml` 中的 overrides 固定安全传递依赖。

## 项目状态与路线图

已完成：任务运维/审批、预算、供应商故障切换、2FA/会话、E2E+审计、Redis 限流、指标告警、API Token/Webhook/OpenAPI、数据导出/注销/审计 CSV；中英双语覆盖外壳/登录/账户。

已完成：组织多租户、对象存储、模板市场、企业 SSO、CSP nonce 安全加固与告警。支付/订阅账单按产品要求不做，仅保留套餐配额。详见 [最终交接说明](docs/sdd/backlog/2026-10-27-final-handoff.md)。

## 质量门禁

```bash
pnpm typecheck                 # tsc --noEmit
pnpm test                      # Vitest（单元/组件/接口）
pnpm audit                     # 生产依赖 high+ 漏洞门禁
pnpm build                     # next build（需先 prisma generate）
pnpm e2e                       # Playwright 冒烟（自动启动 next start，需已 build + 已 seed）
```

E2E 覆盖：登录、工作台、管理端五个页面、任务中心/成本页、未登录访问管理页重定向。首次运行需 `pnpm exec playwright install chromium`。

## API 约定

- 认证：`Authorization` 无需手动传递，使用 NextAuth 会话 Cookie；受保护接口未登录返回 401 `AUTH_REQUIRED`。
- 错误：

  ```json
  { "error": "人读消息", "code": "VALIDATION_ERROR", "requestId": "req_xxx", "details": { "issues": [] } }
  ```

  `code` 取值：`AUTH_REQUIRED / FORBIDDEN / NOT_FOUND / VALIDATION_ERROR / RATE_LIMITED / JOB_QUOTA_EXCEEDED / JOB_NOT_CANCELLABLE / JOB_NOT_RETRYABLE / COST_BUDGET_EXCEEDED / PAYLOAD_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE / EMAIL_TAKEN / STORAGE_QUOTA_EXCEEDED / LAST_ADMIN / CANNOT_MODIFY_SELF / CONFLICT / INTERNAL_ERROR`。
- 响应头 `x-request-id` 可用于日志检索；限流响应带 `Retry-After`。
- 任务：`POST /api/jobs`（可带 `idempotencyKey`）→ `202`；`GET /api/jobs`（分页/状态过滤）；`GET /api/jobs/{id}`；`POST /api/jobs/{id}/cancel`；`POST /api/jobs/{id}/retry`。
- 管理任务：`GET /api/admin/jobs`；`POST /api/admin/jobs/{id}/retry|cancel|approve|reject`。
- 管理端：`GET/POST /api/admin/ai/providers`、`PATCH/DELETE /api/admin/ai/providers/{id}`、`POST /api/admin/ai/providers/{id}/test|default`、`GET /api/admin/audit`。
- 可观测性：`GET /api/metrics`（Prometheus；`METRICS_TOKEN` Bearer 或管理员会话）、`GET /api/admin/health`（含 `alerts`）。
- 机器访问：`GET/POST /api/account/api-tokens`、`DELETE /api/account/api-tokens/{id}`；`GET/POST /api/account/webhooks`、`DELETE /api/account/webhooks/{id}`；`GET /api/openapi`。Bearer Token 与 Webhook 签名规则见 `docs/runbook.md`。
- 数据治理：`GET /api/account/export`（本人 JSON 导出）、`DELETE /api/account`（密码确认注销）、`GET /api/admin/audit/export`（审计 CSV）。
- 套餐：`GET/POST /api/admin/plans`、`PATCH/DELETE /api/admin/plans/{id}`；`PATCH /api/admin/users/{id}` 绑定 `planId`。

## 部署

**一键 Docker 生产式部署（推荐）：**

```bash
pnpm deploy:docker
```

脚本会自动：
1. 首次运行生成 `.env.docker`（AUTH_SECRET、管理员邮箱与随机强密码，权限 600）；
2. 构建并启动 `postgres / migrate / web / worker`；
3. 执行 `prisma migrate deploy` 与幂等管理员 seed；
4. 等待 `/api/health`、`/api/ready` 并打印访问地址与管理员账号。

常用参数：`WEB_PORT=8080 POSTGRES_PORT=15433 pnpm deploy:docker`；已有数据可 `SKIP_SEED=1 pnpm deploy:docker`；查看日志 `docker compose --env-file .env.docker logs -f web worker`。

手动 compose：

```bash
export AUTH_SECRET="$(openssl rand -base64 32)"
export SEED_ADMIN_EMAIL=admin@example.com
export SEED_ADMIN_PASSWORD='<12+位含字母数字>'
docker compose up -d --build
docker compose --profile seed run --rm seed
curl -fsS http://127.0.0.1:3000/api/health
```

compose 包含 `postgres` / `migrate`（一次性迁移）/ `web` / `worker` / `seed`（profile），存储卷 `studio-storage` 挂载 `/data`。生产环境请用 HTTPS 反向代理并透传 `x-forwarded-proto` 与 Host。

## 文档

- SDD 规格（宪法/需求/设计/计划/任务）：`docs/sdd/`
- 运维手册（部署、回滚、排障、限流、配额、备份）：`docs/runbook.md`
- 现场演示脚本（历史）：`docs/demo-runbook.md`、`docs/superpowers/`

## 项目状态与路线图

已完成：任务运维/审批、预算、供应商故障切换、2FA/会话、E2E+审计、Redis 限流、指标告警、API Token/Webhook/OpenAPI、数据导出/注销/审计 CSV；中英双语覆盖外壳/登录/账户。

已完成：组织多租户、对象存储、模板市场、企业 SSO、CSP nonce 安全加固与告警。支付/订阅账单按产品要求不做，仅保留套餐配额。详见 [最终交接说明](docs/sdd/backlog/2026-10-27-final-handoff.md)。

## 质量门禁

提交前必须全绿（与 CI 一致）：

```bash
pnpm typecheck && pnpm test && pnpm build
```

CI：`.github/workflows/ci.yml`（Postgres service → prisma generate/migrate deploy → typecheck → test → build）。

## 平台已知边界（P1 规划）

- 限流为单实例内存实现；多副本部署需替换为 Redis（接口已抽象）。
- 存储为本地卷；对象存储/S3 直传尚未接入。
- 管理端目前以 API 形式提供（用户/任务/统计/健康），未做独立管理 UI。
- 产品身份一致性由提示词约束，非几何级保证；实际生成质量需以样例验收。
