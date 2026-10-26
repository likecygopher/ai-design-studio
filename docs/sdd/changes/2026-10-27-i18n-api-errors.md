# 变更规格：API 错误码英文映射 + 注册校验文案

- 变更 ID：`CHG-2026-10-27-I18N-ERRORS`
- 目标：服务端仍返回中文 `error`，前端在英文模式下按稳定 `error.code` 输出英文，避免整页英文中夹杂中文错误。

## 1. 错误码映射

- `src/i18n/errors.ts`：`EN_BY_CODE` 覆盖 20+ 个稳定错误码（AUTH_REQUIRED / FORBIDDEN / VALIDATION_ERROR / RATE_LIMITED / JOB_* / COST_BUDGET_EXCEEDED / LAST_ADMIN / NETWORK_ERROR 等）。
- `formatApiError()`：
  - 读取 `studio_locale` cookie；英文模式优先使用 code 英文文案，未知 code 回退服务端消息；
  - request id 在英文下显示 `(Request ID: ...)`，中文保持原格式；
  - 中文模式完全保持原行为（既有测试不变）。
- 覆盖所有使用 `formatApiError` 的页面与表单。

## 2. 注册校验文案

- 注册表单的密码规则、邮箱校验、确认密码错误在英文模式下通过 `enByZh` 映射输出英文；默认中文不变。

## 3. 验收

1. 英文模式下 429/403/401 等错误显示英文，并保留 request id；中文模式仍为中文。
2. 注册校验错误随语言切换。
3. 门禁：tsc 0；126 测试文件 / 742 测试；next build 0；E2E 8/8。
