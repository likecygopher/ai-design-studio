# 变更规格：对象存储 S3/OSS driver

- 变更 ID：`CHG-2026-10-27-OBJECT-STORAGE`
- 目标：资产存储从本地文件系统抽象为可切换驱动，支持 S3 兼容对象存储（AWS S3 / MinIO / 阿里云 OSS S3 端点）。

## 1. 配置

```env
STORAGE_DRIVER=local            # local（默认）| s3
S3_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
S3_REGION=cn-hangzhou
S3_BUCKET=midea-ai-assets
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=false
S3_PREFIX=midea-ai
```

- `assertRuntimeConfig()` 在 s3 模式下校验 bucket 与 key/secret 成对配置。
- 未显式配置凭据时使用 SDK 默认凭据链（EC2/ECS IAM Role 等）。

## 2. 驱动

- `src/platform/object-storage.ts`
  - `LocalObjectStorage`：保持历史行为（`STORAGE_ROOT`、`/uploads`、`/generated` 直链）。
  - `S3ObjectStorage`：`PutObject/GetObject/DeleteObject`，key 前缀 `S3_PREFIX`，客户端懒加载并按 endpoint/region/path-style 缓存。
- `user-asset-store` 的写入/读取/删除全部走驱动；S3 模式下资产 URL 改为授权的 `/api/assets/{id}/file`，不再暴露公共静态路径。
- 默认 `local`，行为与既有测试完全兼容。

## 3. 边界（当前）

- `localize` 与部分 demo/模板导出仍直接读写本地 `public/generated`；S3 模式主要覆盖用户上传与用户资产生成。
- 未实现预签名 URL、分片上传、生命周期清理；后续可在此抽象上扩展。

## 4. 验收

1. 默认 local 模式全部既有资产测试通过。
2. S3 驱动单测覆盖 put/get/delete、bucket/prefix、缺失 bucket 报错；用户资产 store 注入 S3 驱动时返回 proxy URL。
3. 门禁：tsc 0；128 测试文件 / 754 测试；next build 0；pnpm audit 0；E2E 8/8。
