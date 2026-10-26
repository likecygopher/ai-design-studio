# 发现与决策：美的海外产品营销 AI assistant 演示平台

## 输入材料
- `需求/【赛道B】Midea Overseas Product Marketing AI assistant Platform 07-02.pdf`：赛道 B 演示任务要求(任务一/二/三 + 平台五大能力),优先级最高。
- `需求/【赛B】品牌与产品资料清单.pdf`：品牌 VI、SPACE Master 冰箱与 MEGA 烤箱资料、POP/PDP 模板样式、素材图。
- `需求/ai_assistant brief.pdf`：项目 brief(总体目标与业务背景)。
- `需求/赛道A.pdf`：仅背景参考,不在演示范围。

## 关键需求发现
- 任务一:6 张白底多角度、手机照转棚拍标准图、SKU 颜色变体、场景延展。
- 任务二:3 种风格迁移、3 组 POP 模板应用(写实贴装)、动态 PDP 长图(卖点可排序/增删/换图)、视频方向。
- 任务三:烤箱新品类基础物料复用验证。
- 平台能力:结构化输入承接、国家/语言本地化、输出可标注(产品/国家/语言/模板/版本)、资源消耗可解释、素材不限品类(用户上传)。

## 品牌/素材发现
- 品牌蓝取 #005EB8 近似,VI 页已提取(`public/demo-assets/midea-brand-vi.png`)。
- PDP 长图模板骨架:Brand 头 → KV → 卖点段(黑标题条+窄灰文字条+大图)× N → More Features 圆形图标区 → Specification 表 → 品牌尾。参考图 `public/demo-assets/pdp-template-reference.png`。
- 产品图已从 PDF 提取入库:冰箱正面/开门/手机实拍(贴便签)、烤箱正面/开门 45°、门店实拍;微信 4096px 高清渲染图压缩至 2048px。

## 技术决策
| 决策 | 理由 |
|------|------|
| Next.js 单机 BS 架构,本地文件存储(public/ + data/ JSON) | 现场仅一台可联网笔记本,无云服务器;评委浏览器访问 localhost |
| 图像模型 gpt-image-1,fetch 直连(弃用 openai SDK),支持 `OPENAI_BASE_URL` 中转 | 国内网络需中转;规避 SDK 版本对 images/edits 多图序列化的兼容风险 |
| 有参考图走 `images/edits`(产品图 + POP 平面稿),无参考图走 `generations` | 生成结果必须与用户上传的产品一致,这是赛题核心要求 |
| POP/PDP 平面稿用本地 SVG 模板引擎确定性渲染,0 模型调用 | 可控、可复现、可解释消耗;只有写实场景图消耗模型调用 |
| POP 平面稿由前端 canvas 栅格化成 PNG 再送模型 | OpenAI edits 不接受 SVG;免服务端原生依赖(sharp/resvg) |
| `/generated`、`/uploads` 用路由处理器服务运行时文件 | `next start` 只服务构建时已存在的 public 文件,否则生产模式演示全 404 |
| 台账页 `force-dynamic` | 静态预渲染会冻结现场生成记录 |
| manifest 写入用 promise 队列串行化 | 并发上传时读-改-写竞态会丢记录 |

## 已知风险与对策
- **演示前必须用真实 OPENAI_API_KEY 实测一次全链路**(gpt-image-1 需组织验证;不可用时换模型或配置中转)。
- `openai` npm 包已不再引用,但 pnpm store 版本不匹配暂未从 package.json 移除(无害)。
- 现场断网/配额异常:勾选 Mock 保底即可继续演示,降级原因会显示在界面上。

## 资源
- 工作目录:`E:\workspace\nato-studio\AI设计赛道`
- 运行手册:`docs/demo-runbook.md`

## 2026-07-14 PDP 画布交互重构
- 当前 `PdpEditor` 在画布上方用逐行表单完成排序、启停、新增和配图，下方仅展示服务端导出的 SVG 图片；这不满足“直接在下方交互”的要求。
- 参考图表达的是横向树结构：第一列 Brand，第二列 KV，第三列 2 个 SP1，第四列 3 个 SP2，后续列容量递增；所有列顶部对齐。
- 卖点优先级由左到右递减，因此默认块尺寸也应逐列递减。拖动后需要保存自由坐标，而不只是交换数组顺序。
- 画布内需要完成块选择、文字编辑、启停/删除、配图替换和新增卖点；产品、国家、语言等文档级设置可保留为紧凑工具栏。
- 最终导出必须复用画布布局状态，而不是再次按服务端固定规则重排。
- 画布采用固定逻辑尺寸并按容器缩放显示，拖动坐标在逻辑坐标系中保存；这样桌面、移动端和最终 SVG 使用同一套坐标，不会因 CSS 缩放产生导出偏差。
- Canvas 负责高频选择与拖动，所选块的文本和图片属性放在紧邻画布的检查器中；这仍属于“在下方直接交互”，同时避免在位文本输入破坏 Canvas 的拖拽手势。
- 服务端只接受经过 `parsePdpCanvasLayout` 清洗的布局数据，未知块、越界尺寸和非法坐标会被规范化后再渲染，避免客户端请求直接污染导出 SVG。

## 2026-07-14 POP 产品类型 Canvas 重构
- 冰箱模板固定为 4 组：Main Sticker - USP（2 个变体）、Main Sticker - Feature（2 个变体）、Inner Sticker & Display（3 个变体）、Side Sticker（1 个变体）。
- 烤箱模板固定为 6 组：Main Sticker（2 个变体）、Corner Sticker（2 个变体）、Inner Display（1 个变体）、Wobbler（1 个变体）、Body Sticker（3 个变体）、Top Sticker（1 个变体）。
- 参考图中的蓝色区域是可编辑文字区，灰色区域是用户图片槽；它们属于 Sticker 内部内容，不是可自由拖动的独立块。
- Canvas 应展示当前产品类型的完整模板总览并维持资料中的固定分组布局；点击某个具体变体后，只编辑该变体。
- AI 写实贴装调用必须使用当前选中的单个变体平面稿，而不是把整张模板总览或同组所有候选方案送入模型。

