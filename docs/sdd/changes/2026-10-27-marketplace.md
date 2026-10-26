# 变更规格：模板市场

- 变更 ID：`CHG-2026-10-27-MARKETPLACE`
- 目标：用户发布提示词/模板 → 管理员审核 → 其他用户浏览并克隆到个人模板库。

## 1. 数据

```prisma
model MarketplaceItem {
  id, authorId, title, description?, category, prompt, coverUrl?,
  status (pending|approved|rejected), reviewNote?, reviewedBy?,
  clones Int, createdAt, updatedAt
}
model UserTemplate {
  id, userId, itemId?, title, prompt, category, createdAt
}
```

- 迁移：`20261027110000_marketplace`。
- 分类：`style` / `pop` / `pdp` / `prompt`。

## 2. 接口

- `GET /api/marketplace?q=&category=&page=`：仅 approved，按克隆数/时间排序。
- `POST /api/marketplace`：发布，状态 pending，限流 10/小时。
- `GET /api/marketplace/{id}`：已审核详情。
- `POST /api/marketplace/{id}/clone`：克隆到个人模板库并递增 clones。
- `GET /api/account/templates`：我的模板库。
- `GET /api/admin/marketplace?status=`、`PATCH /api/admin/marketplace/{id}`：管理员审核（审计 `admin.marketplace_review`）。

## 3. UI

- `/marketplace`：市场/我的模板库、搜索与分类、克隆、发布弹窗。
- `/admin/marketplace`：待审核/全部筛选、通过/驳回（可填原因）。
- 导航新增「模板市场」「市场审核」。

## 4. 验收

1. 发布后为 pending，管理员通过后才出现在市场；克隆生成个人模板并计数。
2. 导航与页面中英双语；审核需 admin。
3. 门禁：tsc 0；130 测试文件 / 762 测试；next build 0；E2E 8/8。
