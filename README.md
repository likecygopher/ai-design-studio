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

## 快速开始（本地开发，约 5 分钟）

### 0. 前置条件

| 工具 | 版本 / 说明 | 检查命令 |
|---|---|---|
| Node.js | **24.x**（见 `.nvmrc`） | `node -v` |
| pnpm | **11.15.1**（`packageManager`） | `pnpm -v` |
| Docker | Docker Desktop 或 Docker Engine，含 Compose v2 | `docker compose version` |
| Git | 任意近期版本 | `git --version` |

推荐用 nvm 安装 Node：

```bash
nvm install 24
nvm use 24
corepack enable
```

### 1. 获取代码

```bash
git clone -b cloud git@github.com:likecygopher/ai-design-studio.git
cd ai-design-studio
pnpm install --frozen-lockfile
```

> 如果代码已合并到 `main`，去掉 `-b cloud` 即可。Windows 建议在 WSL2 中执行以下命令。

### 2. 启动 PostgreSQL（Docker）

项目自带 `docker-compose.yml`，**开发环境只需要数据库**：

```bash
pnpm db:up          # 等价于 docker compose up -d postgres
```

它会启动：

| 项 | 值 |
|---|---|
| 容器 | `midea-ai-postgres` |
| 镜像 | `postgres:16-alpine` |
| 地址 | `127.0.0.1:5433` |
| 用户 / 密码 | `midea` / `midea` |
| 数据库 | `midea_ai_studio` |
| 数据卷 | `midea_pg_data`（删除容器不丢数据） |

确认就绪：

```bash
docker compose ps postgres
docker exec midea-ai-postgres pg_isready -U midea -d midea_ai_studio
# 输出 ... accepting connections 即成功
```

**不用 compose 的等价写法**（二选一，不要和上面的 `pnpm db:up` 同时启动，容器名/端口会冲突）：

```bash
docker volume create midea_pg_data
docker run -d --name midea-ai-postgres \
  -e POSTGRES_USER=midea \
  -e POSTGRES_PASSWORD=midea \
  -e POSTGRES_DB=midea_ai_studio \
  -p 5433:5432 \
  -v midea_pg_data:/var/lib/postgresql/data \
  --restart unless-stopped \
  postgres:16-alpine
```

停止数据库但保留数据：

```bash
docker compose stop postgres
```

彻底删除开发数据库（**会清空数据**）：

```bash
docker compose down -v
```

### 3. 配置环境变量

```bash
cp .env.example .env.local
```

生成并写入会话密钥（至少 32 字符）：

```bash
openssl rand -base64 32
# 把输出替换 .env.local 中的 AUTH_SECRET=...
```

> Prisma CLI 只读取 `.env`，而 Next.js 读取 `.env.local`。macOS/Linux 建议创建软链接，让两处共用同一份配置：
>
> ```bash
> ln -sf .env.local .env
> ```
>
> Windows 没有软链接时执行 `Copy-Item .env.local .env` 即可；两份文件中的 `DATABASE_URL` 必须一致。

`.env.local` 最少需要：

```dotenv
DATABASE_URL=postgresql://midea:midea@127.0.0.1:5433/midea_ai_studio?schema=public
AUTH_SECRET=<openssl rand -base64 32 的输出>
AUTH_TRUST_HOST=true
```

其余变量按需修改，完整说明见 [`.env.example`](.env.example) 和 [`docs/runbook.md`](docs/runbook.md) §2。AI Key 不是启动必需项。

### 4. 初始化数据库

```bash
pnpm db:push     # 开发环境：按 schema 建表/同步
pnpm db:seed     # 创建演示管理员（可重复执行）
```

生产环境不要用 `db:push`，改用迁移：

```bash
pnpm db:deploy
```

### 5. 启动 Web + Worker

**方式 A：一条命令（推荐）**

```bash
pnpm dev:all
```

自动完成：启动 PostgreSQL → 等待就绪 → `db:push` → 首次 seed → 同时启动 Next.js 与 Worker。`Ctrl+C` 会同时停止 Web/Worker，但不会删除数据库。