## 2026-07-15 烤箱 POP 参考图决策
- Corner Sticker 是一个双面工程结构，不是两个互斥方案；因此产品选择器只暴露一个 Corner 模板。
- Main B 底部三段 bullet 不能用三个普通胶囊；第 2/3 段的左缘必须用凹圆弧贴合前一段的右圆头。
- Body B 的蓝弹与灰图等高并从图片右边缘开始；Body C 的蓝弹从图片右边缘开始且垂直居中。
- Wobbler 是两段连续竖排内容，每段都有 Headline Space 和 Subheading Space；Top 的文字弹与灰图顶部对齐。

## 2026-07-15 烤箱 POP 第二轮几何决策
- Main Sticker 参考图是横向约 3:2，不是 4:5 竖版；模板元数据、SVG viewBox 和 Canvas 预览框必须同步修改。
- Wobbler 的蓝条是图片底部覆盖层，不是排在图片之后的独立行。
- Inner Display 蓝条必须从灰图左边开始，宽度约为灰图 60%，且不能覆盖到图片底边。
- Body B/C 的整体长宽比会直接影响 Canvas 预览，不能只调内部坐标而保留过高的 SVG 画布。

## 2026-07-16 Seedream 图像与 Seedance 2.0 Fast 接口确认
- Seedream 图像统一使用火山方舟 `POST /api/v3/images/generations`；默认模型为 `doubao-seedream-5-0-lite-260128`，支持文生图、参考图编辑和多图输入。
- 图片生成接口的 `image` 字段支持 URL 或 Base64，因此本地素材无需部署公网文件服务器即可传入 Seedream 图像模型。
- 产品视频使用 `doubao-seedance-2-0-fast-260128`；通过 `POST /api/v3/contents/generations/tasks` 创建异步任务，并通过 `GET /api/v3/contents/generations/tasks/{id}` 轮询。
- Seedance 成功响应在 `content.video_url` 返回成片地址；任务状态为 `queued`、`running`、`succeeded`、`failed` 或 `cancelled`。
- 产品视频固定 15 秒、16:9、720p；提示词以用户给出的 Hero Product Film 文案作为单份可编辑默认值，产品参考图作为唯一 `reference_image` 输入。
- 方舟统一使用 `ARK_API_KEY` 与 `ARK_BASE_URL`；图像和视频模型 ID 均允许通过环境变量覆盖，便于账号实际开通的模型版本不同。
## 2026-07-17 Seedance 1.5 Pro 与 SKU 局部替换约束
- 火山引擎公开资料给出的 Seedance 1.5 Pro 模型 ID 为 `doubao-seedance-1-5-pro-251215`；该版本支持 2–12 秒，因此产品 Hero Film 的接口时长改为 12 秒，创意提示词仍保留完整三镜头叙事目标。
- SKU 功能必须保持上传驱动、产品类型无关；空气炸锅、控制面板、把手和包边只作为默认提示词示例，不能写成固定业务枚举。
- 参考部件替换要求产品图和部件图缺一不可，二者按 image 1 / image 2 顺序送入图像编辑模型。
- 颜色与样式替换共用区域选择器：画笔、橡皮、清空和基于像素连通性的点击智能选区；选区必须导出真实 PNG alpha 蒙版并传入服务端。
- OpenAI 图像编辑使用原生 multipart `mask` 字段；Seedream 当前接口无独立 mask 字段，因此将蒙版作为额外参考图，并在提示词中明确蒙版语义。
## 2026-07-17 SKU Canvas 长宽比问题
- 当前 SKU 产品图 `图片1.png` 的原始尺寸为 355×334，宽高比约 1.063。
- `.canvasStage` 同时使用 `width: 100%`、动态 `aspect-ratio` 和固定 `max-height: 680px`；容器宽度大于按比例允许的宽度时，高度被单独截断，CSS 最终尺寸不再遵循原图比例。
- 修复方式是按图像比例计算“680px 高度对应的最大宽度”，让画布缩小并水平居中；底图仅在尺寸分析完成后与 Canvas 同步渲染。
# 2026-07-17 Icon Design VI 模板应用

