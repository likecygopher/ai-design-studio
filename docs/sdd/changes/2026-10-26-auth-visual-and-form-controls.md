# 变更规格：登录页视觉素材化 + 工作台表单控件统一

- 变更 ID：`CHG-2026-10-26-AUTH-VISUAL-FORM-CONTROLS`
- 触发：用户要求登录页左侧不再放文字说明，改用 SVG/已有素材；并统一全站输入框样式（当前控件高度/字体/边框不一致，视觉突兀）。

## 1. 登录/注册页左侧

- 移除左栏全部文案（品牌主张句），改为**项目已有品牌场景渲染图**
  `public/midea-ai/midea-finale-city.png`（2906×1480），`object-fit: cover` 填充左栏，叠加底部轻微暗角保证右侧卡片边界清晰。
- 左栏为纯装饰：`aria-hidden`，不承载信息；移动端（<1024px）隐藏，仅保留表单卡片。
- 品牌锁定（Midea Overseas / AI Content Studio）保留在表单卡片顶部，作为唯一品牌标识。

## 2. 工作台表单控件（统一规范）

问题根因：`AppShell.module.css` 多轮叠加的全局规则把控件拆成了不同外观——`select` 被强制 `height:42px; line-height:40px`，文本输入 `font-size:10px`，按钮/输入混用不同内边距；素材库仍暴露原生文件选择框（"Choose Files / No file chosen"）。

统一后的规范（在 AppShell 最后一层覆盖，作用于 `.main` 内全部控件）：

| 控件 | 规范 |
|---|---|
| 文本输入 / 下拉 / 文本域 | 高度 34px（文本域 min 68px 可拉伸）；圆角 8px；1px 半透明描边；半透明白底 + 内高光；字号 11.5px；`placeholder` 弱化 |
| 下拉 | `appearance:none` + 统一 10px chevron，右侧留 28px；宽度 100% |
| 焦点态 | 金色描边 `#b8914b` + 3px 柔光，无默认 outline |
| 禁用态 | 60% 不透明度 + not-allowed |
| 文件选择 | 素材库改为自定义控件：胶囊/8px 圆角「选择文件」按钮 + 已选文件名（最多 2 个 + 数量），隐藏原生控件；全局保留 `::file-selector-button` 兜底样式 |
| 复选/单选 | 14px，金色 accent-color |

## 3. 验收

1. 登录/注册页左栏无文字，显示品牌场景图；移动端仅表单。
2. 素材库不再出现原生文件控件文案；选择文件后显示文件名。
3. 工作台内输入框/下拉/文本域高度、圆角、描边、焦点一致；下拉不再异常高。
4. `typecheck` / 全量测试 / 生产构建全绿；Playwright 巡检登录、素材库、风格迁移、Icon Design 等页面无 console/page error。
