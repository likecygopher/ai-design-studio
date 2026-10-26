# 变更规格：任务运维闭环 + 月度预算/配额 + 安全头

- 变更 ID：`CHG-2026-10-27-OPS-BUDGET`
- 触发：用户批准除邮件/密码找回外的全部清单，本批落地 P0 的「任务运维闭环」「成本预算与用量配额」「安全与质量门禁」中的 CSP。
- 基线：`docs/sdd/specs/2026-10-26-commercial-platform/`（R4 任务、R5 成本、R11 管理端、R13 安全）。

## 1. 任务运维闭环

- **用户侧**：任务中心对 `failed` / `cancelled` 任务显示「重试任务」；`POST /api/jobs/{id}/retry` 克隆 `type` + `payload` 生成新任务（新 id 与新幂等键），预算/并发配额重新校验，原任务保留历史。
- **管理端**：新增 `/admin/jobs`（导航「平台管理 → 任务管理」）：
  - 按状态、用户 ID 筛选，游标分页；
  - 对失败/取消任务「重试」，对排队/运行任务「取消」；
  - 展示尝试次数、失败原因、创建时间。
- **接口**：`POST /api/admin/jobs/{id}/retry`、`POST /api/admin/jobs/{id}/cancel`（仅 admin）。
- **审计**：`job.retry`、`admin.job.cancel`、`job.blocked_budget`。

## 2. 月度 AI 预算与配额

- 数据：`User.monthlyBudgetUnits Int?`（迁移 `20261027040000_user_budget`）。
  - `null` = 使用平台默认；`0` = 该用户不限制；正数 = 月度估算单位上限。
  - 平台默认：`DEFAULT_MONTHLY_BUDGET_UNITS`（未设置 = 不限）。
- 用量来源：`CostRecord.estimatedUnits` 当月（UTC 月初起）累计。
- 执行点：`enqueueJobIdempotent` 在创建新任务前校验；超限返回 `429 COST_BUDGET_EXCEEDED`，并写 `job.blocked_budget` 审计。幂等重放与重试同样受约束。
- 管理端：`/admin/users` 列表新增「本月用量」（`已用 / 预算`；预算来源默认/不限），编辑弹窗可设置或清空预算；`PATCH /api/admin/users/{id}` 接受 `monthlyBudgetUnits`。
- 用户侧：`/costs` 改为读取数据库台账，新增「本月 AI 预算」进度条；`GET /api/costs` 返回 `budget` 快照。

## 3. 安全头

- `next.config.mjs` 增加 `Content-Security-Policy`：
  - `default-src 'self'`、`frame-ancestors 'none'`、`base-uri 'self'`、`form-action 'self'`、`object-src 'none'`；
  - `script-src 'self' 'unsafe-inline'`（Next 内联引导脚本所需；后续可迁移 nonce 中间件），开发环境追加 `'unsafe-eval'`；
  - 图片允许 `data:`/`blob:`/`https:`，媒体允许 `blob:`。

## 4. 验收

1. 用户可重试自己的失败/取消任务；他人任务 404；已完成任务 409 `JOB_NOT_RETRYABLE`。
2. 管理端可查看全平台任务、取消任意用户任务、重试失败任务，均有审计。
3. 预算用尽时新任务 429 且不落库；管理员调整后立即恢复；`0` 表示不限制。
4. `/costs` 展示预算进度与数据库台账；`/api/costs` 含 `budget`。
5. CSP 不影响页面加载与交互（Playwright 无 console error）。
6. 门禁：`tsc` 0；105 测试文件 / 642 测试通过；`next build` 0。
