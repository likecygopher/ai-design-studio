# 变更规格：数据治理（导出 / 注销 / 审计导出）

- 变更 ID：`CHG-2026-10-27-DATA-GOVERNANCE`
- 触发：已批准清单第 9 项「数据治理（导出/注销/审计导出）」。

## 1. 账号数据导出

- `GET /api/account/export`（登录用户，限流 3 次/15 分钟）返回 JSON 附件：
  - `user`（不含密码哈希）、`settings`、`products`、`assets` 元数据（不含 storageKey）、`jobs`（不含 payload）、`costs`、`auditLogs`、`apiTokens`（不含 tokenHash）、`webhooks`（不含 secret）、`sessions`；
  - 上限每类 1000 条；`Content-Disposition: attachment`；
  - 审计 `account.data_export`。
- UI：`/account` →「数据与隐私」→「导出我的数据」（浏览器直接下载）。

## 2. 账号注销

- `DELETE /api/account`，body `{ password }`：
  - 校验当前密码（bcrypt）；
  - 最后一名可用管理员不可注销（409 `LAST_ADMIN`）；
  - 删除 User，级联删除 products/assets/jobs/costs/sessions/api tokens/webhooks；
  - 尽力删除资产文件（失败由 `pnpm cleanup` 兜底）；
  - 审计 `account.data_delete`（userId 置空、记录邮箱与资产数）；
  - UI：二次确认面板 + 密码输入 → 注销后强制退出。
- 注销后旧会话/令牌立即失效（用户行不存在），登录返回通用失败。

## 3. 审计日志导出

- `GET /api/admin/audit/export?action=&from=&to=&limit=`（admin，limit ≤5000，默认 1000）返回 CSV 附件（UTF-8 BOM，Excel 兼容；字段含逗号/引号/换行时正确转义）。
- 列：createdAt/action/actorRole/userEmail/userId/targetType/targetId/ip/requestId/metadata(JSON)。
- 审计 `admin.audit_export`；`/admin/audit` 新增「导出 CSV」按钮（沿用当前操作类型筛选）。

## 4. 验收

1. 导出文件包含本人数据且不含密码哈希/令牌哈希/Webhook secret/storageKey；下载头正确。
2. 密码错误 400、最后管理员 409、普通用户注销成功且无法再次登录。
3. 审计 CSV 可被 Excel 打开且转义正确；非管理员 403。
4. 门禁：tsc 0；121 测试文件 / 716 测试；next build 0。
