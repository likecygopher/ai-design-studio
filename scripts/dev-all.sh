#!/usr/bin/env bash
# One-command local development: PostgreSQL + schema + demo seed (first run) +
# Next.js dev server + worker. Ctrl+C stops web and worker.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env.local ] && [ ! -f .env ]; then
  echo "缺少环境文件：请先 cp .env.example .env.local 并填写 DATABASE_URL / AUTH_SECRET。" >&2
  exit 1
fi

# Load env for Prisma CLI / worker (Next dev reads .env.local itself).
set -a
if [ -f .env.local ]; then
  # shellcheck disable=SC1091
  . ./.env.local
else
  # shellcheck disable=SC1091
  . ./.env
fi
set +a

if [ -z "${DATABASE_URL:-}" ] || [ -z "${AUTH_SECRET:-}" ]; then
  echo "环境变量缺少 DATABASE_URL 或 AUTH_SECRET（需 >=32 字符）。" >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1; then
  echo "==> 启动 PostgreSQL (docker compose)"
  pnpm db:up
  echo -n "==> 等待数据库就绪"
  for _ in $(seq 1 30); do
    if docker exec midea-ai-postgres pg_isready -U midea -d midea_ai_studio >/dev/null 2>&1; then
      echo " ok"
      break
    fi
    echo -n "."
    sleep 1
  done
else
  echo "==> 未检测到 docker，假设 DATABASE_URL 已可用"
fi

echo "==> 同步数据库 schema"
pnpm db:push

# Seed only when the database has no users yet (seed is idempotent but resets password).
USER_COUNT="$(docker exec midea-ai-postgres psql -U midea -d midea_ai_studio -t -A -c 'SELECT count(*) FROM "User";' 2>/dev/null | tr -d '[:space:]' || true)"
if [ "${USER_COUNT:-0}" = "0" ]; then
  echo "==> 初始化演示管理员"
  pnpm db:seed
else
  echo "==> 已有用户，跳过 seed（demo@midea.local / demo1234）"
fi

echo "==> 启动 Web 与 Worker（Ctrl+C 同时停止）"
pnpm dev &
WEB_PID=$!
pnpm worker &
WORKER_PID=$!

cleanup() {
  kill "$WEB_PID" "$WORKER_PID" 2>/dev/null || true
  wait "$WEB_PID" "$WORKER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo
echo "Web:    http://127.0.0.1:${PORT:-3000}"
echo "账号:   demo@midea.local / demo1234（仅本地开发种子）"
echo

wait "$WEB_PID" "$WORKER_PID"
