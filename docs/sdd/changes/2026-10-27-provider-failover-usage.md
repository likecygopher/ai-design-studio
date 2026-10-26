# 变更规格：AI 供应商故障切换与调用统计

- 变更 ID：`CHG-2026-10-27-PROVIDER-HEALTH`
- 触发：已批准清单第 3 项「AI 供应商故障切换与用量统计」。
- 基线：`CHG-2026-10-27-MULTI-PROVIDER-AI`。

## 1. 调用统计

- `AiProvider` 新增字段（迁移 `20261027050000_ai_provider_usage`）：
  `successCount`、`failureCount`、`consecutiveFailures`、`lastFailureAt`、`lastFailureReason`。
- Worker 每次执行任务尝试都会归因到该任务渠道（channel）的当前生效供应商：
  - `product-video` → `ark`；
  - payload `imageModel === "doubao"` → `ark`；
  - 其余图像/文本任务 → `openai-compatible`。
- 成功：`successCount + 1` 且 `consecutiveFailures = 0`；
  失败：`failureCount + 1`、`consecutiveFailures + 1`、记录时间与原因（截断 200 字）。
- 管理端 AI 引擎表格新增「调用 X 成功 · Y 失败 · 连续失败 N」与「连续失败 · 已切换」徽标。

## 2. 自动故障切换

- 同一渠道内连续失败达到 **2 次** 时，自动把下一个启用中的供应商优先级提升到当前之前：
  - 数据库更新 `priority = min(priority) - 1`，随后 `hydrateAiConfigFromDb()` 立即投影到当前 Worker 进程 env；
  - 写审计 `admin.ai_config.failover`（actorRole=`system`，含 from/to/channel/reason/consecutiveFailures）；
  - Worker 的下一次自动重试即使用备用供应商。
- 仅有一个可用供应商时不切换，避免同一故障反复轮换。
- Web 进程的 `ensureAiConfigHydrated()` 增加 60s 刷新定时器，使同步路由也能在 1 分钟内感知切换。
- 属于**工作负载级切换**（下一次任务尝试生效），不在单次 HTTP 请求内重试，避免并发下修改全局 env。

## 3. 运维与限制

- 切换是自动的；管理员可在 `/admin/ai` 手动「设为生效」覆盖，或修复被切换供应商的网络/密钥后重新设回。
- 若所有供应商同时不可用，任务按既有重试策略失败；管理员会看到连续失败统计与审计。
- 统计仅覆盖经 Worker 执行的异步任务；同步路由（如 Icon 直出）目前不计数，后续可接入同一 helper。

## 4. 验收

1. 两次失败后：失败供应商 `consecutiveFailures=2`，备用供应商 priority 变为 99 且 `active=true`。
2. 审计出现一条 `admin.ai_config.failover`；刷新后 env 指向备用供应商。
3. 成功一次即将连续失败清零。
4. 管理端表格展示统计与降级徽标；无 console error。
5. 门禁：`tsc` 0；106 测试文件 / 649 测试；`next build` 0。