- 现有图像服务已支持按顺序传入多张参考图，适合固定约定为：image 1 色彩 VI、image 2 Icon VI、image 3 源 Icon。
- VI 解析属于视觉语言理解，不应由前端拼接固定文案冒充识别；新增独立视觉解析 API，并保留默认模板与人工编辑能力。
- 六类输出应拆成独立图片：四种颜色版本为方形 Icon 资产，两种图文版式分别为方形上下排版和横向左右排版。
- Icon Design 与具体产品档案无关，使用独立工作区资产 ID 持久化，不在页面重复国家与语言控件。
- 生产构建确认 `/icon-design` 为静态页面，两个 Icon Design API 为动态路由；本地生产服务上的页面与参数校验均正常。
- 未在没有用户 VI 与源 Icon 的情况下触发付费模型调用；真实图片生成需要在页面上传三张参考图后执行。
## 2026-07-18 PPT Keywords 风格迁移资料
- 图像范围固定为 7 套关键词模板：拉美热带现代、Lab 建筑实验室、高端通用、北欧编辑感、北欧家居、日式暗场展陈、日式明场展陈。
- 明确排除视频内容：拉美/Lab/高端资料中的 TVC、VIDEO 和产品视频页；北欧第 6 页起的视频脚本与静帧工作流；日式第 16 页起的视频工作流。
- 拉美关键词页为热带现代主义场景拼图，核心视觉是暖米色、森林绿、藕粉、胡桃木、自然采光和真实人物互动。
- Lab 关键词页为黑白灰建筑厨房拼图，核心视觉是纯白发光空间、石墨灰体块、黑色金属、实验室秩序和精密工业设计。
- 风格参考不应使用带大段文字的整页截图；每套从关键词页提取 3 张代表性原图，与用户产品图按固定顺序作为多图参考输入。
- 生成规则：用户输入或选择 Keywords，系统匹配/确认风格模板；每个选定风格固定产生 3 张互有构图变化的图像，产品外观与结构必须保持一致。- 高端通用关键词页以建筑化开放厨房、不锈钢中岛、木色/米白/暖棕与下午侧后方阳光为主，整体低饱和、沉稳、电影感，适合作为通用高端生活场景。
- 北欧编辑感关键词页不是完整厨房，而是雾蓝、淡粉橘、香槟色的柔和渐变和轻盈时尚编辑构图；参考图强调空气感、梦幻感和人物/产品局部关系。- 北欧家居关键词页强调现代丹麦高端住宅、浅色天然橡木、暖白/米色、倾斜屋顶、冬季雪景漫反射和舒适真实的生活尺度。
- 日式暗场展陈关键词页是纯黑无边空间、三面暖白推拉门式发光墙、深色反射地面和中轴展陈构图；人物与道具必须极少，产品保持唯一视觉核心。
- 日式明场展陈不是暗场的提亮版本：它使用明亮无边空间、推拉木门式墙体、正面近对称构图与大量留白，应作为独立风格模板。
- 北欧住宅关键词页只有 2 张独立有效参考图，日式明场有 4 张；模型输入保留 PPT 实际有效资产数量，不复制图片凑数。
- 生成服务的参考顺序必须可追溯：用户产品素材 ID 在前，`style-reference:*` 资产 ID 在后；成本台账同步记录两类来源。
- 用户 Keywords 优先于预设默认词，匹配词只负责选择底层 PPT 风格系统，不覆盖用户输入。
## 2026-07-21 首页紧凑玻璃工作台
- 参考图的主窗比例约为视口宽 72%、高 76%，桌面端采用 72vw × 76dvh，并分别限制最大 1180×720px。
- 指定的绿色、橙色和浅蓝视觉图已作为项目静态资产，分别用于前两个主功能卡和日期/天气卡。
- 顺德天气由服务端 /api/weather 调用 Open-Meteo，坐标为 22.8057, 113.2934，前端每 10 分钟刷新且失败时显示 Unavailable。
- 底部十个工具卡使用原生横向滚动；黑色 range 滑点和滚动位置双向同步。
- 所有卡片继续继承首页玻璃颜色、透明度、模糊和饱和度 CSS 变量。
## 2026-07-21 全站紧凑玻璃外壳
- 首页和功能页现在共用 72vw × 76dvh、最大 1180×720px 的桌面工作台，以及 190px 的侧栏尺寸。
- 子页导航根据 usePathname 高亮当前入口，品牌上标统一为 9px 常规字重，导航统一为 11px。
- 两条窄线性流光沿左上至右下轨迹循环，错开半个周期；减少动态效果偏好下停止动画。
- 子页文字元素上限统一为 11px，表单和按钮为 10px；网格与表单采用 16px 列距和 18px 行距。
- 普通玻璃按钮改为鼠尾草半透明底和深色文字；主操作、删除和选中状态分别使用深绿、浅红和暖色规则，避免浅灰底白字。

## 阶段 16 定位补充（2026-07-21）
- 风格迁移末项误选来自 `matchStyleTransferPreset` 的关键词计分：两个日式预设共享词较多，显式点击后仍可能按排序回到较早的暗场预设。
- 风格迁移的 `minmax(680px, ...)`、七列最小宽度和三列工作区最小宽度按浏览器宽度响应，而不是按 AppShell 内容宽度响应，导致壳层缩小后内部横向溢出。
- POP Canvas 每次内容变化会重新生成并加载全部方案的 SVG 预览；图片替换还会预取所有方案素材，这是整块画布卡顿的直接原因。
- PDP Canvas 已采用居中裁切绘制，导出仍保留横向树布局；需把交互布局与纵向导出布局分离。
- 共享图片编辑器可在上传前输出已居中裁切的 PNG，使 POP/PDP 后续渲染只消费处理后的文件。
- 定位时曾使用与 PowerShell `Invoke-History` 冲突的 `R` 函数名，并误查不存在的 `PdpCanvasEditor.module.css`；现已改用实际的 `PdpEditor.module.css` 与 `PdpEditor.test.tsx`。
## 2026-07-21 阶段 16 实现结论
- AppShell 对所有 source/result/output/preview 图像卡统一拉伸和内部行轨道，上传图与三视角结果不再因内容高度不同而错位；全部 `select` 被约束在父容器内并使用左侧垂直居中、单行省略。
- 风格迁移显式点击预设时以预设 ID 为准，只有用户手工修改 Keywords 后才重新匹配，避免“日式明亮展厅”被共享关键词回退为暗场。
- POP 预览改用按模板 ID 和内容签名缓存，只重建当前选中且内容变化的方案；其他方案沿用缓存图，避免替换图片时整板重绘。
- POP/PDP 共用上传前裁切弹窗：默认居中 cover，支持拖动、缩放、重置和按目标灰框比例输出 PNG。
- PDP 交互画布品牌块固定使用 `public/pdp/midea-brand-no1.png`，品牌说明在检查器中可编辑；服务端导出将品牌、KV、卖点、More Features 和 Specification 统一转为 920px 宽的纵向长图。
- Icon Design 仅保留两张紧凑 VI 预览，提示词模板继续内部使用但不再向用户开放编辑。
## 2026-07-22 新一轮界面与 POP 调整
- 用户要求恢复中性文字色，蓝色仅保留在生成按钮的实心视觉层次中。
- 外框默认边框改为灰白三段渐变，主窗与当前菜单分别使用用户给定的透明度、角度、宽度和白色流光。
- 首页临时玻璃/边框参数入口需要隐藏，但底层设置与持久化能力保留。
- POP 不再调用 AI 生成写实贴装图；改为在指定冰箱产品图上直接叠加当前 Sticker，并让用户拖动与缩放后导出。
- 按既有要求，本轮不打开或控制本地浏览器。
## 2026-07-22 Stage 17 live findings
- Homepage still renders GlassTuner and EdgeTuner in the top-right action row; hide both triggers while preserving the shared settings hook/CSS variables.
- Homepage structure already separates hero, three feature cards, and quick-tool scroller, so requested 4:3 and 3:4 geometry can be handled in CSS without changing navigation data.
- SKU generation overflow is caused by the top control band keeping the model select and long generation button in one rigid row; use a shrinkable grid/minmax layout and cap the action width.
- POP still submits to /api/pop/generate-scene; replace that result flow with an in-browser refrigerator sticker compositor and PNG export.
- Existing edge defaults are blue and stored under the original localStorage key; use the requested neutral defaults and a versioned key so old blue defaults do not override them.

