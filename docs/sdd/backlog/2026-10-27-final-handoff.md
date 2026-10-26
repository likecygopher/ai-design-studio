# 最终交接说明（2026-10-27）

## 1. 交付状态

Midea AI Content Studio 已具备多用户商业平台的主要能力：

- **账号与安全**：注册/登录、2FA（TOTP+恢复码）、设备会话吊销、密码修改、账户导出/注销、审计日志。
- **企业身份**：平台级 OIDC + 每组织独立 IdP（OIDC/SAML 2.0）、SCIM 2.0 用户/组同步、组→角色映射、SP Metadata/ACS、域白名单与自动开通。
- **组织多租户**：Organization/成员/owner-admin-member 角色、个人组织、组织切换、产品/素材/任务按 active org 共享与隔离、组织归档/删除（owner + 名称确认）。
- **任务**：创作工作流、任务中心、失败重试/取消、审批流（全局/用户级）、失败归因、供应商用量记录。
- **配额与计费**：套餐 Plan（预算/并发）、用户月度预算、超限阻断、成本台账。**支付/订阅账单按产品要求不做**。
- **AI 供应商**：可视化配置/连接测试/故障切换/用量统计、密钥 AES-256-GCM 加密。
- **对象存储**：`STORAGE_DRIVER=local|s3`，S3 兼容（S3/MinIO/OSS），S3 模式鉴权代理 URL。
- **机器接口**：API Token（只读/读写 scope、哈希、吊销）、Webhook（HMAC、SSRF 防护、投递记录、指数退避重试）、OpenAPI 3.1。
- **模板市场**：发布→管理员审核→浏览/克隆到个人模板库。
- **国际化**：中英切换覆盖管理端五页、任务/成本、全部主要 Studio、账户/组织/市场/SSO；服务端错误码英文。
- **可观测性/加固**：Prometheus metrics、统一健康快照、Slack/Webhook 告警（去重/恢复）、CSP nonce（strict-dynamic，无 script unsafe-inline）、依赖审计 0、E2E CI。
- **质量门禁**：TypeScript 0 error、Vitest 133 文件/781 测试、Next build 0、Playwright 9 passed、`pnpm audit --prod --audit-level=high` 0。

## 2. 明确不做（产品排除）

- 邮件能力（含密码找回、邀请注册）
- 支付/订阅账单（保留套餐配额）
- SAML/SCIM/每组织独立 IdP（当前平台级单 OIDC IdP）

## 2.1 一键启动 / 部署

- 本地：`pnpm dev:all`（PostgreSQL + schema + 首次 seed + Web + Worker）。
- Docker 生产式：`pnpm deploy:docker`（生成 `.env.docker`、构建、迁移、seed、健康检查）。

## 3. 验证命令（Node 24）

```bash
export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"
npx prisma generate
npx prisma db push            # 本地；生产用 prisma migrate deploy
npx tsc --noEmit              # 0
npx vitest run                # 133 files / 781 tests
npx next build                # 0
E2E_BASE_URL=http://127.0.0.1:3000 npx playwright test   # 9 passed
pnpm audit --prod --audit-level=high --registry=https://registry.npmjs.org
```

## 4. 环境变量（关键）

- 基础：`DATABASE_URL`、`AUTH_SECRET`
- SSO：`SSO_ISSUER`、`SSO_CLIENT_ID`、`SSO_CLIENT_SECRET`（可选 `SSO_NAME/SSO_SCOPES/SSO_ALLOWED_DOMAINS/SSO_AUTO_PROVISION/SSO_DEFAULT_ORG_SLUG`）
- 存储：`STORAGE_DRIVER`、`S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_FORCE_PATH_STYLE/S3_PREFIX`
- 观测：`METRICS_TOKEN`、`ALERT_WEBHOOK_URL`、`ALERT_QUEUE_DEPTH`、`ALERT_FAILURE_RATE`
- AI：`AI_CONFIG_SECRET`、供应商密钥在管理端配置

## 5. 运维/已知边界

- S3 模式主要覆盖用户上传/生成资产；localize/demo 模板导出仍写本地 `public/generated`（见 runbook）。
- 组织删除会级联删除共享产品/素材/任务，必须 owner 输入组织名称确认；个人组织不可删除/归档。
- 成本/账户导出仍按个人；配额按用户。
- 多副本部署时进程内指标/SSE 状态不聚合（Redis 限流已支持）。
- 生产迁移：`prisma migrate deploy`；组织回填 SQL 已包含在 `20261027130000_organizations`。
- 工作区**未提交 git**，由用户审阅。