**方式 B：两个终端手动启动**

```bash
# 终端 1：Web
pnpm dev

# 终端 2：Worker（Worker 不会自己读 .env.local，需要先注入）
set -a
source .env.local
set +a
pnpm worker
```

> 只启动 Web 也能登录和浏览，但创建生成任务后会一直排队；必须启动 Worker 才会执行。
> Windows PowerShell 建议直接用 `pnpm dev:all`。

### 6. 访问与验证

| 地址 | 说明 |
|---|---|
| http://127.0.0.1:3000 | 公开封面页 |
| http://127.0.0.1:3000/login | 登录 |
| http://127.0.0.1:3000/studio-home | 登录后的工作台 |
| http://127.0.0.1:3000/admin | 管理端（管理员账号） |
| http://127.0.0.1:3000/api/health | 健康检查 |
| http://127.0.0.1:3000/api/ready | 就绪检查（含 Worker/DB） |

本地种子账号（仅非生产环境允许）：

```text
demo@midea.local / demo1234
```

命令行验证：

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/ready
```

### 7. 配置 AI 生成能力（可选）

不配置也能启动、登录、管理；只是实际生成会失败。二选一：

1. 登录管理员 → `/admin/ai`，表格中新增 OpenAI 兼容 / 火山方舟供应商并「设为生效」；
2. 在 `.env.local` 填 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_IMAGE_MODEL`，或 `ARK_API_KEY`，重启 Web + Worker。

密钥会 AES-256-GCM 加密落库，界面只显示掩码。

### 常见问题

| 现象 | 处理 |
|---|---|
| `Cannot connect to the Docker daemon` | 启动 Docker Desktop / `sudo systemctl start docker` |
| `Port 5433 is already allocated` | 本机已有 PostgreSQL；停掉冲突容器，或改 `docker-compose.yml` 映射端口并同步 `DATABASE_URL` |
| `P1001: Can't reach database server` | `docker compose ps postgres`；确认 `.env`/`.env.local` 的 `DATABASE_URL` 是 `127.0.0.1:5433` |
| `Environment variable not found: DATABASE_URL` | Prisma 没读到 `.env`；执行 `ln -sf .env.local .env`（Windows 复制文件） |
| 登录报配置错误 | `AUTH_SECRET` 必须 ≥32 字符，并设置 `AUTH_TRUST_HOST=true` |
| 任务一直「排队中」 | Worker 未启动；另一个终端执行 `pnpm worker`，或直接用 `pnpm dev:all` |
| 修改 schema 后类型报错 | `pnpm prisma generate`，再重启 TypeScript/Next |
| 想重置演示数据 | `docker compose down -v && pnpm db:up && pnpm db:push && pnpm db:seed`（会删库） |
| 端口 3000 被占用 | `lsof -i :3000` 后停止旧进程，或 `PORT=3001 pnpm dev` |

## 目录结构

```text
app/                  页面与 API 路由（App Router）
  api/                REST 接口（health/ready/admin/jobs/assets/auth/各工作流）
  admin/              管理端页面：概览/用户/任务/套餐/AI/市场/审计
  account/            账户设置、组织与 SSO 配置
  login|register/     认证页
src/
  platform/           平台层：config/errors/logger/http/api/rate-limit/audit/auth/jobs/...
    storage/          魔数校验、配额、清理、下载头
    client/           浏览器端任务客户端
  components/         业务 UI 组件（每个组件配 *.test.tsx）
  domain/             纯领域逻辑（模板、排版、提示词、工作流状态机）
  services/           Provider 适配、图像处理、成本账本、资产与产品仓储
  i18n/               中英文案与格式化
prisma/               schema、migrations、seed
scripts/              worker.ts、cleanup.ts、dev-all.sh、deploy-docker.sh
e2e/                  Playwright 冒烟测试
docs/
  sdd/                SDD 宪法/规格/设计/计划/任务
  runbook.md          部署/回滚/排障/限流/配额/备份运维手册
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

## Docker 生产式部署（一键）

适合把整套平台跑在一台服务器/本机上：PostgreSQL、迁移、Web、Worker 全部容器化，数据落在 Docker volume。

**要求**：Docker Desktop / Docker Engine + Compose v2；从源码构建需要本机有 Node 24 与 pnpm（仅用于执行脚本和构建镜像）。

```bash
# 首次会生成 .env.docker（含随机 AUTH_SECRET、管理员账号密码，权限 600）
pnpm deploy:docker
```

脚本会依次完成：

1. 生成或复用 `.env.docker`；
2. `docker compose up -d --build` 构建并启动 `postgres / migrate / web / worker`；
3. `prisma migrate deploy` 应用数据库迁移；
4. 通过一次性 `seed` 服务创建管理员；
5. 等待 `/api/health` 与 `/api/ready`，打印访问地址和管理员账号。

默认地址：

| 服务 | 地址 / 说明 |
|---|---|
| Web | `http://localhost:3000` |
| PostgreSQL | `localhost:5433`（容器内 `postgres:5432`） |
| 数据卷 | `midea_pg_data`（数据库）、`studio-storage`（上传/生成产物） |