## 2026-07-22 CreativeStudio AI 封面页迁移
- 源目录 `E:\workspace\nato-studio\CreativeStudio-AI` 是独立 Next.js 项目。
- 可迁移代码集中在 `components/JobyInspiredHero.tsx`、`components/MideaAIDraft.tsx`、`app/midea-ai/*`。
- 必要静态素材位于 `public/midea-ai/`；源项目的 `.next`、`node_modules`、缓存与日志不得复制。
- 目标路由结构暂定为 `/` 封面页、`/studio-home` 现有工作台；Start now 使用 Next.js 客户端导航进入工作台。

- 分支确认：`codex/cover-page` 已创建并已切换；工作区原有未提交改动继续保留。
- 当前根路由 `app/page.tsx` 仅作为 `GlassHomeStudio` 的轻量入口，适合将原工作台迁到 `/studio-home`，再由根路由承载封面。

- 源封面是四段完整滚动体验：视频首屏、16 张视觉拼贴、三步工作流、末尾 Start now。
- 可移植素材共 20 个文件、约 55.3 MiB，其中视频约 39.1 MiB，单文件低于 GitHub 100 MiB 限制；只复制实际引用素材，不复制缓存、node_modules、.DS_Store 或 extra 图片。
- 源 CSS 类名均使用 midea-/joby-/brand- 前缀，与当前业务组件无命名碰撞；保留独立路由样式即可。

## 2026-07-22 封面边界 AI 聊天入口
- 聊天框应放在 `CoverHero` 与 `brand-platform` 之间，用零高度边界锚点和负向位移覆盖蓝/白分界；不使用 fixed/sticky，因此继续下滚会自然离场。
- 普通聊天复用 `OPENAI_API_KEY`、`OPENAI_TEXT_MODEL`、`OPENAI_BASE_URL` 与现有 `createProxyDispatcher/fetchOpenAi` 网络实现。
- 页面跳转采用服务端白名单映射；带“打开/进入/跳转/我要做”等动作意图时直接返回目标路由，避免模型生成任意 URL。
- 快捷入口采用 POP、PDP、风格迁移、产品视频四个高频页面，第五个省略号按钮仅作视觉占位。

## 2026-07-22 Brand source-code section
- The supplied `hero video.mp4` is 1920x1080, 30 fps, 38 seconds, and 3,760,588 bytes, so a native 16:9 frame avoids crop distortion.
- The new section remains at `id="workflow"`, preserving existing anchor behavior while replacing the old three-card content completely.
- Both Start Now entry points resolve to `/studio-home`; the new video is served from `/midea-ai/brand-source-hero.mp4`.

## 2026-07-22 Alternating execution demos
- All three supplied demos use a 4:3 frame, allowing one stable visual-card geometry without cropping or per-row layout exceptions.
- The new section preserves the requested order: demo1 left, demo2 right, demo3 left; the surrounding text alternates accordingly.
- The three copied assets total 49,955,517 bytes and each source/target SHA-256 hash matches.
- Runtime HTML confirms the section occurs after `Where ideas become the work` and before `Start with a signal.`.
## 2026-07-22 POP transparency and studio-home header
- The visible white sticker box came from both the SVG root rectangle and the PNG rasterizer background fill; both layers must preserve alpha.
- White text, logos, strokes, and image-slot content remain unchanged because only the full-canvas root rectangles were made transparent.
- The studio workbench can be much narrower than the viewport, so a CSS container query is more reliable than a viewport-only media query for the top-right controls.
- The focused POP template and studio-home tests pass. One older PopCanvasStudio test still expects a removed image-model selector and fails before reaching generation; this is unrelated to the transparency change.

## 2026-09-26 Demo brief assessment
- Source: `需求/demo修改brief.pdf`, one page, 1920x1761 points. PDF text and rendered visual inspected; mockup labels still need detailed crops.
- The brief prioritizes one-click style transfer; white-background angles, localization, and POP can be phased by available time.
- It asks for consolidated left navigation, personalized tools behind the upper-right user-settings icon, and retention of current demo typography, spacing, and dashboard size.
- Current code uses a flat 13-entry AppShell navigation. Style transfer chooses an existing product asset and one preset, then launches three client-side parallel output requests; its API fixes size to 1536x1024.
- Mockups appear to add variable output quantity, contextual material selection, selectable white-background angles and output sizes. Detailed labels will be verified before final assessment.
- No paid generation, app-code edits, or assumptions about live model quality have been made.
- Detailed visual review completed for all four mockups. Style transfer adds library/local upload, 1/2/3 output selection, preset/style-learning tabs, a read-only scene summary, and an all-presets entry. Current presets number six, not the older memory's seven; mockup names (including technology/future) do not map exactly to current IDs.
- White-background mockup uses up to three same-product references, selectable front/left-45/right-45/right-90/back-180/top views, background controls, and 1:1/4:5/16:9/custom pixel sizes. Current domain only supports open/closed source states and three fixed views per source, with fixed white background and natural shadow in its prompt.
- Localization already supports batch local uploads (20 images, 30 MB each) and model-based text replacement. Missing from that workflow: material-library/bundle selection and explicit pairing of clean base images; image contents are not separated into editable OCR/text layers in the inspected flow.
- POP already has refrigerator/oven template sets, grouped variants, text/image editing, and local sticker placement/export. Current selection is one global template, not one variant per group for a full output bundle. Legacy AI-scene code remains but no visible model/generate control is rendered in its toolbar. A local compositor uses a fixed demonstration refrigerator image, so an oven showcase must not be assumed to use the selected oven as its placement base.
- Homepage and subpages define their own navigation separately. Personalization controls currently live on the homepage; country/language settings live in LocalizePanel. Consolidation needs shared navigation/settings components, not merely moving one icon.
- Product-identity locking is implemented as prompt instructions, not a deterministic geometric guarantee. Back/top views and image-wide text rewriting require sample-based acceptance tests; do not promise exact identity or typography from static code review.
- Fresh baseline: TypeScript `--noEmit --incremental false` exited 0. The 12 selected test files ran 42 tests: 41 passed, one failed at `PopCanvasStudio.test.tsx:239` because it expects the non-rendered image-model selector. This was reproduced without any business-code edits.
- Recommended phase 1: shared grouped navigation and user settings plus a complete preset-based style-transfer workflow (asset selection/upload, output quantity, scene summary, results/download and failure handling). Preserve non-priority functionality and current frame/type scale.
- Scope boundaries: style learning is not defined beyond a tab in the brief; reference-image style extraction/storage is distinct from model training. Brand-management and task-record headings are not specifications for full new enterprise subsystems. Scene output/result/error views are absent from the brief and need to be completed as part of an operable workflow.
- Rough planning estimate, not a delivery commitment: 3-5 person-days for the prioritized shell plus preset-style workflow; another 6-10 person-days for the other three workflows and regression work, assuming existing provider interfaces, prepared sample assets, and no model training or production-grade DAM. Style-learning details require a separate estimate.

