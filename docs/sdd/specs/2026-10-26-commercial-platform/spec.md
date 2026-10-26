# 规格：商业级多用户平台（Commercial Platform v1）

- 规格 ID：`SPEC-2026-10-26-COMMERCIAL-PLATFORM`
- 状态：Approved（由 Lead 依据用户需求"商业级别、可多人使用"推导）
- 前置：`docs/sdd/constitution.md`
- 现有基线：13 个 AI 内容工作流已可用；多用户化平台层（NextAuth + Prisma + 任务队列）处于 WIP，已合并 `origin/main` 的封面页/白底图/本地化重构。

## 0. 目标与非目标

### 目标（本规格范围）

1. 从"单机演示"升级为**可多人注册、并发使用、故障可恢复**的平台。
2. 建立**统一 API 契约、限流、错误可诊断、审计可追溯**的服务端基线。
3. 建立**可部署、可观测、可运维**的工程基线（CI、容器、健康检查、运维手册）。
4. 不破坏现有 13 个工作流的业务行为与 UI。

### 非目标（本版明确不做）

- 不做模型训练/风格学习（brief 中未定义）。
- 不做对象存储厂商迁移（保留存储抽象接口，P1 再接入 S3/OSS）。
- 不做多组织/团队（`orgId`）与计费订阅；仅按用户隔离。规模化前提见 `design.md` §9。
- 不做 UI 视觉重设计；仅补充注册、任务中心、管理入口。

---

## 1. 需求清单与验收标准

标记：**[P0]** 本版必须交付；**[P1]** 有余量再做，接口预留。

### R1 账号与认证

**R1.1 [P0] 注册**
- 用户故事：作为新用户，我能用邮箱+密码注册，并获得默认可用的工作区设置。
- 验收：
  - AC1 邮箱非法/密码 <8 位/密码不含字母或数字 → 400，返回 `{ error, code: "VALIDATION_ERROR" }`。
  - AC2 邮箱已存在 → 409，`code: "EMAIL_TAKEN"`；并发注册由数据库唯一约束兜底，不得 500。
  - AC3 邮箱统一小写去空格；密码 bcrypt cost ≥ 12（可配 `BCRYPT_COST`）。
  - AC4 注册成功后自动建 `UserSettings`（默认 Mexico/Spanish）并记录审计日志。
  - AC5 注册接口限流：每 IP 10 次/小时 → 429 + `Retry-After`。

**R1.2 [P0] 登录与会话**
- 验收：
  - AC1 成功登录写入审计日志（action=`auth.login`）。
  - AC2 登录失败限流：同 IP+邮箱 5 次/15 分钟 → 429（返回可读提示，不区分"用户不存在/密码错"）。
  - AC3 会话 `maxAge` 7 天、`updateAge` 1 天；JWT 内含 `sub` 与 `role`。
  - AC4 未登录访问受保护 API → 401 `code: "AUTH_REQUIRED"`；受保护页面重定向 `/login?callbackUrl=...`。
  - AC5 受保护 API 均需 `requireUserId`，不依赖仅有 middleware。

**R1.3 [P0] 启动期密钥校验**
- 验收：`AUTH_SECRET` 缺失或 <32 字符时，生产启动失败并输出明确错误；开发环境给出告警但允许运行。

### R2 权限模型与审计

**R2.1 [P0] 角色**
- 角色枚举：`user` / `admin`（`User.role`，默认 `user`）。
- 验收：`requireRole("admin")` 非管理员返回 403 `code: "FORBIDDEN"`。

**R2.2 [P0] 管理端 API**
- 验收：
  - `GET /api/admin/users?q=&limit=&cursor=`：仅 admin；返回用户列表（不含 `passwordHash`）。
  - `GET /api/admin/jobs?status=&userId=&limit=&cursor=`：仅 admin；分页返回全平台任务。
  - `GET /api/admin/stats`：仅 admin；返回用户数、任务状态分布、最近 24h 失败数、队列积压、存储用量 TopN。
  - 非 admin 访问以上任意接口 → 403，且不泄露数据。

**R2.3 [P0] 越权隔离**
- 验收：A 用户访问 B 用户的 asset/product/job/cost/settings → 404；所有 Prisma 查询含 `userId` 过滤。

**R2.4 [P0] 审计日志**
- 验收：
  - 表 `AuditLog(id, userId?, actorRole?, action, targetType?, targetId?, metadata?, ip?, requestId?, createdAt)`。
  - 至少覆盖：`auth.register`、`auth.login`、`job.enqueue`、`job.cancel`、`admin.user.list`、`asset.delete`。
  - 写审计失败不得影响主业务（fire-and-forget，记录错误日志）。

### R3 API 契约与健壮性

