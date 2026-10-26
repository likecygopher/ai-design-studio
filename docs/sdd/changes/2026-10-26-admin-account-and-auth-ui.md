# 变更规格：管理员账户管理 + 认证页视觉统一

- 变更 ID：`CHG-2026-10-26-ACCOUNT-ADMIN`
- 基线规格：`docs/sdd/specs/2026-10-26-commercial-platform/spec.md`（R2/R8）
- 状态：Approved（用户需求：管理员可管理用户/创建用户/改密；登录页风格需与全站一致）
- 原则：仍受 `docs/sdd/constitution.md` 约束（数据隔离、默认拒绝、审计、可回滚、TDD）

## 1. 背景

平台已有管理员角色、管理端只读 API（用户/任务/统计/健康）与 RBAC 守卫，但缺少**可操作的账户管理界面与写接口**；同时 `/login`、`/register` 使用一套独立的深蓝渐变样式，与全站"浅色玻璃工作台 + 炭黑文字 + 浅金选中 + 深色胶囊按钮"的视觉语言不一致。

## 2. 需求

### R11 管理员账户管理（P0）

- **R11.1 列表**：管理员可分页查看用户（邮箱、昵称、角色、启用状态、资源计数、创建时间），支持关键字搜索与角色筛选。
- **R11.2 创建**：管理员可用邮箱创建用户，可指定昵称、角色、初始密码；不填密码时由服务端生成一次性强密码并在响应中返回一次。
- **R11.3 编辑**：管理员可修改昵称、角色、启用/禁用状态。
- **R11.4 重置密码**：管理员可为指定用户设置新密码（或生成一次性密码）；操作后该用户既有会话立即失效。
- **R11.5 守卫**：
  - 不允许管理员禁用/降级自己（避免自锁）；
  - 不允许移除最后一个可用管理员（`409 LAST_ADMIN`）；
  - 非管理员访问任一管理端接口 → `403`；未登录 → `401`。
- **R11.6 审计**：`admin.user.create` / `admin.user.update` / `admin.user.password_reset` 写入 `AuditLog`，不记录明文密码。
- **R11.7 会话失效**：`User.authVersion` 递增后，旧 JWT 在服务端校验失败 → API 返回 401、页面重定向登录并清理 Cookie。

### R12 自助账户（P0）

- **R12.1** 已登录用户可在 `/account` 修改自己的密码（需校验当前密码 + 新密码策略）。
- **R12.2** 改密成功后当前会话失效，前端引导重新登录（避免旧会话继续可用）。

### R13 认证页视觉统一（P0）

- **R13.1** `/login`、`/register` 与全站一致：使用默认工作台壁纸背景 + 半透明浅色玻璃卡；炭黑标题、灰色辅助文案、浅金选中态、深色胶囊主按钮；复用 Gotham 字体与 8–16px 圆角体系。
- **R13.2** 表单可访问性保持：label 关联、错误区 `role="alert"`、按钮 loading 态；既有测试选择器（邮箱/密码/昵称/确认密码/进入工作台/密码规则提示）不得回归。
- **R13.3** 响应式：≥1024px 双栏（品牌叙事 + 表单），<1024px 单栏卡片；移动端不横向滚动。

## 3. 数据模型变更

```prisma
model User {
  // 既有字段不变
  disabled    Boolean @default(false)  // 账户禁用（登录/会话校验均拒绝）
  authVersion Int     @default(0)      // 递增即吊销既有 JWT 会话
}
```

- 迁移：`prisma/migrations/<ts>_account_admin/migration.sql`（仅新增列，向后兼容）。
- 既有管理员/用户默认 `disabled=false`、`authVersion=0`，旧会话继续有效。

## 4. API 契约（均遵循统一错误结构）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/admin/users?q=&role=&limit=&cursor=` | admin | 列表（新增 `role` 过滤，返回 `disabled`、`updatedAt`） |
| POST | `/api/admin/users` | admin | 创建用户；`{ email, password?, name?, role? }`；返回 `{ user, temporaryPassword? }` |
| PATCH | `/api/admin/users/{id}` | admin | `{ name?, role?, disabled? }`；返回 `{ user }` |
| POST | `/api/admin/users/{id}/password` | admin | `{ password? }`；返回 `{ user, temporaryPassword?, reauthRequired }` |
| POST | `/api/account/password` | user | `{ currentPassword, newPassword }`；返回 `{ reauthRequired: true }` |
| GET | `/api/auth/expire?callbackUrl=/login` | public | 清理会话 Cookie 并跳转，用于服务端发现失效会话时断开循环 |

错误码新增：`LAST_ADMIN`（409）、`CANNOT_MODIFY_SELF`（400）；复用 `EMAIL_TAKEN` / `VALIDATION_ERROR` / `NOT_FOUND`。

密码策略（创建/重置/自助改密一致）：8–72 位，至少 1 个字母与 1 个数字；服务端生成密码为 16 位并保证字母+数字+特殊字符。

## 5. 认证与会话失效链路

```
登录 → JWT{ sub, role, authVersion }
请求 → getSessionUser():
        auth() 取 sub/authVersion
        → DB 读 User(id)（select id,email,name,role,disabled,authVersion）
        → 无用户 / disabled / authVersion 不匹配 ⇒ null
页面 → requireServerWorkspace(): getSessionUser(); null → redirect("/api/auth/expire")
API  → handleApi(): getSessionUser(); null → 401 AUTH_REQUIRED
/api/auth/expire → 清 authjs 会话/Cookie → 302 /login?expired=1（middleware 放行且不反向跳转）
/login?expired=1 → 提示"会话已过期，请重新登录"
```

