# syntax=docker/dockerfile:1

FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable

# Copy workspace manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/bot/package.json ./apps/bot/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

RUN pnpm install --frozen-lockfile --filter @orbit/bot...

COPY apps/bot/tsconfig.json ./apps/bot/tsconfig.json
COPY apps/bot/src ./apps/bot/src
COPY packages/contracts/src ./packages/contracts/src
COPY packages/contracts/tsconfig.json ./packages/contracts/tsconfig.json

# Generate Prisma client (bot still uses Prisma directly on P0-P4)
COPY apps/api/prisma ./apps/api/prisma
RUN pnpm --filter @orbit/bot exec prisma generate --schema=../api/prisma/schema.prisma

RUN pnpm --filter @orbit/bot run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot/package.json ./apps/bot/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY --from=builder /app/apps/bot/node_modules ./apps/bot/node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/bot/dist ./apps/bot/dist

EXPOSE 3000
CMD ["node", "--env-file-if-exists=.env", "apps/bot/dist/server.js"]
