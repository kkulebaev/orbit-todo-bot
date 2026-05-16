# syntax=docker/dockerfile:1

FROM node:24-alpine AS builder
WORKDIR /app
ENV CI=true

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# 1. Fetch all packages from lockfile into the virtual store.
#    This layer is cached until pnpm-lock.yaml changes.
COPY pnpm-lock.yaml ./
RUN pnpm fetch

# 2. Install workspace manifests and wire up node_modules (offline — no network).
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/bot/package.json ./apps/bot/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

RUN pnpm install --offline --frozen-lockfile --filter @orbit/bot...

# 3. Copy sources.
COPY apps/bot/tsconfig.json ./apps/bot/tsconfig.json
COPY apps/bot/src ./apps/bot/src
COPY packages/contracts/src ./packages/contracts/src
COPY packages/contracts/tsconfig.json ./packages/contracts/tsconfig.json

RUN pnpm --filter @orbit/bot run build

# ---------------------------------------------------------------------------

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json pnpm-workspace.yaml ./
COPY apps/bot/package.json ./apps/bot/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

# Copy the pnpm virtual store + package-level node_modules (includes generated Prisma client).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/bot/node_modules ./apps/bot/node_modules

COPY --from=builder /app/apps/bot/dist ./apps/bot/dist

EXPOSE 3000
CMD ["node", "--env-file-if-exists=.env", "apps/bot/dist/server.js"]