> 安全/性能权衡：每请求多一次按主键查询（有索引），换取即时禁用与改密吊销；规模化可加短 TTL 缓存（P1）。

## 6. 视觉规范（认证页）

| 令牌 | 取值 |
|---|---|
| 页面背景 | `/home/studio-background-neutral.webp` cover + 深色轻遮罩（复用外壳观感） |
| 玻璃卡 | `rgba(247,250,251,.30)` + `backdrop-filter: blur(26px) saturate(128%)` + 1px 白色半透明描边 |
| 标题/正文 | `#24282c` / `#50575d` / `#737a80` |
| 选中/焦点 | 浅金 `#b8914b`（与 StudioDialog 焦点色一致）；选中标签用深色低透明底 + 金色下划线 |
| 主按钮 | 深色胶囊 `#24282c`，hover `#111`，白字 |
| 输入框 | 白色半透明底 + 浅色描边，focus 金色 outline-offset |
| 圆角 | 卡片 16px，输入/按钮 8–10px |
| 品牌区 | "MIDEA OVERSEAS" 11px 大写 + "AI Content Studio" 21px 粗体（与侧边栏 brand 一致） |

## 7. 验收标准

1. 管理员在 `/admin/users` 可搜索、创建、编辑角色/昵称、禁用/启用、重置密码；界面与全站视觉一致。
2. 普通用户看不到"用户管理"入口；直接访问 `/admin/users` 被重定向 `/studio-home`；接口 403。
3. 管理员不能禁用/降级自己；最后一名管理员不可被降级/禁用。
4. 被禁用用户登录失败（通用错误，不泄露原因）；已登录用户被禁用后下一次请求即 401/跳登录。
5. 重置密码后旧会话失效、新密码可登录；自助改密后需重新登录。
6. 所有写操作有审计记录且不含明文密码。
7. `/login`、`/register` 视觉与工作台一致；既有登录/注册测试全绿。
8. `pnpm typecheck`、`pnpm test`、`pnpm build` 全绿。

## 8. 任务

| ID | 任务 | 状态 |
|---|---|---|
| A01 | Prisma `User.disabled/authVersion` + 迁移 | done |
| A02 | 认证层禁用/版本校验 + `/api/auth/expire` + middleware 放行 | done |
| A03 | 管理端用户写接口 + 自助改密 + 审计 + 守卫 | done |
| A04 | `/admin/users` 管理页与组件（表格/弹窗/临时密码展示） | done |
| A05 | `/account` 账户页 | done |
| A06 | AppShell/导航：账户入口 + 管理员"用户管理"入口 | done |
| A07 | 登录/注册页视觉重构（CSS + 轻量结构） | done |
| A08 | 测试：后端 RBAC/守卫/吊销；前端管理页/导航/登录 | done |
| A09 | 验收：typecheck/test/build + 端到端冒烟 + 文档更新 | done |

---

## 9. 完成记录（2026-10-26）

**实现**

- 数据：`User.disabled` + `User.authVersion`，迁移 `prisma/migrations/20261026010000_account_admin/`。
- 认证：登录拒绝禁用账号（通用错误 + 审计原因）；`getSessionUser()` 每请求回查 DB（禁用/版本/角色），旧 JWT 立即失效；新增 `/api/auth/expire` 清理 Cookie；middleware 放行 `/login?expired=1` 避免重定向环。
- 接口：`POST/PATCH /api/admin/users`、`POST /api/admin/users/{id}/password`、`POST /api/account/password`；守卫（不能自禁用/自降级、最后一名管理员保护）；审计 `admin.user.create|update|password_reset` 与 `account.password_change`。
- 前端：`/admin/users`（搜索/角色筛选/分页/创建/编辑/禁用/重置密码/一次性密码展示/复制）、`/account`（账号信息 + 自助改密）；导航新增"账户设置"（所有人）与"用户管理"（仅 admin，平台管理分组）；AppShell 角色徽标保留。
- 视觉：登录/注册页重构为与工作台一致的浅色玻璃 + 壁纸 + 炭黑标题 + 浅金焦点 + 深色胶囊行动按钮；`AuthShell` 复用；桌面双栏 / 移动单栏。
- 兼容：既有登录/注册测试选择器与文案未回归；错误契约保持。

**验证**

- `npx tsc --noEmit` → 0；`npx vitest run` → 89 files / 566 tests passed；`npx next build` → 0。
- 端到端（`next start` + 真实 PostgreSQL）：
  - 管理员创建用户（自动生成 16 位一次性密码）→ 新用户用临时密码登录成功；
  - 禁用用户后：受保护 API 立即 401，页面 307 → `/api/auth/expire` → 清 Cookie → `/login?expired=1`；禁用状态下登录拿不到会话；
  - 管理员重置密码后旧 Cookie 立即失效，新密码可登录；
  - 自助改密 → 旧会话失效 → 新密码可登录；
  - 普通用户访问 `/admin/users` → 307 `/studio-home`；管理员页面 200 且含"用户管理"；
  - 管理员自禁用 → 400 `CANNOT_MODIFY_SELF`；`/api/auth/expire` 按 `x-forwarded-host/proto` 生成外部跳转地址并清 6 个会话 Cookie；
  - 浏览器（Playwright）实测：登录/管理/账户页无 console/page error，桌面与 390px 移动端无横向溢出；管理表格与设置浮层不重叠。
