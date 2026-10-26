# 任务清单：商业级多用户平台 v1

状态：`todo` / `doing` / `done` / `blocked`。每个任务完成需附验证命令与结果。

## P0 规格与设计

| ID | 任务 | 负责人 | 状态 | 验收 |
|---|---|---|---|---|
| T00 | 合并 origin/main 并修复合并冲突/失败测试 | Lead | done | 冲突解决；新增 6 个失败测试修复；4 个基线失败转入 T70 |
| T01 | SDD 文档（宪法/规格/设计/计划/任务） | Lead | done | `docs/sdd/**` 齐全 |

## P1 数据模型

| ID | 任务 | 负责人 | 状态 | 验收 |
|---|---|---|---|---|
| T10 | Prisma schema 扩展（Job 幂等/退避/取消、Asset.sizeBytes、AuditLog、WorkerHeartbeat） | Lead | done | `prisma validate` + generate 通过 |
| T11 | 初始迁移 SQL（`migrate diff --from-empty`）+ 迁移脚本/文档 | Lead | done | `migration.sql` 可 `migrate deploy` |
| T12 | seed 加固（生产禁止默认管理员密码） | Lead | done | 生产无 `SEED_ADMIN_PASSWORD` 时拒绝 |

## P2 平台基础层

| ID | 任务 | 负责人 | 状态 | 验收 |
|---|---|---|---|---|
| T20 | `config.ts` env zod 校验 + 派生配置 | Lead | done | 缺失 `AUTH_SECRET` 生产报错；单测 |
| T21 | `errors.ts` + `http.ts` 统一错误契约（保留 `error: string`） | Lead | done | 映射表单测 |
| T22 | `logger.ts` JSON 日志 + 脱敏 + requestId | Lead | done | 单测（脱敏） |
| T23 | `api.ts` `handleApi()`（认证/限流/日志/错误） | Lead | done | 401/403/400/429 单测 |
| T24 | `rate-limit.ts` `RateLimiter` + 内存滑动窗口 | Lead | done | 窗口/重置换算单测 |
| T25 | `audit.ts` `recordAudit()`（失败不阻断） | Lead | done | mock prisma 单测 |
| T26 | 安全响应头 + `instrumentation.ts` + middleware 策略 | Lead | done | build 后 headers 检查 |

## P3 认证 / RBAC / 管理端 / 健康

| ID | 任务 | 负责人 | 状态 | 验收 |
|---|---|---|---|---|
| T30 | 登录限流 + 登录/注册审计 + session maxAge | Lead | done | 5 次失败后 429；成功写审计 |
| T31 | 注册加固（密码策略/统一小写/P2002 映射/限流） | Lead | done | 409/400/429 测试 |
| T32 | `requireRole` + `/api/admin/{users,jobs,stats,health}` | Lead | done | 非 admin 403 测试 |
| T33 | `/api/health`、`/api/ready`（DB + worker 心跳） | Lead | done | 200/503 测试 |
| T34 | `worker-heartbeat.ts` | Lead | done | 与 T40 协作，单测 |

## P4 任务可靠性（jobs-reliability）

| ID | 任务 | 负责人 | 状态 | 验收 |
|---|---|---|---|---|
| T40 | 幂等提交（`idempotencyKey` + 唯一约束兜底） | jobs-reliability | done | 重复提交同任务 |
| T41 | 退避重试（`nextAttemptAt` + backoff）+ claim 过滤 | jobs-reliability | done | 失败→延迟重排 |
| T42 | 僵死任务回收 `reclaimStaleJobs` | jobs-reliability | done | lease 过期回队 |
| T43 | 取消 API + worker 检查点 | jobs-reliability | done | queued/running/终态 三分支 |
| T44 | Worker 心跳 + 优雅退出 + 在途等待 | jobs-reliability | done | SIGTERM 不丢任务 |
| T45 | 列表分页/状态过滤 + 进度节流 | jobs-reliability | done | cursor 分页测试 |

## P5 存储与上传安全（storage-security）

| ID | 任务 | 负责人 | 状态 | 验收 |
|---|---|---|---|---|
| T50 | 魔数校验（PNG/JPEG/WebP/PDF/MP4；拒绝 SVG） | storage-security | done | 伪文件 415 测试 |
| T51 | 单文件/数量/用户配额（`sizeBytes` 落库） | storage-security | done | 413 测试 |
| T52 | 私有资产路由 `/api/assets/[id]/file` | storage-security | done | 越权 404、响应头正确 |
| T53 | 清理脚本 `scripts/cleanup.ts` + `pnpm cleanup` | storage-security | done | `--dry-run` 可用 |

## P6 前端平台化（frontend-platform）

| ID | 任务 | 负责人 | 状态 | 验收 |
|---|---|---|---|---|
| T60 | `/register` 注册页（校验/loading/错误/互跳） | frontend-platform | done | 组件测试 |
| T61 | `/jobs` 任务中心（列表/状态/取消/刷新） | frontend-platform | done | 组件测试；导航入口 |
| T62 | AppShell 角色展示 + admin 管理入口 | frontend-platform | done | 既有 AppShell 测试通过 |
| T63 | 前端统一 API 错误解析（含 requestId） | frontend-platform | done | 单测 |

## P7 工程质量（quality-docs）

