# 变更规格：可观测性（Prometheus metrics + 健康告警）

- 变更 ID：`CHG-2026-10-27-OBSERVABILITY`
- 触发：已批准清单第 7 项「可观测性（metrics/告警）」。
- 基线：`/api/health`、`/api/ready`、管理端健康/统计。

## 1. Metrics（无新增依赖）

- `src/platform/metrics.ts`：进程内轻量注册表，输出 Prometheus 文本（counter/histogram/gauge）。
- 路由标签经 `normalizeRoute()` 归一化（UUID/cuid/数字 → `:id`），避免高基数。
- 已埋点指标：
  - `studio_http_requests_total{method,route,status}`、`studio_http_request_duration_ms` 直方图；
  - `studio_rate_limit_rejections_total{route}`；
  - `studio_jobs_enqueued_total{type}`、`studio_jobs_completed_total`/`studio_jobs_failed_total`、`studio_job_duration_ms`；
  - `studio_jobs_blocked_budget_total`；
  - `studio_provider_calls_total{channel,outcome}`、`studio_provider_failures_total{channel,outcome}`；
  - `process_uptime_seconds`、`process_resident_memory_bytes`、`nodejs_heap_used_bytes`。
- `GET /api/metrics`：
  - 配置 `METRICS_TOKEN`（≥16 字符）时，`Authorization: Bearer <token>` 可抓取；
  - 否则要求管理员会话；匿名返回 401；`Cache-Control: no-store`。

## 2. 健康告警

`GET /api/admin/health` 新增 `alerts: [{ id, severity, message }]`：
- `database`（critical）：数据库探测失败；
- `workers`（critical）：没有在线 Worker；
- `queue-depth`（warning）：排队数 > `ALERT_QUEUE_DEPTH`（默认 100）；
- `failure-rate`（warning）：24h 任务失败率 > `ALERT_FAILURE_RATE`（默认 0.2）；
- `provider-<id>`（warning）：启用中的供应商 `consecutiveFailures >= 2`。
`status` 取值扩展为 `ok / degraded / unhealthy`；管理端 `/admin` 顶部展示告警条（严重/警告样式）。

## 3. 验收

1. 管理员调用 `/api/metrics` 返回 Prometheus 文本并包含已埋点指标；匿名 401；配置 token 后 Bearer 可抓取。
2. `/admin` 在无 Worker/高失败率/供应商连续失败/队列积压时展示对应告警。
3. 指标基数受控：动态 ID 归一到 `:id`。
4. 门禁：tsc 0；测试全绿；next build 0；E2E 校验管理员可抓取、匿名 401。
