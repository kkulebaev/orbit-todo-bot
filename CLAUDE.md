# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workspace layout

```
orbit-todo-bot/
├── apps/
│   ├── bot/          # @orbit/bot — grammY + Express webhook (Prisma direct on P0-P4)
│   └── api/          # @orbit/api — Express REST API + Prisma (the canonical DB owner from P1)
└── packages/
    └── contracts/    # @orbit/contracts — Zod schemas + TS types (wire format source of truth)
```

`@orbit/contracts` is the single source of truth for all HTTP wire formats between bot and api.
Both apps declare `"@orbit/contracts": "workspace:*"` as a dependency.

## Commands

This project uses **pnpm** (version pinned via `package.json#packageManager`). Enable via `corepack enable` if needed.

Root-level workspace commands:

- `pnpm -r typecheck` — type-check all packages.
- `pnpm -r test` — run Vitest in all packages once.
- `pnpm -r build` — build all packages.
- `pnpm --filter @orbit/bot dev` — run the bot in dev mode via `tsx src/bot.ts` (loads `.env`). Set `SHADOW_MODE=true` + `API_BASE_URL` + `API_BOT_TOKEN` to enable P2 schema-canary parallel reads. Set `READ_FROM_API=true` (P3) to route task READs through `@orbit/api` instead of Prisma (see `docs/railway-deploy.md`).
- `pnpm --filter @orbit/bot lint` — ESLint on bot source (warns on `@prisma/client` imports; becomes error on P5).
- `pnpm --filter @orbit/api dev` — run the api in dev mode.
- `pnpm prisma:generate` / `pnpm prisma:migrate` — Prisma client generation and `migrate deploy` (delegated to `@orbit/api`).
- Run a single test file: `pnpm --filter @orbit/bot exec vitest run src/callback-data.test.ts`. Filter by name: `pnpm --filter @orbit/bot exec vitest run -t "parses v:list"`.
- `apps/bot/Dockerfile` and `apps/api/Dockerfile` (multi-stage) build production images; Railway uses them for deploys. There is no local Postgres setup — point `DATABASE_URL` at a remote DB (e.g. Railway Postgres) for local dev.

## Runtime entry points

### apps/bot

