# 变更规格：任务审批流（管理员审批后执行）

- 变更 ID：`CHG-2026-10-27-JOB-APPROVAL`
- 触发：已批准清单第 10 项中的「审批流」切片。
- 目标：多用户平台可要求指定用户的新任务先经管理员审批，避免未授权/高风险生成直接消耗额度与算力。

## 1. 数据与判定

- `GenerationJob` 新增：`requiresApproval`、`approvedAt`、`approvedBy`、`approvalNote`。
- `User` 新增：`requiresJobApproval`（管理员可在用户编辑中开启）。
- 是否需要审批 = 平台环境变量 `JOB_REQUIRE_APPROVAL=true` **或** 用户级 `requiresJobApproval=true`。
- 入队时：需要审批 → `approvedAt=null`；否则立即 `approvedAt=now()`（既有任务由迁移回填）。
- 迁移：`20261027080000_job_approval`（含既有任务 `approvedAt` 回填）。

## 2. 执行门禁

- Worker 领取 SQL 增加 `AND "approvedAt" IS NOT NULL`：待审批任务不会被领取/执行；审批通过后下一次轮询即可领取。
- 审批通过会重置 `nextAttemptAt=now()`；驳回将任务置为 `cancelled` 并写入原因。

## 3. 接口与 UI

- `POST /api/admin/jobs/{id}/approve`：仅 admin；仅 `queued + requiresApproval + approvedAt=null` 可审批，否则 409 `JOB_NOT_APPROVABLE`；可选 `note`。
- `POST /api/admin/jobs/{id}/reject`：同上条件；状态改为 cancelled，`error` 带审批备注。
- `/admin/jobs`：新增「审批」筛选（全部/待审批/已批准）、待审批徽标、批准/驳回图标操作。
- 用户任务中心：待审批任务显示「等待审批」徽标。
- 管理端用户编辑：新增「该用户的新任务需要管理员审批」开关。
- 审计：`admin.job.approve`、`admin.job.reject`；用户更新记录新增字段。

## 4. 验收

1. 开启用户审批后新建任务 `requiresApproval=true、approvedAt=null`，出现在管理端待审批列表。
2. Worker 审批前领取不到该任务；批准后可领取；驳回后状态 cancelled 且原因可读。
3. 管理员用户编辑可开关审批；最后管理员等既有守卫不受影响。
4. 门禁：tsc 0；123 测试文件 / 729 测试；next build 0。