## 2026-09-26 Approved implementation direction
- Reuse existing routes and APIs. Navigation groups: creation tools, assets/products, brand tools (existing Icon Design), and records (existing cost/output ledger). Do not create dead brand-management/task-system links.
- The compact glass dashboard is the visual reference: charcoal #24282c, secondary #50575d, pale glass #f0f5f7/#ffffff, selected preset accent #d8b46a, existing generation-action styling. Preserve current font stacks and shell geometry; use a five-card image rail with an all-presets dialog, not the old three-column technical control workspace.
- User settings owns background selection/upload, existing glass/edge controls, and default market/language; operation-specific product/model/count remain on the work page. Custom wallpapers should survive route changes and reload without server uploads.
- One-click transfer uses the current six real presets, supports 1/2/3 outputs, locks inputs while running, snapshots request parameters, and retries only failed outputs. Advanced keywords refine the explicitly chosen preset instead of silently rematching another style.
- Local upload reuses product creation and upload APIs with explicit product/category fields. No paid recognition/generation is triggered by selecting or uploading a file.
- Shared settings created a new same-page market update path. PDP previously read settings only on mount, while export read current server settings; the implementation now broadcasts successful saves and updates only the displayed market, preserving the draft. It ignores stale initial reads after a successful update.
- Existing AppShell CSS uses broad important rules for buttons and typography. The new style-transfer page has scoped overrides for its title, selected count/preset and dark generation action; shared navigation owns its edge/glow variables so the existing user controls continue to work.
- Verification boundary: UI and API request construction are verified with mocked providers. Real image quality, product-identity fidelity, provider availability, and charges have not been exercised. Style learning remains explicitly unavailable; other production workflows retain their existing scope.

## 2026-09-26 Multipart 400 evidence
- Official image-edit examples still use repeated `image[]` parts: https://developers.openai.com/api/docs/guides/image-generation . The failing pipeline uses that supported field name.
- Runtime is Node 24; actual provider targets api.openai.com through the configured local HTTP proxy and uses gpt-image-2. Credentials were never printed or changed.
- Both ASCII and Chinese filenames in the existing hand-built multipart decode correctly in a local standard parser. Tiny-image upstream validation accepted both the manual ASCII body and the standard FormData body and returned the intended invalid-model error. The standard Unicode body also reached model validation; manual Unicode probes encountered proxy TLS resets, so they do not establish a filename defect.
- Current product PNG is valid, 4096x4096, about 4.8 MB. The premium style references are valid JPEGs totaling about 315 KB. Two old probe assets contain non-image bytes, but these are not the active product reference.
- An attempted real-material validation was rejected before execution by automatic safety review because the current message did not explicitly authorize uploading these assets to OpenAI. No actual material was sent by that attempt. Requested permission separately; continue synthetic-only probes meanwhile.
- User subsequently authorized the bounded real-material probe. Manual Unicode, standard FormData Unicode, and manual ASCII requests using the actual 4 files all returned the intended invalid-model error; no image was generated. These source-level probes did not exercise the production bundle.
- The production Next.js route was then run against a loopback-only stub with a fake key and invalid model. Its exact 5,133,846-byte body failed standard multipart parsing locally even though the first and final boundaries were correct. No external request was made in this reproduction.
- Root cause: in `.next/server/chunks/5676.js`, the SWC optimizer folded the file-header array's `.join("\r\n")` into a template containing LF-only newlines. JavaScript normalized these literal line endings, corrupting the required multipart CRLF framing. Text-field framing remained correct.
- A regression test compiles and minifies the real provider with the installed Next.js SWC pipeline, then parses its output and compares binary files/mask. Before the fix it failed with `TypeError: expected CRLF`, matching the production-route failure.
- The bounded fix replaces only the file-header array/join with an explicit CRLF template, preserving fields, image bytes, filenames, model, proxy, and provider behavior.
- After rebuilding, the exact Next.js route request parsed correctly via both direct fetch and the bundled undici HTTP-proxy path. All four file hashes matched the originals; model, 2337-character preset prompt, and 1536x1024 size were preserved. The body grew by exactly 16 CR bytes, restoring the four lost CR characters in each of four file-part headers.
- The same rebuilt request, with the deliberately nonexistent diagnostic model, was sent once to the configured OpenAI endpoint under the user's authorization. It returned `invalid_value`, `param: model`, and `The model '__codex_multipart_validation_only__' does not exist.` (request ID `req_9a4be048dd4a473583f83dc336bf3efc`), not `invalid_multipart_form_data`. This confirms the format boundary, not actual generation quality or valid-model success.
- The rebuilt loopback/upstream format harness exited 0 and verified all existing data JSON files were unchanged. No image-generation request using a valid model was initiated by the assistant.

