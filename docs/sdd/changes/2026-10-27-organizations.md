# 变更规格：组织多租户（阶段 1：组织/成员/角色）

- 变更 ID：`CHG-2026-10-27-ORGANIZATIONS`
- 目标：引入 Organization 作为团队租户，个人组织自动创建，支持成员与角色管理、组织切换；为阶段 2 数据隔离打基础。

## 1. 数据

```prisma
Organization { id, name, slug, createdAt, updatedAt }
OrganizationMember { id, organizationId, userId, role(owner|admin|member), createdAt }
User.organizationId?      // active organization
Product/Asset/GenerationJob.organizationId?  // 预留给阶段 2 隔离
```

- 迁移 `20261027130000_organizations` 含个人组织回填：
  - 每个用户创建 `org_<userId>`，slug `personal-<userId>`，owner 成员关系；
  - `User.organizationId`、`Product/Asset/GenerationJob.organizationId` 回填。
- 新注册/管理员创建用户后异步确保个人组织。

## 2. 服务/API

- `ensurePersonalOrganization` / `getOrganizationOverview` / `switchOrganization` / `renameOrganization` / `addOrganizationMember` / `updateOrganizationMemberRole` / `removeOrganizationMember`。
- 角色规则：owner/admin 可管理成员；只有 owner 可授予 owner；至少保留一位 owner；仅能添加已注册账号（不支持邀请/邮件）。
- API：
  - `GET/PATCH /api/account/organization`
  - `POST /api/account/organization/switch`
  - `POST /api/account/organization/members`
  - `PATCH/DELETE /api/account/organization/members/{id}`
- 审计：`organization.rename/switch/member_add/member_update/member_remove`。

## 3. UI

- `/account/organization`：组织名称/重命名、组织切换、成员列表与角色调整、移除成员、按邮箱添加已注册用户。
- 导航「组织与团队」；页面中英双语。

## 4. 边界（阶段 2）

- 本阶段尚未把 Product/Asset/GenerationJob 的查询全部切换到 `organizationId`；当前数据仍按用户归属。阶段 2 将统一 active-org 解析并改造工作区/任务/成本查询，实现真正共享与隔离。
- 迁移回填 SQL 已写好；生产执行 `prisma migrate deploy` 即可。

## 5. 验收

1. 每个用户有个人组织且为 owner；可添加已注册用户、调整角色、切换组织。
2. 至少一位 owner 与仅注册账号限制生效。
3. 门禁：tsc 0；131 测试文件 / 767 测试；next build 0；E2E 8/8。

## 阶段 2：数据隔离（2026-10-27）

- `getSessionUser` 加载并缓存 active organization；`getActiveOrganizationId(userId)` 在无缓存时回退个人组织。
- 工作区改造：
  - `createUserWorkspace(userId, jobId?, organizationId?)`，Worker 使用任务的 `organizationId`；
  - 产品/素材查询采用 `OR [{organizationId: activeOrg}, {userId}]`，新建记录写入 `organizationId`；组织成员共享产品/素材，个人历史数据仍可见；
  - `listJobsForUser` / `getJobForUser` 同样按组织共享；入队任务写入 `organizationId`。
- 配额/预算仍按用户计算（套餐配额按用户绑定），AI 供应商/平台配置保持全局；管理员视图跨组织。
- 已知边界：成本记录仍按用户；账户导出仍只导出本人数据；组织删除/归档未实现；切换组织后需刷新页面缓存。
