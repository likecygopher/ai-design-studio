# 变更规格：Redis 分布式限流（对象存储仍待后续）

- 变更 ID：`CHG-2026-10-27-REDIS-RATE-LIMIT`
- 触发：已批准清单第 6 项「对象存储与 Redis 限流」；本批完成 Redis 限流，对象存储保留为后续项（见 §4）。

## 1. 设计

- 无 Redis 时延续进程内滑动窗口 `MemoryRateLimiter`（单副本部署/测试）。
- 配置 `REDIS_URL` 后：
  - `AsyncRateLimiter` 接口统一异步语义；
  - `RedisRateLimiter` 使用 Lua 脚本原子 `INCR + PEXPIRE + PTTL`（固定窗口）；
  - API 包装器 `handleApi` 与登录 `authorize` 改为异步限流；
  - 请求/登录分别使用 `studio:rl:` / `studio:login:` 前缀，多副本共享。
- 容错：Redis 连接失败/超时（`connectTimeout=2s`、`enableOfflineQueue=false`）时回退进程内限流并记录 `rate_limit.redis_error/unavailable`，不会放行无限流量。
- ioredis **动态导入**，避免 Edge middleware 包引入 Node API；middleware 的登录预检查仍为进程内（Edge 无 DB/Redis 客户端），最终登录校验在 Node 层由 Redis 限流兜底。
- 依赖：`ioredis@6`；`pnpm audit --prod --audit-level=high` 仍为 0。

## 2. 配置

```bash
REDIS_URL=redis://:password@127.0.0.1:6379
# 无密码示例：redis://127.0.0.1:6379
```

- 不设置 = 进程内限流（默认，docker-compose 单副本）。
- 连接失败不会阻塞 API；首次冷启动请求可能在连接预热期走内存回退。

## 3. 验收

1. 设置 `REDIS_URL` 后，登录/API 限流键写入 Redis（`studio:rl:*`、`studio:login:*`）。
2. 同一用户连续超限触发 429 且带 `Retry-After`；Redis 中计数可见。
3. 未设置 Redis 时行为与之前一致，全部单测通过。
4. Redis 不可用时自动回退内存限流，接口不报 500。
5. 门禁：tsc 0；121 测试文件 / 720 测试；next build 0。

## 4. 未覆盖（后续）

- **对象存储（S3/OSS）**：需要把资产写入/读取/删除与存储清理抽象为 driver；当前仍为本地卷，生产多副本请使用共享卷或将 `STORAGE_ROOT` 指向共享存储。后续将实现 `STORAGE_DRIVER=s3` 与 SigV4/预签名读取。
- middleware 登录预限流仍是 Edge 进程内；暴力破解的最终防线为 Node 层 Redis 限流。
