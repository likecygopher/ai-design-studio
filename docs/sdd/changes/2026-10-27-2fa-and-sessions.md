# 变更规格：两步验证（TOTP）与登录设备管理

- 变更 ID：`CHG-2026-10-27-2FA-SESSIONS`
- 触发：已批准清单第 4 项「2FA / 会话管理」。
- 基线：`2026-10-26-admin-account-and-auth-ui`（authVersion 吊销）与 `2026-10-27-...` 安全批次。

## 1. 数据模型

- `User` 新增：`totpSecret`（AES-256-GCM 密文）、`totpEnabled`、`totpRecoveryCodes`（SHA-256 哈希数组）。
- 新表 `AuthSession`：`id/userId/userAgent/ip/createdAt/lastSeenAt/revokedAt`，JWT 中携带 `sessionId`。
- 迁移：`20261027060000_two_factor_and_sessions`。

## 2. 两步验证

- 免依赖实现 RFC 6238 TOTP（`src/platform/totp.ts`）：Base32、HOTP/TOTP、±1 步窗口、otpauth URI、恢复码（8 个、一次性、SHA-256 存储）。
- 接口（均需登录）：
  - `GET /api/account/2fa` 状态与剩余恢复码；
  - `POST /api/account/2fa/setup` 生成待激活密钥（加密落库），返回 secret + otpauth URI；
  - `POST /api/account/2fa/enable` 校验 6 位码后启用并一次性返回 8 个恢复码；
  - `POST /api/account/2fa/disable` 用验证码/恢复码停用并清空密钥；
  - `POST /api/account/2fa/recovery` 重新生成恢复码。
- 登录：登录表单新增可选「两步验证码（如已启用）」；启用 2FA 后，`authorize` 在密码通过后校验 TOTP 或一次性恢复码，失败写 `auth.login_failed`（reason=two_factor_required/invalid）。
- 审计：`account.2fa_setup/enable/disable/recovery_regenerate`、`account.recovery_code_used`。

## 3. 登录设备（会话管理）

- 每次成功登录创建一条 `AuthSession`；JWT 只携带 `sessionId`，服务端 `getSessionUser` 校验该行未吊销、未超过会话有效期，并按 5 分钟节流更新 `lastSeenAt`。
- `GET /api/account/sessions` 列出活跃设备（当前设备标记）；`DELETE /api/account/sessions/{id}` 吊销指定设备（含当前设备，前端随即登出）。
- 退出登录事件吊销对应 session；改密/管理员重置密码会吊销该用户全部 session（叠加 `authVersion` 立即失效）。
- `/account` 新增「两步验证」与「登录设备」卡片；审计新增 `account.session_revoke`。
- `pnpm cleanup` 额外清理超过保留期的过期/已吊销会话。

## 4. 兼容与限制

- 本变更前签发的 JWT 无 `sessionId`：为平滑升级暂时放行（仍受 `authVersion`/disabled 校验）；用户重新登录后纳入设备管理。
- TOTP 采用 SHA1/6 位/30 秒（标准验证器默认）；恢复码只展示一次，丢失需用恢复码重新生成。
- 2FA 登录错误与密码错误共用同一提示，避免账号枚举。

## 5. 验收

1. 启用 2FA 后，仅密码登录失败；密码 + TOTP 登录成功；使用恢复码可登录一次且剩余数量减一。
2. `/account` 可开启/停用 2FA、查看恢复码、查看并吊销登录设备；吊销当前设备后回到登录页。
3. 改密/管理员重置密码后旧设备会话全部失效。
4. 门禁：`tsc` 0；测试全绿；`next build` 0；Playwright 账户页无 console error。
