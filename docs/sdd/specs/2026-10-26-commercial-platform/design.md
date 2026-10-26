# 技术设计：商业级多用户平台（Commercial Platform v1）

- 对应规格：`docs/sdd/specs/2026-10-26-commercial-platform/spec.md`
- 约束：`docs/sdd/constitution.md`
- 技术栈：Next.js 15 App Router（Node 24）+ React 19 + Prisma 6 + PostgreSQL 16 + NextAuth v5 (beta) + Vitest 2 + pnpm

## 1. 总体架构

```
┌─────────────┐   HTTP    ┌──────────────────────────────┐
│  Browser    │──────────▶│ Next.js (web)                │
│ (React 19)  │           │  ├─ middleware.ts  (会话门禁) │
└─────────────┘           │  ├─ app/api/**     (REST)     │
                          │  │    └─ handleApi 包装器     │
                          │  └─ app/**         (RSC 页面) │
                          └───────┬──────────────────────┘
                                  │ Prisma
                          ┌───────▼──────┐     ┌────────────────┐
                          │ PostgreSQL   │◀────│ Worker 进程     │
                          │ (jobs/audit) │     │ (scripts/worker)│
                          └───────┬──────┘     └───────┬────────┘
                                  │                    │
                          ┌───────▼────────────────────▼───────┐
                          │ 本地存储 STORAGE_ROOT（compose 挂载卷）│
                          │ /public/uploads/<userId>/...        │
                          │ /public/generated/<userId>/...      │
                          └────────────────────────────────────┘
```

- **Web 与 Worker 分离**：Web 只入队，Worker 执行 AI 调用。避免 HTTP 请求阻塞与进程重启丢失任务。
- **进程内限流**：默认内存滑动窗口；接口抽象为 `RateLimiter`，P1 换 Redis。
- **审计**：业务表旁路写入 `AuditLog`，失败不阻塞主流程。

## 2. 模块地图（新增/变更）

```
src/platform/
  config.ts          [改] zod 环境变量聚合校验 + 派生配置
  errors.ts          [新] ApiError 体系（Auth/Forbidden/NotFound/Validation/RateLimit/Quota/PayloadTooLarge/UnsupportedMedia）
  logger.ts          [新] JSON 结构化日志 + 脱敏 + requestId
  http.ts            [改] toErrorResponse 统一契约
  api.ts             [新] handleApi(request, options, fn) 统一包装
  rate-limit.ts      [新] RateLimiter 接口 + MemoryRateLimiter
  audit.ts           [新] recordAudit()
  auth.ts            [改] requireRole / getSessionUser / bcrypt cost / secret 校验
  auth.config.ts     [改] session maxAge/updateAge
  prisma.ts / db.ts  [不变]
  worker-heartbeat.ts[新] upsertHeartbeat / isWorkerAlive
  storage/
    magic-bytes.ts   [新] 文件签名校验
    quota.ts         [新] 用户存储配额校验
  jobs.ts            [改] 幂等/退避/回收/取消/分页
  job-handlers.ts    [改] 取消检查点 + 进度节流
  user-asset-store.ts[改] sizeBytes、魔数、配额、私有读流
scripts/worker.ts    [改] 心跳、优雅退出、回收
scripts/cleanup.ts   [新] 孤儿/过期清理
app/api/
  health/ready       [新] 存活/就绪
  admin/users|jobs|stats|health [新] 管理端
  jobs/[id]/cancel   [新] 取消
  assets/[id]/file   [新] 私有流式读取
  auth/register      [改] 加固
  login/register UI  [新] 注册页
  jobs/page.tsx      [新] 任务中心
middleware.ts        [改] 路由策略集中化 + 公开路径白名单
next.config.mjs      [改] 安全响应头 + standalone 输出
.github/workflows/ci.yml [新]
Dockerfile / docker-compose.yml [新/改]
```

## 3. 错误契约

```ts
// src/platform/errors.ts
export type ErrorCode =
  | "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR"
  | "RATE_LIMITED" | "JOB_QUOTA_EXCEEDED" | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE" | "EMAIL_TAKEN" | "STORAGE_QUOTA_EXCEEDED"
  | "JOB_NOT_CANCELLABLE" | "CONFLICT" | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly expose = true
  ) { super(message); }
}
```

