# 变更规格：按钮可读性与样式统一

- 变更 ID：`CHG-2026-10-27-BUTTONS`
- 问题：工作台内存在多套历史全局按钮皮肤，深色主按钮被强制覆盖成浅色背景，hover 时文字与背景对比不足；右上角布局/设置浮层遮挡管理端右侧主按钮。

## 1. 修复

- AppShell 全局按钮皮肤的深色/主按钮排除规则：
  - `primary / primaryButton / tabActive / activeTab / submit / generateButton / danger / delete / aria-checked` 以及 `data-admin-action=primary`、`data-account-action=primary` 不再被玻璃浅色皮肤覆盖；
  - 深色/主按钮 hover 只做亮度反馈，保留白字，不再出现“浅底白字”。
- 统一**提交/确认类**主按钮为深色金属渐变：
  - `linear-gradient(180deg, #37444a, #202a30)`，hover `linear-gradient(180deg, #46545a, #2a353b)`，白字、深色描边；
  - 覆盖表单 submit、管理端 primary、账户提交、模板发布、设置保存、确认类操作；
  - Tab、生成按钮、布局切换、导航等非提交控件保持各自原有视觉，不再统一刷成该渐变。
- 布局与遮挡：
  - 内容区顶部预留 62px（紧凑模式 56px），右上角“布局切换 + 用户设置”不再遮挡管理端页面右侧的主按钮；
  - 管理端页面主操作（如“新增套餐”）可正常 hover/点击。
- 增加 E2E 回归：管理端主按钮点击不被浮层拦截、紧凑布局切换与持久化。

## 2. 验收

1. 深色/蓝色主按钮 hover 后白字清晰；浅色按钮 hover 不出现白字。
2. 模板市场、账户设置、用户设置、管理端套餐/用户/市场等主要页面按钮风格一致。
3. 门禁：tsc 0；135 测试文件 / 790 测试；next build 0；E2E 11 passed。