## 2026-10-23 Remaining brief recheck
- The workspace is clean at commit `87b8f02`; the prior navigation/settings/style-transfer and multipart fixes are now committed. Rechecked the one-page PDF text and the three existing readable workflow crops.
- White-background mockup: 1-3 references of the same product, six selectable angles (front, left/right 45 degrees, right side, back, top), background removal/white background/natural-shadow controls, 2000x2000 / 1600x2000 / 1920x1080 / custom output dimensions, and an existing model selector. Current implementation instead has closed/open input slots and three fixed outputs per slot; changing/removing those slots currently deletes stored assets. The redesign must separate input deselection from library deletion and avoid mixing inconsistent product states.
- Localization mockup: single material or a material bundle, optional per-material clean-background pairing, one target language applied across the bundle, model selection, and output review. Current UI accepts only local-file batches, has no bundle/library selection or base-image input, and clears successful results on every rerun. The current server accepts exactly one uploaded image and already restores original pixel dimensions.
- POP mockup: one selected variant per configurable group plus all fixed groups, expandable editing, selected product, and whole-set generation. Current UI maintains a single global selected template, while its local compositor uses the fixed `/pop/pop-sticker-product.png` instead of the selected product photo.
- A material behavior conflict needs a user choice: the July 22 decision explicitly removed AI photorealistic POP generation in favor of local drag/resize composition; the September brief mockup shows a model selector and Generate POP button. Existing `generateScene` code remains but its controls are not rendered. Recommend deterministic template rendering and local placement with whole-set export; alternatively restore AI placement as an explicit operation. Do not silently switch the provider behavior based solely on the mockup.
- Brief typography, spacing, and compact dashboard remain tied to the current demo. No new style-learning/training requirements are specified in the remaining three mockups.
- User approved keeping POP local-only: do not restore AI placement or a misleading model selector. Implement the remaining three existing workflows, with one choice per POP material group and deterministic export.
- Visual direction: retain current wallpaper and compact glass dashboard, charcoal headings, quiet gray helper text, pale-gold selected borders, dark pill actions, and responsive stacked panels. Use the PDF layout as authority rather than introducing a new visual system.
- First POP browser render confirms independent per-group controls and actual product photo. Existing AppShell global important rules override the initial page heading and main action; requested local scoped overrides matching the completed style-transfer page, not a shared-shell redesign. A favicon 404 and two existing CSS alignment warnings appeared; no workflow runtime exception.

## 2026-10-26 SDD commercial platform
- `origin/main` PR #2 intentionally replaced the POP AI-scene flow with local composition (see 2026-07-22 decision), so the WIP platform patch that routed POP through the job queue was obsolete: conflict resolved in favour of upstream and the scene-job integration dropped from `PopCanvasStudio`.
- Local platform layer under `src/platform/**` was uncommitted WIP from a previous session; it is now completed and documented rather than re-designed.
- NextAuth v5 names the session cookie `authjs.session-token` (HTTPS: `__Secure-authjs.session-token`). Custom middleware must pass `secureCookie` accordingly or production (TLS) deployments appear unauthenticated and redirect-loop to `/login`.
- Next.js route files may only export HTTP handlers/config: helper exports in `app/api/**/route.ts` fail `next build` type checks; download-header helpers were moved to `src/platform/storage/download-headers.ts`.
- Static `/uploads` and `/generated` route handlers served any user's file by URL; they now enforce `path[0] === userId || admin`. `/api/outputs` was scanning the entire generated directory and now reads the per-user asset manifest.
- Legacy baseline failures were real drift, not flaky tests: cover-page chat container class, icon-design multi-reference prompt wording, PDP brand statement pass-through, and warranty copy fixture. All four fixed at the source of truth.
- Worker heartbeat must be sent before the first poll, otherwise `/api/ready` flaps 503 immediately after deploy; the runtime now heartbeats on start and on an unref'd interval.
- Verification used a local production server plus real PostgreSQL; no paid AI provider calls were made (all generation paths mocked or cancelled).

## 2026-10-26 Admin account management & auth UI
- NextAuth JWT strategy cannot revoke a session by itself. Adding `User.authVersion` (bumped on password reset/change) plus a DB re-check in `getSessionUser()` gives immediate revocation and disabled-account enforcement at the cost of one primary-key lookup per authenticated request; this is the documented P1 cache point.
- RSC pages cannot clear cookies, so an invalidated session must be routed through `/api/auth/expire` (clears `authjs` session/csrf/callback cookies, redirects to `/login?expired=1`). Middleware must allow `/login?expired=1` even when a stale token is present, otherwise `/login` bounces back to `/studio-home` forever.
- Route handlers behind `next start` can see an internal `request.url` host (e.g. localhost); redirects must be built from `x-forwarded-host`/`x-forwarded-proto` (or Host) to avoid sending browsers to an internal address in production.
- `AppShell.module.css` contains legacy broad `!important` button overrides inside `.main`; page-specific modules must opt in with equal-or-higher specificity (`... [type="button"]` + `!important`) to keep the dark-pill action style. Documented in `AdminUsers.module.css` / `AccountSecurity.module.css`.
- The admin user table needs `min-width: 720px` (not 860) to fit the 16:9 studio workbench without horizontal clipping at 1440×900; row action labels were shortened to "改密" while aria-labels keep the full description.
- Headless Chrome with `--window-size=390` enforces a larger minimum layout viewport and produced a false "mobile overflow" signal; Playwright Chromium with an explicit 390×844 viewport (or the CSS max-width fix) is the reliable check.

## 2026-10-26 Product-facing copy cleanup
- User judged explanatory UI copy as "prototype sketch". Adopted a copy policy: operational UI carries only labels, states, constraints, errors and empty states; product intros/tutorials/marketing/disclaimers move out of the interface (docs or collapsed help).
- Constraints are kept but capped to one line (e.g. `8 位以上，含字母与数字。`), and destructive actions keep their consequence (`重置后该用户需重新登录。`) — these are product requirements, not explanatory prose.
- Removed decorative English eyebrows (`PRODUCT STICKER COMPOSITOR`, `PDP CANVAS EDITOR`, `BRAND ICON STANDARDIZATION`, `AI CONTENT STUDIO` inside every dialog) and marketing bullets on auth pages; kept the brand lockup and one-line brand statement.
- Page-level intro paragraphs were spread across inline styles in `app/**/page.tsx` and component headers (`styles.hint`, inline `<p>`); the cleanup had to touch both layers. Empty states (assets/costs/jobs) were added or kept so removed copy does not leave blank panels.
- Cost ledger table headers were localised and empty states added; this keeps the page data-first instead of documentation-first.

## 2026-10-26 Auth visual + form controls
- The login left column now uses an existing brand render (`public/midea-ai/midea-finale-city.png`) instead of copy; it is decorative (`aria-hidden`) and hidden below 1024px, while the brand lockup lives in the form card so mobile keeps identity.
- Input inconsistency came from successive `AppShell.module.css` phases: a late rule forced `select` to 42px height / 40px line-height and text inputs to 10px font, while each component added its own paddings/borders. Fixing it required one final, higher-specificity `.main` layer rather than editing every component.
- `input[type=file]` cannot be reliably restyled across browsers (native "No file chosen" text); the asset library now renders a custom button + filename summary and hides the native control. Other components already hid their file inputs inside custom labels.
- Unified control tokens: 34px height / 8px radius / 1px translucent border / glass fill / 11.5px text / gold focus ring; textareas keep a 68px min-height and vertical resize; checkbox/radio use a 14px gold accent.

