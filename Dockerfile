# ============================================================
# Base image
# ============================================================
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable

# ============================================================
# Prune stages — turbo prune --docker creates out/json + out/full
# ============================================================
FROM base AS prune-web
WORKDIR /app
RUN npm i -g turbo@^2
COPY . .
RUN turbo prune web --docker

FROM base AS prune-cron
WORKDIR /app
RUN npm i -g turbo@^2
COPY . .
RUN turbo prune @pounce/cron --docker

FROM base AS prune-queue
WORKDIR /app
RUN npm i -g turbo@^2
COPY . .
RUN turbo prune @pounce/queue --docker

# ============================================================
# Builder: web
# ============================================================
FROM base AS builder-web
WORKDIR /app

# Install deps first (cached layer)
COPY --from=prune-web /app/out/json/ .
RUN npm ci

# Copy source and build
COPY --from=prune-web /app/out/full/ .

ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1

RUN npx turbo build --filter=web...

# ============================================================
# Builder: cron
# ============================================================
FROM base AS builder-cron
WORKDIR /app

COPY --from=prune-cron /app/out/json/ .
RUN npm ci

COPY --from=prune-cron /app/out/full/ .

# ============================================================
# Builder: queue
# ============================================================
FROM base AS builder-queue
WORKDIR /app

COPY --from=prune-queue /app/out/json/ .
RUN npm ci

COPY --from=prune-queue /app/out/full/ .

# ============================================================
# Final: web — standalone Next.js
# ============================================================
FROM base AS web
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

RUN mkdir -p ./apps/web/public
COPY --from=builder-web --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder-web --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]

# ============================================================
# Final: cron — tsx runtime with pruned node_modules
# ============================================================
FROM base AS cron
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 appuser

COPY --from=builder-cron --chown=appuser:nodejs /app/ ./

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)"

CMD ["npx", "tsx", "apps/cron/src/index.ts"]

# ============================================================
# Final: queue — tsx runtime with pruned node_modules
# ============================================================
FROM base AS queue
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 appuser

COPY --from=builder-queue --chown=appuser:nodejs /app/ ./

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)"

CMD ["npx", "tsx", "apps/queue/src/index.ts"]