`toErrorResponse(error, requestId)` 映射：

| 来源 | status | code | 说明 |
|---|---|---|---|
| `AuthRequiredError` | 401 | AUTH_REQUIRED | 保留旧类以兼容 |
| `ApiError(403)` | 403 | FORBIDDEN | 角色不足 |
| `ApiError(404)` | 404 | NOT_FOUND | 跨用户/不存在 |
| `ZodError` | 400 | VALIDATION_ERROR | `details.issues` |
| `RateLimitError` | 429 | RATE_LIMITED | `Retry-After` |
| `JobQuotaError` | 429 | JOB_QUOTA_EXCEEDED | 并发任务上限 |
| `PayloadTooLargeError` | 413 | PAYLOAD_TOO_LARGE | 文件/体 |
| 其他 | 500 | INTERNAL_ERROR | 生产隐藏内部信息 |

响应体（兼容旧前端）：
```json
{ "error": "人读消息", "code": "VALIDATION_ERROR", "requestId": "req_x", "details": { "issues": [] } }
```

## 4. 路由包装器

```ts
type ApiOptions = {
  auth?: "user" | "admin" | "public";       // 默认 user
  rateLimit?: { name: string; limit: number; windowMs: number; key?: "user" | "ip" };
};
type ApiContext = {
  requestId: string;
  userId?: string;
  role?: string;
  ip: string;
  log: Logger;
  body<T>(schema: ZodSchema<T>): Promise<T>;   // 校验错误 → ValidationError
  form(): Promise<FormData>;
};
export async function handleApi(
  request: Request,
  options: ApiOptions,
  fn: (ctx: ApiContext) => Promise<Response>
): Promise<Response>;
```

行为顺序：requestId → 认证/角色 → 限流 → 执行 → 计时 → 日志 → 错误映射。`Retry-After`/`x-request-id` 自动附加。

## 5. 数据模型（Prisma 变更）

```prisma
model User {
  // 既有字段不变
  auditLogs AuditLog[]
}

model Asset {
  // 既有字段不变
  sizeBytes Int @default(0)
  @@index([userId, createdAt])
}

enum JobStatus { queued running succeeded failed cancelled }

model GenerationJob {
  // 既有字段不变
  idempotencyKey String?
  nextAttemptAt  DateTime?
  cancelledAt    DateTime?

  @@unique([userId, idempotencyKey])
  @@index([status, nextAttemptAt])
  @@index([status, lockedAt])
}

model AuditLog {
  id         String   @id @default(cuid())
  userId     String?
  actorRole  String?
  action     String
  targetType String?
  targetId   String?
  metadata   Json?
  ip         String?
  requestId  String?
  createdAt  DateTime @default(now())

  @@index([createdAt])
  @@index([userId, createdAt])
  @@index([action, createdAt])
}

model WorkerHeartbeat {
  id          String   @id          // workerId
  startedAt   DateTime @default(now())
  lastSeenAt  DateTime @updatedAt
  concurrency Int
  activeJobs  Int      @default(0)

  @@index([lastSeenAt])
}
```

迁移策略：`prisma migrate dev --name platform_v1` 生成初始迁移；生产 `prisma migrate deploy`。既有开发库可用 `migrate reset`（数据可丢）或 `migrate dev` 增量。

## 6. 任务队列语义

```
enqueue(userId,type,payload,idempotencyKey?)
  ├─ idempotencyKey 已存在 → 返回原任务（200）
  └─ activeCount >= maxUserActiveJobs → 429 JOB_QUOTA_EXCEEDED
     └─ create(status=queued, nextAttemptAt=now)

claim(workerId, limit)
  ├─ reclaimStaleJobs()   // running && lockedAt < now-lockMs → queued, attempts 不变
  └─ 循环 limit 次：
       SELECT ... WHERE status=queued AND (nextAttemptAt IS NULL OR nextAttemptAt<=now)
         ORDER BY priority DESC, createdAt ASC FOR UPDATE SKIP LOCKED
       per-user running < maxUserActiveJobs → UPDATE running/lease/attempts+1

complete(jobId,result) → succeeded
fail(jobId,msg)
  ├─ attempts < maxAttempts → queued, nextAttemptAt = now + backoff(attempts)
  └─ else → failed
cancel(jobId,userId)
  ├─ queued → cancelled
  ├─ running → cancelledAt=now（worker 检查点生效）
  └─ 终态 → 409
```