- `apps/bot/src/server.ts` is the production entry. When `import.meta.url` matches `process.argv[1]`, it dynamically imports `./bot.js` (registering all grammY handlers as a side-effect), then `./bot-instance.js`, and starts Express on `0.0.0.0:$PORT`. Telegram webhook is set externally (the README mentions it's registered after deploy; the code itself only exposes `bot.api.setWebhook`).
- `apps/bot/src/bot.ts` is the dev entry and the side-effectful module that wires every handler onto the shared `bot` from `bot-instance.ts`. Importing `bot.ts` mutates the singleton; do not import it from tests.
- `apps/bot/src/bot-instance.ts` instantiates the grammY `Bot` once. Both `bot.ts` and `server.ts` consume this same instance — keep instantiation here so handlers and `handleUpdate` share state.

### apps/api

- `apps/api/src/server.ts` is the API entry. Exposes `GET /healthz → { ok: true, service: "api" }` on `0.0.0.0:$PORT` (default 8080).

## Architecture

Three-layer split designed to keep grammY/Prisma out of unit tests:

1. **Transport (`apps/bot/src/server.ts`)** — Express app with `POST /telegram/webhook` and `GET /healthz`. `createApp(bot)` is exported separately from `startServer` so tests can mount it with a fake bot. The webhook handler does minimal logging (truncated text, no secrets) and forwards `req.body` to `bot.handleUpdate`.

2. **Handler registration (`apps/bot/src/bot.ts`)** — grammY commands (`/start`, `/help`, `/add`, `/my`, `/done`, `/cancel`), the `message:text` handler that drives the pending-action state machine, and the `callback_query:data` handler. The callback handler has three responsibilities in order: dedupe via `callback-deduper.ts`, parse via `parseCallbackData`, and dispatch via `dispatchCallbackData` with a hand-built deps object.

3. **Pure logic (DI-friendly)**:
   - `apps/bot/src/callback-data.ts` — single source of truth for the wire format of `callback_data` strings. `parseCallbackData` and `formatCallbackData` are inverses; the `CallbackData` discriminated union drives exhaustiveness in the dispatcher's `default` branch (`const _x: never = parsed`). When adding a new button, edit the union, both functions, and the dispatcher together.
   - `apps/bot/src/callback-dispatcher.ts` — receives a parsed `CallbackData` plus a `DispatchDeps` bag (Prisma, `showList`, `showTaskDetail`, `InlineKeyboard`, etc.). It contains all callback business logic and is fully unit-testable without `BOT_TOKEN`/`DATABASE_URL`. Real deps are injected from `bot.ts`; tests pass fakes.
   - `apps/bot/src/callback-deduper.ts` — TTL+size-bounded `Map` to drop duplicate `callback_query.id` retries (Telegram redelivery). Created once per process in `bot.ts`.
   - `apps/bot/src/bot-logic.ts`, `utils.ts` — small pure helpers (`parseAddCommandText`, `escapeHtml`, `kbList`, `isTelegramMessageNotModifiedError`, `PAGE_SIZE`).

### Pending-action state machine

Multi-step UI flows (edit title, confirm draft add, "press ➕ then send text") are persisted as rows in the `PendingAction` table rather than in-memory. Each row carries `kind`, optional `taskId`, optional UI-return context (`panelMode`, `panelPage`, `panelMessageId`), and `draftTitle`. The `message:text` handler in `apps/bot/src/bot.ts` looks up the most recent `PendingAction` for the user and branches on `kind`. The `panelMessageId` is reused so we `editMessageText` the original panel instead of spamming new messages.

### "Message is not modified" handling

Telegram returns 400 when an `editMessageText` would produce identical content (very common when re-rendering the same list). Always wrap edits with `try/catch` and short-circuit via `isTelegramMessageNotModifiedError(e)`. Existing call sites in `bot.ts` and `callback-dispatcher.ts` follow this pattern — preserve it for any new edit.

## Data model (Prisma)

`apps/api/prisma/schema.prisma`:
- `User` — keyed by UUID `id`; `numId` is a stable autoincrement for display, `telegramUserId` is `BigInt` (cast `BigInt(from.id)` when querying).
- `Task` — `numId` (autoincrement) is what's embedded into `callback_data`, NOT `id`. `status` is the `TaskStatus` enum (`open`/`done`); `assignedToId` scopes lists per viewer.
- `PendingAction` — see state machine above. `kind` is the `PendingActionKind` enum (`editTitle`, `addTask`, `addTaskDraft`, `setDueDate`). The `task` relation uses `onDelete: Cascade` — deleting a Task cascades to its PendingActions.
- `Invite` — currently unused by handlers but defined.

Indexes on `(status, assignedToId)` and `(status, createdById)` back the list queries in `getTasksForMode`.

## Conventions

- ESM-only (`"type": "module"` in all package.json files). Always import with `.js` suffixes in TS source — required by Node ESM resolution.
- Node 24 (`.nvmrc`, `engines.node`).
- Tests live next to sources as `*.test.ts`; `tsconfig.json` excludes them from `tsc` output, and `vitest.config.ts` includes only them.
- Logs must not include full Telegram update bodies (truncate to 120 chars, see `apps/bot/src/server.ts`). Don't add verbose logging that could leak user text.
- Privacy: list queries are scoped to the viewer (`assignedToId = viewer.id`) — preserve this when adding new list queries.
- `@orbit/contracts` (`packages/contracts/`) owns all Zod schemas for HTTP request/response types. Import from there; never duplicate schema definitions in bot or api.