**R3.1 [P0] 统一错误契约（向后兼容）**
- 验收：错误响应形如
  ```json
  { "error": "人读消息", "code": "MACHINE_CODE", "requestId": "req_...", "details": {} }
  ```
  - 保留 `error: string`，现有前端 `payload.error` 逻辑不回归。
  - 生产环境 500 不得返回堆栈/内部路径。

**R3.2 [P0] 请求可追踪**
- 验收：每个 API 响应含 `x-request-id`（优先透传入参）；服务端输出单行 JSON 日志：`{ ts, level, requestId, method, path, status, durationMs, userId?, code? }`。

**R3.3 [P0] 输入校验**
- 验收：所有写接口（POST/PUT/PATCH/DELETE 带体）使用 zod 校验；非法输入 400 + `details.issues`；禁止把原始 body 直接落库。

**R3.4 [P0] 限流**
- 验收：
  - 实现 `RateLimiter` 接口 + 内存滑动窗口实现（单实例）；键：`user:<id>` 或 `ip:<addr>`。
  - 昂贵生成接口（`/api/jobs`、各生成路由、upload）默认 30 次/分钟/用户；登录/注册见 R1。
  - 超限 429 + `Retry-After`，并记录 `rate_limit.exceeded` 指标日志。
  - 多实例部署时需替换为 Redis 实现（P1），文档标注。

**R3.5 [P0] 统一路由包装**
- 验收：新增 `handleApi()`，职责：requestId、日志、认证、限流、错误映射；新路由必须使用；旧路由渐进迁移且行为不变。

### R4 任务系统可靠性

**R4.1 [P0] 幂等提交**
- 验收：`POST /api/jobs` 支持 `idempotencyKey`；同用户同 key 24h 内重复提交返回同一任务（200 而非新建），并发重复不得产生两条（唯一约束兜底）。

**R4.2 [P0] 重试与退避**
- 验收：失败任务按指数退避重新入队（base 5s，max 5min，含抖动）；`attempts >= maxAttempts` 进入 `failed`；字段 `nextAttemptAt` 控制可领取时间。

**R4.3 [P0] 僵死回收**
- 验收：worker 每轮领取前回收 `status=running && lockedAt < now - JOB_LOCK_MS` 的任务为 `queued`（attempts 不重复自增），并记录告警日志。

**R4.4 [P0] 取消**
- 验收：`POST /api/jobs/[id]/cancel`：
  - `queued` → 直接 `cancelled`；
  - `running` → 置 `cancelledAt`，worker 在检查点发现后丢弃结果并置 `cancelled`；
  - 已结束任务 → 409 `code: "JOB_NOT_CANCELLABLE"`；非本人任务 → 404。

**R4.5 [P0] Worker 心跳与优雅退出**
- 验收：
  - 表 `WorkerHeartbeat(workerId, lastSeenAt, concurrency, activeJobs, startedAt)`，每 10s upsert。
  - `GET /api/ready` 检查 DB 连通 + 60s 内存在心跳；不满足返回 503。
  - SIGTERM/SIGINT：停止领新任务，等待在途任务（上限 30s），`prisma.$disconnect()` 后退出。

**R4.6 [P0] 任务查询**
- 验收：`GET /api/jobs?status=&limit=&cursor=` 支持状态过滤与游标分页（默认 20，最大 100）；返回 `nextCursor`。

**R4.7 [P1] 进度节流**
- 验收：进度写入仅在变化 ≥5 或状态变更时落库。

### R5 存储与上传安全

**R5.1 [P0] 魔数校验**
- 验收：上传内容与声明类型不符 → 415 `code: "UNSUPPORTED_MEDIA_TYPE"`；支持 PNG/JPEG/WebP/PDF/MP4；SVG 一律拒绝。

**R5.2 [P0] 配额与上限**
- 验收：
  - 单文件 ≤ `MAX_UPLOAD_BYTES`（默认 30 MB），超限 413。
  - 单请求文件数 ≤ `MAX_FILES_PER_REQUEST`（默认 10）。
  - 每用户存储配额 `USER_STORAGE_QUOTA_BYTES`（默认 2 GB），超限 413 `code: "STORAGE_QUOTA_EXCEEDED"`。
  - `Asset` 增加 `sizeBytes Int`，配额按 DB 聚合计算。

**R5.3 [P0] 私有资产访问**
- 验收：`GET /api/assets/[id]/file` 校验归属后流式返回，设置 `Cache-Control: private`、`Content-Disposition`、`nosniff`；跨用户 404。
- 兼容：保留既有静态 URL 访问（P1 收敛）。

**R5.4 [P1] 清理脚本**
- 验收：`pnpm cleanup` 清理无 DB 记录的孤儿文件与超期（默认 30 天）生成文件；支持 `--dry-run`。

### R6 可观测性与运维

**R6.1 [P0] 健康检查**
- 验收：`GET /api/health` 无需鉴权，返回 `{ status:"ok", uptimeSec, version }`；`GET /api/ready` 检查 DB 与 worker 心跳。

