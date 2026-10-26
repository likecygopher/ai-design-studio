# 变更规格：可扩展 AI 供应商管理 + 管理端概览/审计

- 变更 ID：`CHG-2026-10-27-MULTI-PROVIDER-AI`
- 触发：用户反馈 AI 引擎页不应写死 OpenAI/火山方舟，应该是「表格 + 新增弹窗」，其他厂商也应可接入；并授权补齐管理端缺口。
- 基线：`docs/sdd/specs/2026-10-26-commercial-platform/`（R6 可观测、R7 数据层、R11 管理端）。

## 1. 可扩展 AI 供应商（表 + 弹窗）

### 数据模型

```prisma
model AiProvider {
  id           String    @id @default(cuid())
  name         String
  channel      String    // "openai-compatible" | "ark"
  baseUrl      String    @default("")
  proxyUrl     String?
  apiKeyCipher String?   // AES-256-GCM（src/platform/secrets.ts）
  models       Json      @default("{}") // { image, text, vision, video, videoEndpoint }
  enabled      Boolean   @default(true)
  priority     Int       @default(100)
  lastTestAt   DateTime?
  lastTestOk   Boolean?
  lastTestNote String?
  createdAt/updatedAt
}
```

- 迁移：`prisma/migrations/20261026030000_ai_providers/`。
- 不再把供应商写死在代码里：任意「OpenAI 兼容」服务（OpenAI、DeepSeek、Moonshot、
  通义、OpenRouter、自建网关…）都可用同一渠道接入；火山方舟使用 `ark` 渠道。
- 预设只用于填充弹窗默认值（OpenAI / DeepSeek / Moonshot / 通义 / OpenRouter / 火山方舟 / 自定义），保存前可改。

### 生效规则

- 每个渠道（`openai-compatible` / `ark`）取**第一行启用的供应商**（priority 小优先，其次创建时间）。
- 该供应商的 apiKey/baseUrl/proxy/models 投影到既有环境变量键
  （`OPENAI_*` 或 `ARK_*` / `DOUBAO_*`），业务代码无需改动、无需重启。
- 「设为生效」= 把该行优先级提到同渠道最小之上；其余行保留，便于快速切换。
- 无数据库供应商时回退 `.env` 基线。
- Web 进程在首次调用 Provider 时懒加载（`ensureAiConfigHydrated`，避免 Edge instrumentation 打包 `node:crypto`）；
  Worker 启动时加载并每 60s 刷新；每次 CRUD 后立即刷新当前进程 env。

### 接口（仅 admin）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/ai/providers` | 列表（密钥掩码、生效标记、最近测试） |
| POST | `/api/admin/ai/providers` | 新增供应商 |
| PATCH | `/api/admin/ai/providers/{id}` | 编辑（含启用/停用、清空密钥） |
| DELETE | `/api/admin/ai/providers/{id}` | 删除 |
| POST | `/api/admin/ai/providers/{id}/test` | 调用 `/models` 做连通性测试，结果落库 |
| POST | `/api/admin/ai/providers/{id}/default` | 设为渠道生效项 |

- 密钥：AES-256-GCM 加密落库（`AI_CONFIG_SECRET` 或 `AUTH_SECRET` 派生），读取只返回 `••••••后四位`；接口/日志/审计均不含明文。
- 审计：`admin.ai_config.create/update/delete/activate/test`。

## 2. 管理端补齐

- **系统概览** `/admin`：用户数、任务总量/24h 失败率、队列（排队/运行）、存储用量、Worker 在线状态、快捷入口。
- **审计日志** `/admin/audit`：按操作类型/关键词（邮箱/动作/目标）筛选、分页；展示时间、操作、操作者、目标、请求编号、元数据摘要。
- 导航「平台管理」统一为：系统概览 / 用户管理 / AI 引擎 / 审计日志。

## 3. 验收

1. AI 引擎页为表格；「新增供应商」弹窗可从预设选择，也可自定义名称/渠道/Base URL/代理/Key/模型。
2. 可添加多个同渠道供应商；仅第一行生效，可一键切换；停用/删除即时影响运行配置。
3. 密钥落库加密、列表掩码、接口/审计无明文；连通性测试可区分成功/鉴权失败/地址错误/网络错误/超时。
4. 非管理员访问接口 403、页面重定向 `/studio-home`。
5. `typecheck` / 全量测试 / `next build` 全绿；Playwright 巡检无 console/page error。