常用参数：

```bash
# 改端口 / 指定管理员
WEB_PORT=8080 POSTGRES_PORT=15433 \
ADMIN_EMAIL=owner@acme.com ADMIN_PASSWORD='StrongPass1234' \
pnpm deploy:docker

# 已有数据，跳过 seed（不会重置管理员密码）
SKIP_SEED=1 pnpm deploy:docker

# 只生成 .env.docker 并校验 compose，不构建/启动
DEPLOY_DRY_RUN=1 pnpm deploy:docker
```

日常运维：

```bash
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f web worker
docker compose --env-file .env.docker restart web worker
docker compose --env-file .env.docker down          # 停止，保留数据
docker compose --env-file .env.docker down -v       # 停止并删除数据卷（危险）
```

手动 compose（不使用脚本）：

```bash
export AUTH_SECRET="$(openssl rand -base64 32)"
export SEED_ADMIN_EMAIL=admin@example.com
export SEED_ADMIN_PASSWORD='<至少 12 位，含字母和数字>'

docker compose up -d --build
docker compose --profile seed run --rm seed
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/ready
```

生产注意事项：

- 用 Nginx / Caddy / 云负载均衡终止 HTTPS，并透传 `Host` 与 `x-forwarded-proto`；
- 设置 `APP_URL=https://你的域名`，`AUTH_TRUST_HOST=true`；
- 不要把 `5433` 暴露到公网；
- 定期备份 `midea_pg_data` 与 `studio-storage`，并定期执行 `pnpm cleanup`；
- 多副本部署需要 `REDIS_URL` + `STORAGE_DRIVER=s3`（见 `docs/runbook.md`）；
- 回滚/迁移/排障流程见 [`docs/runbook.md`](docs/runbook.md)。

## 文档

- SDD 规格（宪法/需求/设计/计划/任务）：`docs/sdd/`
- 运维手册（部署、回滚、排障、限流、配额、备份）：`docs/runbook.md`
- 现场演示脚本（历史）：`docs/demo-runbook.md`、`docs/superpowers/`

## 已知边界与运维注意

- **无支付/订阅账单**：按产品要求不做支付网关，只保留套餐与配额。
- **无邮件通道**：不发送邀请/密码找回邮件；管理员可在 `/admin/users` 重置密码并一次性展示临时密码。
- **企业 SSO 假定 IdP 已完成 MFA**：通过 SSO 登录会跳过本地 TOTP；本地账号仍支持 TOTP。
- **默认本地存储**：单机部署使用 `STORAGE_ROOT`；多副本/生产建议 `STORAGE_DRIVER=s3`，否则各副本看不到彼此文件。
- **多副本限流需 Redis**：未设置 `REDIS_URL` 时使用进程内限流，副本间不共享。
- **AI 生成质量**：产品身份一致性由提示词约束，非几何级保证；建议用真实商品样例验收。
- **任务执行依赖 Worker**：Web 只负责入队；Worker 停止时任务会保持排队/运行中状态，恢复后继续消费。