**R6.2 [P0] 安全管理端**
- 验收：`GET /api/admin/health` 仅 admin，返回队列积压、失败率、worker 心跳、存储用量、限流命中数。

**R6.3 [P0] 安全响应头**
- 验收：全站返回 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy`；生产环境 `Strict-Transport-Security`；关闭 `X-Powered-By`。

**R6.4 [P0] 环境变量校验**
- 验收：`src/platform/config.ts` 使用 zod 聚合校验；缺失关键项在生产启动即失败；`.env.example` 与文档同步。

**R6.5 [P0] 容器化**
- 验收：多阶段 `Dockerfile`（deps→build→runner，standalone 输出）；`docker-compose.yml` 编排 `postgres` + `web` + `worker`，含 healthcheck 与依赖顺序。

**R6.6 [P0] CI**
- 验收：`.github/workflows/ci.yml`：Node 24 + pnpm + Postgres service；执行 `prisma migrate deploy`（或 `db push`）→ `typecheck` → `test` → `build`；失败阻断合并。

### R7 数据层

**R7.1 [P0] 迁移**
- 验收：`prisma/migrations/` 存在可 `migrate deploy` 的初始迁移；新增表/字段有对应迁移；`seed` 幂等。

**R7.2 [P0] 模型扩展**
- `GenerationJob`：`idempotencyKey?`、`nextAttemptAt?`、`cancelledAt?`、`@@unique([userId, idempotencyKey])`、`@@index([status, nextAttemptAt])`、`@@index([status, lockedAt])`。
- `Asset`：`sizeBytes Int @default(0)`。
- 新表：`AuditLog`、`WorkerHeartbeat`。

**R7.3 [P0] Seed 安全**
- 验收：默认演示密码仅开发环境允许；生产未配置 `SEED_ADMIN_PASSWORD` 时拒绝创建 admin 并给出说明。

### R8 前端平台化

**R8.1 [P0] 注册页**：`/register` 表单（邮箱/密码/确认）、错误与 loading 态、密码规则提示、登录互跳。
**R8.2 [P0] 任务中心**：`/jobs` 列表（类型/状态/进度/时间）、取消操作、自动刷新、空态与错误态；导航新增"任务中心"。
**R8.3 [P0] 角色展示**：AppShell 显示当前用户邮箱与角色；admin 才显示"管理"入口。
**R8.4 [P0] API 客户端**：前端统一解析 `{ error, code, requestId }`，错误文案含 requestId 便于报障。

### R9 质量

**R9.1 [P0]** 修复基线 4 个失败测试（`app/page.test.tsx`、`src/domain/icon-design.test.ts`、`src/domain/pdp-export.test.ts`、`src/services/demo-api.test.ts`），全量测试全绿。
**R9.2 [P0]** 新增模块（限流、错误映射、幂等、退避、魔数、配额、审计、取消、健康）均有单元测试；关键 API 有集成/边界测试。
**R9.3 [P0]** `typecheck` + `build` 全绿。
**R9.4 [P0]** `README.md` 重写为真实运行手册；新增 `docs/runbook.md`（部署/回滚/排障/限流/任务卡死处理）。

### R10 兼容

**R10.1 [P0]** 现有 13 个工作流及全部既有测试通过。
**R10.2 [P0]** 既有 API 路径、请求/响应字段保持向后兼容（只增不改）。

---

## 2. 验收场景（端到端）

1. 新用户注册 → 登录 → 上传产品图 → 创建任务 → 任务中心看到排队/完成 → 取消一个排队任务 → 成本记录出现 → 登出。
2. 用户 A 用 B 的 assetId 调用 `/api/assets/[id]/file` → 404。
3. 连续提交超限任务 → 429 + `Retry-After`；等待后恢复。
4. Kill worker（SIGKILL）后重启 → 卡在 running 的任务在 lease 超时后被回收并重跑成功。
5. 非 admin 调 `/api/admin/users` → 403；admin 可正常获取且无密码字段。
6. 上传伪装 PNG 的 HTML 文件 → 415；上传 31MB 文件 → 413。
7. `docker compose up` 后 `/api/ready` 返回 200；停掉 worker 60s 后返回 503。

## 3. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 单实例内存限流在多副本下失效 | 限流可被绕过 | 文档标注；P1 接 Redis；接口已抽象 |
| 本地文件存储在容器重启后丢失 | 素材丢失 | compose 挂载 volume；P1 对象存储 |
| NextAuth beta 版本 API 变动 | 认证不可用 | 锁定版本；集中封装在 `src/platform/auth*` |
| 既有 4 个失败测试涉及产品语义 | 修复可能改变 UI 文案 | 以代码意图为准修测试，改代码必须说明 |
| 大范围改动引入回归 | 工作流不可用 | 小步提交 + 全量测试 + 保留 API 兼容 |