## 2026-10-27 Extensible provider registry
- Hardcoding two providers did not scale. Replaced with an `AiProvider` registry keyed by implementation *channel* (`openai-compatible` / `ark`); arbitrary OpenAI-compatible vendors (DeepSeek/Kimi/Qwen/OpenRouter/custom gateways) share one channel, while ARK keeps its Seedream/Seedance specifics.
- Runtime code still reads `process.env`, so activation is implemented as "first enabled provider per channel (priority, then createdAt)" projected onto that channel's env keys; existing provider call sites stay untouched. `设为生效` simply lowers priority.
- Edge bundling bit us again: importing the config layer from `instrumentation.ts` pulled `node:crypto` into the Edge bundle. Hydration is now lazy (`ensureAiConfigHydrated` at provider entry points), worker refreshes every 60s, and CRUD refreshes the current process immediately.
- Admin table width is constrained by the 16:9 studio workbench (~783px). Dropping the Base URL column (kept in the edit dialog) and using icon-only row actions was necessary to show all actions without horizontal clipping.
- Admin completeness added: `/admin` overview and `/admin/audit` viewer reuse the existing stats/health/audit APIs; audit search was extended to `targetType` so provider actions are findable.

## 2026-10-27 Job ops & budget
- Retry is implemented as "clone failed/cancelled job into a new job" rather than resetting the old row: history stays immutable, budget/quota checks run through the normal enqueue path, and idempotency uses `retry:<jobId>:<uuid>` so repeated clicks don't collide.
- Budget is enforced at enqueue time using prior usage only (not a forward estimate). That is simple and race-safe enough for the current throughput; per-job estimated reservations can come later if concurrent overspend matters.
- Storing the budget on `User` (null=default, 0=unlimited) keeps admin editing trivial and avoids a second table; platform default stays in env so no settings UI is required for v1.
- Cost page previously read the demo file ledger; switched to Prisma so the budget and the visible ledger agree. `/api/costs` now returns the same snapshot.
- CSP needs `'unsafe-inline'` for Next's bootstrap scripts; a nonce middleware is the follow-up to tighten `script-src`.
- Admin jobs table actions are icon-only to fit the 16:9 workbench width, consistent with the AI provider table.

## 2026-10-27 Provider health & failover
- Failover is workload-level rather than in-request retry: the worker retry loop is already a robust retry mechanism, so rotating the active provider (DB priority) after repeated failures avoids mutating global env under concurrency and gives every channel a clean "next attempt uses fallback" semantic.
- Channel attribution is derived from job type/payload (`product-video` -> ARK, `imageModel=doubao` -> ARK, else OpenAI-compatible). That is a heuristic; when job payloads gain explicit provider/model routing, attribution should switch to it.
- Two consecutive failures is the threshold: one-off transient errors keep the provider, while a sustained outage rotates; a single-provider channel never rotates.
- Stats live on `AiProvider` counters instead of a per-call table. This is enough for admin health and avoids unbounded growth; a `ProviderCall` history table can be added when per-period charts are needed.
- Web sync routes need the 60s rehydrate timer because failover happens in the worker process; otherwise open web workers would keep the stale env.

## 2026-10-27 Dependency hardening & E2E
- `pnpm audit` initially reported 3 critical + 22 high. Root causes were outdated direct deps (Next 15.5.20, undici 6.21.3, sharp 0.34.5, zod 3) plus bundled transitive versions. Upgrading the four direct deps removed all criticals; pnpm 11 then required moving overrides to `pnpm-workspace.yaml` (the `package.json#pnpm` field is ignored), after which prod audit reached 0.
- Overrides must pin major-compatible ranges: unconstrained `>=` pulled nanoid 6 / effect 4, which would have broken postcss/prisma. Pin `^3.3.18`, `~3.20.0`, `^8.0.2` and keep the previous `allowBuilds` list intact.
- Zod 4 migration was small: `required_error` → `error`, `errorMap` → `message` on enums.
- Playwright E2E logs in once via a setup project and reuses storageState; per-test logins would hit `LOGIN_MAX_ATTEMPTS=5` and fail intermittently. Anonymous check overrides storageState to empty.
- CI runs E2E after build/seed in the same job to reuse the Postgres service and installed deps; browsers are installed only in that job.

## 2026-10-27 2FA & sessions
- Implemented TOTP locally (RFC 6238) instead of adding a dependency: the spec is small, test vectors are public, and it avoids another supply-chain surface. Base32 decoding, HOTP truncation and constant-time compare are covered by tests.
- 2FA is checked inside NextAuth `authorize` after the password check; a missing/invalid code returns the same generic failure as a bad password to prevent account enumeration. The login form always shows an optional code field instead of a pre-flight "is 2FA enabled" endpoint (which would leak account state).
- Sessions use a DB row plus `sessionId` in the JWT: this gives per-device revocation without switching NextAuth to DB sessions or storing session tokens server-side. `getSessionUser` validates the row on every authenticated request; `lastSeenAt` writes are throttled to 5 minutes.
- Legacy JWTs without `sessionId` are tolerated for one rollout to avoid mass logouts; once everyone re-logs they are device-managed.
- Recovery codes are hashed with SHA-256 (high-entropy one-time codes, no brute-force concern) and consumed atomically enough for the current single-write path.
- Password changes/resets now revoke all device sessions in addition to bumping `authVersion`; `signOut` event revokes the current device row.
- Account page layout is a 2-column grid; with four cards it scrolls below the fold on the 16:9 workbench, which is acceptable but could use tabs later.

## 2026-10-27 i18n foundation
- Chose a dependency-free dictionary over next-intl: the app needs only cookie-based locale switching with SSR, and avoiding another dependency keeps the audit surface at 0 vulnerabilities.
- No Provider fallback returns Chinese, so existing component tests and embedded components keep working; the root layout injects the real locale for pages.
- Switching uses a cookie + `router.refresh()` rather than URL prefixes: no duplicated routes, no redirects, and deep links keep working. The trade-off is that locale is not shareable in links (could add `?lang=` later).
- Client components get locale via context; server components (costs page later) must call `getLocale()` explicitly.
- Translation is incremental: shell/auth/account first because they are the product's "frame"; admin and workflow pages follow. Missing keys fall back to Chinese rather than showing raw keys, which avoids blank UI mid-migration.
- Server-side business error messages remain Chinese for now; mapping error `code` to localized messages is the cleaner follow-up than translating every throw site.

