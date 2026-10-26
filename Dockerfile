# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# ai-design-studio platform image.
#
# Stages:
#   deps    -> frozen-lockfile dependency install (cache friendly)
#   builder -> prisma client + `next build` (standalone output), also the base
#              of the worker stage because the worker runs TypeScript via tsx
#   runner  -> minimal web image, non-root, `node server.js` on :3000
#   worker  -> queue consumer (`tsx scripts/worker.ts`), non-root
#
# The web runner requires `output: "standalone"` in next.config.mjs.
# Build with `docker compose build` (compose selects the right target per service).
# ---------------------------------------------------------------------------

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base

# libc6-compat: glibc shim for the prebuilt sharp/prisma binaries.
# openssl:     prisma query engine runtime dependency on alpine.
RUN apk add --no-cache libc6-compat openssl

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1

# Keep in sync with the `packageManager` field in package.json.
ARG PNPM_VERSION=11.15.1
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

# Fixed uid/gid so the storage volume and bind mounts keep predictable ownership.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

WORKDIR /app

# ---------------------------------------------------------------------------
# deps: install once from the lockfile (dev deps included; the worker needs tsx)
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# builder: prisma client + next build. Also the runtime base of the worker.
# ---------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time placeholders only. `next build` / `prisma generate` must not need a
# live database or a real secret; real values are injected at runtime.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public" \
    AUTH_SECRET="build-only-placeholder-secret-not-for-production"

# `pnpm build` = `prisma generate && next build` (single source of truth:
# package.json). Standalone output lands in .next/standalone.
RUN pnpm build

# ---------------------------------------------------------------------------
# runner: web server (standalone).
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    STORAGE_ROOT=/data

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Next's output tracing usually bundles the generated Prisma client, but the
# engine + generated client are a known gap for standalone images: copy them
# explicitly so `@prisma/client` can query at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Keep the schema + migrations in the image so operators can run
# `prisma migrate deploy` from the repo image (see docs/runbook.md).
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# STORAGE_ROOT=/data is the persistent volume. The legacy `/uploads` and
# `/generated` route handlers anchor on `<cwd>/public`, so link the volume
# sub-directories into public/ to keep both access paths working.
RUN mkdir -p /data/uploads /data/generated \
 && rm -rf ./public/uploads ./public/generated \
 && ln -sfn /data/uploads ./public/uploads \
 && ln -sfn /data/generated ./public/generated \
 && chown -R nextjs:nodejs /data

USER nextjs
EXPOSE 3000

# Liveness only (no DB): matches /api/health semantics, so a transient database
# outage does not restart the container. Use /api/ready for traffic gating.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]

# ---------------------------------------------------------------------------
# worker: queue consumer. The standalone bundle does not include scripts/, so
# this stage reuses the builder (full source + dev deps incl. tsx).
# ---------------------------------------------------------------------------
FROM builder AS worker
ENV NODE_ENV=production \
    STORAGE_ROOT=/data

RUN mkdir -p /data/uploads /data/generated && chown -R nextjs:nodejs /data

USER nextjs

CMD ["node_modules/.bin/tsx", "scripts/worker.ts"]
