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
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

RUN pnpm install --offline --frozen-lockfile --filter @orbit/api...

# 3. Copy sources and build.
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/api/src ./apps/api/src
COPY apps/api/prisma ./apps/api/prisma
COPY packages/contracts/src ./packages/contracts/src
COPY packages/contracts/tsconfig.json ./packages/contracts/tsconfig.json

RUN pnpm --filter @orbit/contracts run build
RUN pnpm --filter @orbit/api exec prisma generate
RUN pnpm --filter @orbit/api run build

# ---------------------------------------------------------------------------

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

# Copy the pnpm virtual store + package-level node_modules (includes generated Prisma client).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

# Built contracts package — apps/api/node_modules/@orbit/contracts is a pnpm
# workspace symlink that points back at packages/contracts/, so its dist/ must
# be present in the runtime stage too.
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist

COPY --from=builder /app/apps/api/dist ./apps/api/dist
# Prisma schema is needed at runtime for migrate (run via Railway releaseCommand).
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

EXPOSE 8080

# `prisma migrate deploy` is intentionally NOT here.
# Railway runs it as a releaseCommand before each deploy (see docs/railway-deploy.md).
CMD ["node", "--env-file-if-exists=.env", "apps/api/dist/server.js"]