## 2026-10-27 Observability
- In-process registry instead of Prometheus client: the metric surface is small, avoids a dependency, and keeps the audit at zero vulnerabilities. Multi-replica setups scrape each pod.
- Route normalization is mandatory: raw paths include cuids and would blow up label cardinality; numeric/uuid/hex-ish segments become `:id`.
- `/api/metrics` is admin/token-protected by default: metrics can reveal routes and traffic patterns. `METRICS_TOKEN` enables standard Prometheus scrape configs without a session.
- Alerts are computed from live DB/health data in `/api/admin/health` rather than a separate alert engine; the admin overview polls it already, so no new service or scheduler is needed. Thresholds live in env for ops tuning.
- Metrics reset on process restart; counters are meant for `rate()`/`increase()` queries, not absolute totals.

## 2026-10-27 API tokens, webhooks, OpenAPI
- The custom Edge middleware previously blocked every `/api/*` request without a session cookie, which silently defeated Bearer tokens. Fix: middleware only short-circuits on missing session when there is no Bearer header; actual token validation stays in Node (`handleApi`) because the Edge runtime cannot query Prisma.
- Tokens store only SHA-256 and display a short prefix; plaintext is returned exactly once. Tokens inherit the owner's role, so an admin token can hit admin endpoints — same trust model as a session, simpler than per-route scopes for now (scopes field stored for future enforcement).
- Webhooks are single-attempt with an 8s timeout and full delivery records: robust enough to debug, avoids retry storms, and never blocks job finalisation. The Worker hooks `completeJob`/`failJob` so all job paths are covered.
- SSRF protection is hostname-based (https, no credentials, no localhost/private/.local/.internal). DNS rebinding is out of scope for v1; an allowlist or egress proxy is the production hardening step.
- OpenAPI is hand-written but kept small and served publicly; it documents the actual contract (messages/routes) and is validated in tests so it won't drift silently.

## 2026-10-27 Data governance
- Export uses explicit Prisma `select` for every relation and excludes secrets/storage keys. The API test intentionally feeds extra fields from mocks and asserts they don't leak, guarding against future "select *" regressions.
- Account deletion relies on DB cascades; asset files are unlinked best-effort with a path-escape guard, and the existing cleanup job covers leftovers. Audit rows survive deletion via `SetNull`, so operators retain an immutable trace of the deletion (email stored in metadata).
- Last-admin protection is checked before password validation to avoid timing differences? Actually password is validated after the admin guard; the guard only counts admins, no sensitive leak either way.
- Audit CSV uses a BOM so Excel detects UTF-8; metadata is JSON-encoded through the same escaping function. Bounded at 5000 rows to keep memory/response sane.
- The delete endpoint returns `reauthRequired`; the UI signs out immediately. JWTs for a deleted user are rejected because `getSessionUser` cannot find the row, and tokens cascade-delete.

## 2026-10-27 Redis rate limiting
- Kept the synchronous memory limiter for tests/middleware and added an async interface for production. Route tests that call `setRateLimiter` still work via `AsyncMemoryRateLimiter` wrapping.
- Fixed-window Redis counting (INCR+PEXPIRE) is simpler than a sorted-set sliding window and adequate for abuse control; the memory fallback remains sliding-window, so behavior differs slightly during outages.
- First request after boot may hit the memory fallback because ioredis is still connecting (`enableOfflineQueue=false`); subsequent requests use Redis. This fail-open-to-memory choice avoids latency spikes/500s and is documented.
- Edge middleware cannot use ioredis; it keeps its coarse login pre-check. The authoritative login throttle runs in Node with Redis, so multi-replica brute-force protection still holds after middleware.
- Object storage is a larger refactor (write/read/delete/cleanup across asset store and routes); deliberately deferred with local-volume guidance instead of shipping a half-working S3 driver.

## 2026-10-27 Job approval
- Approval gates execution, not submission: jobs still enqueue (and budget/quota checks still run) but the worker SQL filters `approvedAt IS NOT NULL`, so no new status enum migration was needed and cancellation/retry semantics stay unchanged.
- Backfilling existing jobs to `approvedAt=now()` is critical; otherwise a deploy would freeze the queue. The migration contains the backfill, not just column adds.
- Per-user flag avoids a global approval switch for teams that only need it for external users; platform env covers stricter deployments.
- Admin jobs filter uses `requiresApproval + approvedAt=null`; approve/reject only accept pending queued jobs and return 409 `JOB_NOT_APPROVABLE` otherwise, preventing races with worker claims.
- UI shows "等待审批" on the user side and approval controls on the admin side; both reuse existing table patterns to keep the 16:9 layout intact.

## 2026-10-27 Plans
- Kept plans as a *quota* model, not a billing model: no payment/subscription state, but budget and concurrency resolution now have a clean hierarchy (user > plan > platform). This gives sales/support a real "package" object without pretending to process payments.
- Plan deletion is guarded by member count; `SetNull` on user.planId would otherwise silently downgrade quotas, so the API blocks deletion until users are reassigned.
- Admin UI reuses the existing panel/table/dialog components; user binding lives in the existing edit dialog to avoid a second navigation flow.
- Budget precedence is centralized in `resolveBudgetUnits`, so future billing/plan fields only need to extend that function.

## 2026-10-27 i18n batch 2
- Reused the same dictionary/provider; no architectural changes. Server components (costs) call `getLocale()` + `translate`, client components use `useI18n()`.
- Status/type labels moved to `job.status.*` / `job.type.*` so admin and user surfaces share one translation source; old exported helpers remain for compatibility but tests use default zh.
- Tests were kept stable by using dictionary zh values identical to previous literals and preserving aria labels/roles (e.g., task list name, status filter). Where an aria label was accidentally changed to English, tests caught it immediately.
- Admin alert messages still come from the server in Chinese; stable alert ids allow a later client-side mapping without changing the API.