| ID | 任务 | 负责人 | 状态 | 验收 |
|---|---|---|---|---|
| T70 | 修复 4 个基线失败测试 | quality-docs | done | 全量测试全绿 |
| T71 | `.github/workflows/ci.yml`（Postgres service + 全门禁） | quality-docs | done | YAML 合法；步骤正确 |
| T72 | `Dockerfile` + `docker-compose.yml`（web/worker/postgres） | quality-docs | done | `docker compose config` 通过 |
| T73 | `docs/runbook.md`（部署/回滚/排障/任务卡死） | quality-docs | done | 覆盖事故场景 |

## P8 集成验收（Lead）

| ID | 任务 | 负责人 | 状态 | 验收 |
|---|---|---|---|---|
| T80 | typecheck + 全量测试 + build 全绿 | Lead | done | 三命令 exit 0 |
| T81 | 端到端冒烟（注册→上传→任务→取消→成本） | Lead | done | 记录结果 |
| T82 | 安全自查（越权查询/密钥/错误泄露） | Lead | done | grep 无违例 |
| T83 | 文档收口（README/task_plan/progress/findings/SDD） | Lead | done | 文档一致 |


---

## 完成记录（2026-10-26，Lead 验收）

**质量门禁（本机实测）**

- `npx tsc --noEmit` → exit 0
- `npx vitest run` → 83 files / **507 tests passed**（含原基线 4 个失败测试已修复）
- `npx next build` → exit 0（standalone 输出）
- `docker compose config` → OK（需 `AUTH_SECRET` 环境变量）
- `npx tsx scripts/cleanup.ts --dry-run` → 正常输出扫描/计划 JSON

**端到端冒烟（`next start` :3211 + worker + 本机 PostgreSQL:5433）**

| 场景 | 结果 |
|---|---|
| `GET /api/health` / `GET /api/ready`（worker 未启动） | 200 / 503 |
| worker 启动后心跳写入 `WorkerHeartbeat`，`/api/ready` | 200（`1/1 alive`） |
| 未登录 `GET /api/jobs` | 401 `AUTH_REQUIRED` + requestId |
| 未登录访问 `/studio-home` | 307 → `/login?callbackUrl=%2Fstudio-home` |
| 注册（强密码）→ 登录（NextAuth 凭据）→ 会话含 `id/role` | 201 / 302 / 200 |
| 普通用户 `GET /api/admin/users` | 403 `FORBIDDEN` |
| 管理员 `GET /api/admin/users|stats|health` | 200，且无 `passwordHash` |
| 上传真实 PNG | 成功，`Asset.sizeBytes=70`，URL 为 `/uploads/<userId>/...` |
| 上传伪装 PNG（HTML 内容）/ SVG | 415 `UNSUPPORTED_MEDIA_TYPE` |
| 私有文件 `GET /api/assets/{id}/file`（本人 / 未登录 / 他人） | 200 / 401 / 404 |
| 他人静态路径 `/uploads/<ownerId>/...` | 404 |
| 任务幂等：同 `idempotencyKey` 重复提交 | 202 首次 / 200 复用同一 job |
| 取消 queued 任务 | 200 `cancelled`；再次取消 409 `JOB_NOT_CANCELLABLE` |
| 管理员取消他人任务 | 404（不泄露存在性） |
| 用户设置隔离 | 用户 A= Brazil/Portuguese，管理员仍为 Mexico/Spanish |
| 登录限流（同 IP+邮箱 5 次失败） | 第 6 次 429 + `Retry-After` |
| 安全响应头 | nosniff / DENY / Referrer-Policy / Permissions-Policy / COOP / HSTS |
| 审计日志 | `auth.register/login/login_failed`、`job.enqueue/cancel`、`admin.*`、`asset.upload` 均落库 |
| worker SIGTERM | 打印 `worker.shutdown` → 心跳行删除 → `/api/ready` 回到 503 |

**与设计的偏差 / 补充实现**

1. `scripts/worker.ts` 的循环/心跳/优雅退出抽为 `src/platform/worker-runtime.ts`（可单测），`worker.ts` 仅做依赖装配与信号处理；新增 10 个运行时单测。
2. `app/uploads/**`、`app/generated/**` 静态服务补上「路径首段 = 当前 userId 或 admin」的归属校验，避免跨用户按 URL 读取。
3. `app/api/outputs` 从「扫描全盘 generated」改为「当前用户资产清单」，消除跨用户文件名泄露。
4. `app/api/weather`、`app/api/cover-chat` 明确为公开路由并加 IP 限流；`app/api/white-background` 从 demo store 改为用户 workspace（数据隔离）。
5. middleware 按协议传 `secureCookie`，兼容 HTTPS 下 `__Secure-authjs.session-token` 的 v5 Cookie 命名。
6. `handleApi` 对公开路由惰性加载 `next-auth`，避免公开路由的测试与冷启动被认证依赖拖累。

**遗留（P1，已在 README/runbook 标注）**

- 多副本部署前需将内存限流替换为 Redis 实现。
- 对象存储/S3 直传未接入（`AssetStorage` 接口预留）。
- 管理端仅有 API，无独立管理 UI。
- 历史 `public/` 静态 URL 仍可按路径访问（已做归属校验，最终应统一走 `/api/assets/{id}/file`）。
