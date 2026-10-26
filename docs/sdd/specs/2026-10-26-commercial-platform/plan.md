# 实施计划：商业级多用户平台 v1

## 阶段划分与依赖

```
P0 规格与设计 ─▶ P1 数据模型/迁移 ─▶ P2 平台基础层 ─┬─▶ P3 认证/RBAC/管理端/健康
                                                   ├─▶ P4 任务可靠性 ─┐
                                                   └─▶ P5 存储安全 ───┤
                                                                       ├─▶ P6 前端平台化 ─▶ P7 工程质量（CI/Docker/文档）
                                                                       └──────────────────▶ P8 集成验收
```

每个阶段结束时必须通过对应门禁，未通过不进入下一阶段。

## P0 规格与设计（Lead）

- 产出：`constitution.md`、`spec.md`、`design.md`、`plan.md`、`tasks.md`。
- 门禁：需求覆盖用户"商业级 / 多人使用"目标；非目标清晰；验收标准可执行。

## P1 数据模型与迁移（Lead）

- 变更 `prisma/schema.prisma`：`GenerationJob`（幂等/退避/取消）、`Asset.sizeBytes`、`AuditLog`、`WorkerHeartbeat`。
- 生成 `prisma/migrations/<ts>_platform_v1/migration.sql`（`migrate diff --from-empty`）。
- `prisma/seed.ts` 加固（生产禁止默认密码）。
- 门禁：`prisma validate`、`prisma generate`、迁移 SQL 可读。

## P2 平台基础层（Lead）

- `config.ts`（zod env 聚合校验）、`errors.ts`、`logger.ts`、`http.ts`、`api.ts`（handleApi）、`rate-limit.ts`、`audit.ts`。
- `next.config.mjs` 安全响应头 + `output: "standalone"`；`instrumentation.ts` 启动校验。
- `middleware.ts` 公开路径集中声明。
- 门禁：新模块单测通过；`typecheck` 0。

## P3 认证 / RBAC / 管理端 / 健康（Lead）

- 登录限流与审计、注册加固、`requireRole`。
- `/api/admin/users|jobs|stats|health`、`/api/health`、`/api/ready`。
- 门禁：401/403/429 边界测试通过。

## P4 任务可靠性（Teammate: jobs-reliability）

- 幂等提交、退避重试、僵死回收、取消 API、心跳、优雅退出、分页、进度节流。
- 门禁：状态机单测 + `handleApi` 集成测试；worker 干跑不回队。

## P5 存储与上传安全（Teammate: storage-security）

- 魔数校验、大小/数量/配额、`sizeBytes` 落库、私有文件路由、清理脚本。
- 门禁：伪文件 415、超限 413、越权 404 测试通过。

## P6 前端平台化（Teammate: frontend-platform）

- `/register`、`/jobs` 任务中心、AppShell 角色/管理入口、统一错误解析。
- 门禁：组件测试通过；既有 13 工作流页面无回归。

## P7 工程质量（Teammate: quality-docs）

- 修复 4 个基线失败测试；CI workflow；Dockerfile + compose（web/worker/postgres）；`docs/runbook.md`。
- 门禁：全量测试全绿、`build` 0、compose 配置校验。

## P8 集成验收（Lead）

- 全量门禁：`pnpm typecheck`、`pnpm test`、`pnpm build`。
- 端到端冒烟：注册→登录→上传→提交任务→取消→成本→登出（本地容器库）。
- 差异审查：无越权查询、无密钥泄漏、无无关改动。
- 交付：SDD 文档定稿、`README.md`/`task_plan.md`/`progress.md`/`findings.md` 更新。

## 并行与写入边界（避免冲突）

| 角色 | 独占写入范围 |
|---|---|
| Lead | `prisma/**`、`src/platform/{config,errors,logger,http,api,rate-limit,audit,auth,auth.config,worker-heartbeat}.ts`、`middleware.ts`、`next.config.mjs`、`instrumentation.ts`、`app/api/{health,ready,admin}/**`、`app/api/auth/register/**`、`package.json`、`docs/sdd/**` |
| jobs-reliability | `src/platform/jobs.ts`、`src/platform/job-handlers.ts`、`app/api/jobs/**`、`scripts/worker.ts` |
| storage-security | `src/platform/user-asset-store.ts`、`src/platform/storage/**`、`app/api/upload/**`、`app/api/assets/**`、`scripts/cleanup.ts` |
| frontend-platform | `app/register/**`、`app/jobs/**`、`src/components/{RegisterForm,JobsCenter,AppShell}*`、`src/platform/client/**` |
| quality-docs | `Dockerfile`、`docker-compose.yml`、`.github/workflows/**`、`docs/runbook.md`、4 个既有失败测试涉及文件（仅测试侧） |

> 共享文件（`README.md`、`vitest.setup.ts`、`task_plan.md`）由 Lead 统一收口。

## 时间盒（本会话）

1. P0–P3：Lead 顺序完成。
2. P4–P7：三/四个 teammate 并行，Lead 做 P1/P2 收尾。
3. P8：Lead 串行验收，失败项回派 owner 修复。

## 回滚策略

- 应用：保留 `main` 上一提交；功能分支合并前跑全量门禁。
- 数据库：迁移以新增表/字段为主，向后兼容；回滚使用 `prisma migrate resolve` + 反向 SQL（文档记录）。
- 配置：新增 env 均有默认值或明确失败信息，不影响旧部署启动（生产严格、开发宽松）。
