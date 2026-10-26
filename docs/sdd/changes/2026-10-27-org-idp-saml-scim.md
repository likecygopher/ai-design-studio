# 变更规格：每组织独立 IdP + SAML 2.0 + SCIM

- 变更 ID：`CHG-2026-10-27-ORG-IDP`
- 目标：组织 owner/admin 可为自己的组织配置独立 IdP（OIDC 或 SAML 2.0），并支持 SCIM 2.0 用户/组同步与组→角色映射。

## 1. 数据模型（迁移 `20261027160000_org_sso_scim`）

- `OrganizationSsoConfig`（每组织唯一）：协议 oidc/saml、enabled、显示名、OIDC issuer/clientId/加密 secret、SAML entryPoint/issuer/cert、邮箱域白名单、自动开通、默认角色、`groupRoleMap`、SCIM 开关与哈希令牌。
- `SsoLoginState`：一次性 state + nonce + PKCE verifier + RelayState，10 分钟过期。
- `SsoLoginTicket`：IdP 回调后签发的 2 分钟一次性票据（只存 SHA-256）。
- `ScimExternalUser` / `ScimGroup` / `ScimGroupMember`：外部用户映射、组与成员关系。

## 2. 登录流程

### OIDC（每组织动态）
1. `/api/auth/sso/start?org=<slug>`（或 `email=` 按域解析）→ 读取组织配置、discovery；
2. 生成 state/nonce/PKCE，保存 `SsoLoginState`，跳转 IdP authorize；
3. `/api/auth/sso/oidc/callback` 交换 code（client_secret_post）、用 JWKS 校验 id_token（issuer/audience/nonce）；
4. 邮箱域白名单 → 查找/关联/自动开通用户 → 组映射角色 → 加入组织并设为 active org；
5. 签发一次性 ticket → `/login/sso` 调用 `sso-ticket` Credentials 建立与密码登录一致的 AuthSession/JWT；
6. 审计 `auth.login`（provider=organization_sso）。

### SAML 2.0
- SP Metadata：`GET /api/auth/sso/saml/metadata?org=<slug>`（EntityDescriptor + HTTP-POST ACS）；
- 发起：`/api/auth/sso/start?org=<slug>`（protocol=saml）生成 AuthnRequest；
- ACS：`POST /api/auth/sso/saml/callback`，用 IdP 证书校验签名断言，读取 email/groups/memberOf，后续与 OIDC 相同的开通/映射/票据流程。

## 3. SCIM 2.0

- 认证：`Authorization: Bearer <SCIM token>`，令牌只在生成时显示一次，服务端存 SHA-256，常量时间比较。
- Base URL：`/api/scim/v2`
- `GET/POST /Users`、`GET/PATCH/DELETE /Users/{id}`；PATCH 支持 `active`/`userName`/`displayName`，停用会移除组织成员关系。
- `GET/POST /Groups`、`GET/PATCH/DELETE /Groups/{id}`；组成员变更同步组织成员；组名/显式 role 按 `groupRoleMap` 映射角色（owner/admin/member），只升不降 owner。
- `GET /ServiceProviderConfig`。
- 审计：SCIM 由组织令牌驱动，管理端可见组织 SSO/令牌轮换审计 `organization.sso_update`、`organization.scim_token_rotate`。

## 4. 管理 UI

- `/account/organization/sso`（owner/admin）：
  - 启用开关、协议 OIDC/SAML、显示名、邮箱域白名单、自动开通、默认角色、组映射 JSON；
  - OIDC issuer/clientId/secret；SAML entryPoint/IdP issuer/证书；
  - 生成/轮换 SCIM 令牌（仅显示一次）；
  - 展示 OIDC Redirect URI、SAML ACS、SP Metadata URL。
- `/account/organization` 增加入口。

## 5. 安全

- IdP client secret/证书加密存储；SCIM 令牌哈希存储、一次性展示。
- OIDC state/nonce/PKCE 防 CSRF/重放；ticket 一次性、短过期；returnTo 仅允许站内路径（防开放重定向）。
- SAML 强制断言签名校验（`WantAssertionsSigned=true`）。
- 组映射限制为 owner/admin/member，避免 IdP 提升平台管理员（platform role 不受影响）。
- 本地 TOTP 2FA 对 SSO 登录不重复校验（由 IdP MFA 负责）。

## 6. 边界

- 平台级环境变量 SSO（旧）仍保留；组织级配置优先用于组织登录。
- 未实现 SAML 单点登出（SLO）、SCIM Bulk、SCIM 分页令牌；OIDC 发现/JWKS 进程内缓存 10 分钟。
- SCIM 用户为组织级停用（移除成员关系），不全局禁用账号。

## 7. 验收

1. 组织 owner 可保存 OIDC/SAML 配置并生成 SCIM 令牌；配置回显不泄露密钥。
2. OIDC/SAML 回调换取 ticket 后建立 AuthSession；SCIM 用户/组同步与组角色映射生效（冒烟验证 admin）。
3. 门禁：tsc 0；135 测试文件 / 790 测试；next build 0；E2E 9 passed；audit 0。