退避：`delay = min(300s, 5s * 2^(attempts-1)) + rand(0..1000ms)`。

worker 取消检查点：`executeJob` 每阶段前 `await assertNotCancelled(job.id)`，抛 `JobCancelledError` 后 `markCancelled`（不回队）。

进度节流：`updateJobProgress` 内存记录 lastWritten，差值 <5 且非强制则跳过；最终完成强制 100。

## 7. 存储与上传

```
POST /api/upload
  ├─ 认证 → 限流 → formData
  ├─ files.length <= MAX_FILES_PER_REQUEST
  ├─ 每文件: bytes.length <= MAX_UPLOAD_BYTES
  ├─ magic bytes 校验 vs 声明 MIME（PNG/JPEG/WebP/PDF/MP4；SVG 拒绝）
  ├─ 用户配额: sum(Asset.sizeBytes) + 本次 <= USER_STORAGE_QUOTA_BYTES
  └─ 落盘(STORAGE_ROOT 下 uuid 文件名) + DB(Asset.sizeBytes)

GET /api/assets/[id]/file
  ├─ 认证 → findFirst({id,userId})  → 404
  └─ readFile → Response(body, headers: Content-Type, Content-Length,
                          Content-Disposition, Cache-Control: private,
                          X-Content-Type-Options: nosniff)
```

魔数表：

| 类型 | 签名 |
|---|---|
| PNG | `89 50 4E 47 0D 0A 1A 0A` |
| JPEG | `FF D8 FF` |
| WebP | `RIFF????WEBP` |
| PDF | `25 50 44 46 2D` |
| MP4 | offset 4 `ftyp` |

## 8. 认证与限流

- 登录限流在 `authorize(credentials, request)` 内完成（可获取 IP）：键 `login:<ip>:<email>`，5 次/15min 失败窗口；成功后清零。
- API 限流在 `handleApi` 内完成：键 `user:<id>` 或 `ip:<addr>`，默认 30 次/60s。
- 限流器状态在单实例内存；compose/单副本部署可用；多副本需 Redis（P1，接口已抽象）。
- `AUTH_SECRET` 校验放在 `config.ts` 的 `assertRuntimeConfig()`，由 `instrumentation.ts` 在服务启动时调用（构建阶段跳过）。

## 9. 规模化与后续演进（P1+）

1. **限流 → Redis**：实现 `RedisRateLimiter`（INCR + EXPIRE 或 ZSET 滑动窗口），配置切换。
2. **存储 → 对象存储**：`AssetStorage` 接口（put/get/delete/signedUrl），本地实现与 S3/OSS 实现互换；上传走预签名，Web 不落盘。
3. **队列 → BullMQ/Redis 或 SQS**：替换 DB 轮询；保留 DB 作为状态视图。
4. **多组织**：User→OrgMember→Org，所有资源加 `orgId`，RBAC 扩展为 `org:admin|member|viewer`。
5. **可观测**：OpenTelemetry trace + Prometheus metrics（`/api/admin/metrics`）+ 日志采集。
6. **水平扩展**：Web 无状态（会话 JWT），Worker 多副本依赖 `FOR UPDATE SKIP LOCKED` 已安全。

## 10. 测试策略

- 单元：`rate-limit`、`errors/toErrorResponse`、`magic-bytes`、`quota`、`backoff`、`idempotency`、`audit`（mock prisma）。
- 路由：`handleApi` 的 401/403/400/429 路径；`/api/admin/*` 角色；`/api/assets/[id]/file` 越权 404；`/api/jobs/[id]/cancel` 状态机。
- 组件：注册页表单校验、任务中心状态渲染与取消。
- 回归：全量既有测试 + typecheck + build + docker compose 冒烟（手工/CI）。
