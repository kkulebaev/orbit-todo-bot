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
COPY packages/api-client/package.json ./packages/api-client/package.json

RUN pnpm install --offline --frozen-lockfile --filter @orbit/bot...

# 3. Copy sources.
COPY apps/bot/tsconfig.json ./apps/bot/tsconfig.json
COPY apps/bot/src ./apps/bot/src
COPY packages/contracts/src ./packages/contracts/src
COPY packages/contracts/tsconfig.json ./packages/contracts/tsconfig.json
COPY packages/api-client/src ./packages/api-client/src
COPY packages/api-client/tsconfig.json ./packages/api-client/tsconfig.json

RUN pnpm --filter @orbit/contracts run build
RUN pnpm --filter @orbit/api-client run build
RUN pnpm --filter @orbit/bot run build

# ---------------------------------------------------------------------------

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json pnpm-workspace.yaml ./
COPY apps/bot/package.json ./apps/bot/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/api-client/package.json ./packages/api-client/package.json

# Copy the pnpm virtual store + package-level node_modules (includes generated Prisma client).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/bot/node_modules ./apps/bot/node_modules

# Built workspace packages — apps/bot/node_modules/@orbit/{contracts,api-client}
# are pnpm workspace symlinks pointing back at packages/*, so their dist/ and
# node_modules/ (transitive deps like zod, workspace symlink to @orbit/contracts)
# must be present in the runtime stage.
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=builder /app/packages/api-client/dist ./packages/api-client/dist
COPY --from=builder /app/packages/api-client/node_modules ./packages/api-client/node_modules

COPY --from=builder /app/apps/bot/dist ./apps/bot/dist

EXPOSE 3000
CMD ["node", "--env-file-if-exists=.env", "apps/bot/dist/server.js"]
