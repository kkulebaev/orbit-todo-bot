# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — run the bot in dev mode via `tsx src/bot.ts` (loads `.env`, registers handlers, but does NOT start the webhook server; useful for handler-only iteration).
- `npm start` — run the compiled webhook server (`node dist/server.js`); requires `npm run build` first.
- `npm run build` — TypeScript compile to `dist/` (`tsc -p tsconfig.json`).
- `npm run typecheck` — type-check without emit.
- `npm test` — run Vitest once. `npm run test:watch` for watch mode.
- Run a single test file: `npx vitest run src/callback-data.test.ts`. Filter by name: `npx vitest run -t "parses v:list"`.
- `npm run prisma:generate` / `npm run prisma:migrate` — Prisma client generation and `migrate deploy`. For local schema iteration without migrations, `docker-compose.yml` uses `prisma db push`.
- Local Postgres: `docker compose up -d` (starts only `db` service in normal local dev; the `bot` service is provided for full-container runs).

## Runtime entry points

- `src/server.ts` is the production entry. When `import.meta.url` matches `process.argv[1]`, it dynamically imports `./bot.js` (registering all grammY handlers as a side-effect), then `./bot-instance.js`, and starts Express on `0.0.0.0:$PORT`. Telegram webhook is set externally (the README mentions it's registered after deploy; the code itself only exposes `bot.api.setWebhook`).
- `src/bot.ts` is the dev entry (`npm run dev`) and the side-effectful module that wires every handler onto the shared `bot` from `bot-instance.ts`. Importing `bot.ts` mutates the singleton; do not import it from tests.
- `src/bot-instance.ts` instantiates the grammY `Bot` once. Both `bot.ts` and `server.ts` consume this same instance — keep instantiation here so handlers and `handleUpdate` share state.

## Architecture

Three-layer split designed to keep grammY/Prisma out of unit tests:

1. **Transport (`server.ts`)** — Express app with `POST /telegram/webhook` and `GET /healthz`. `createApp(bot)` is exported separately from `startServer` so tests can mount it with a fake bot. The webhook handler does minimal logging (truncated text, no secrets) and forwards `req.body` to `bot.handleUpdate`.

2. **Handler registration (`bot.ts`)** — grammY commands (`/start`, `/help`, `/add`, `/my`, `/done`, `/cancel`), the `message:text` handler that drives the pending-action state machine, and the `callback_query:data` handler. The callback handler has three responsibilities in order: dedupe via `callback-deduper.ts`, parse via `parseCallbackData`, and dispatch via `dispatchCallbackData` with a hand-built deps object.

3. **Pure logic (DI-friendly)**:
   - `callback-data.ts` — single source of truth for the wire format of `callback_data` strings. `parseCallbackData` and `formatCallbackData` are inverses; the `CallbackData` discriminated union drives exhaustiveness in the dispatcher's `default` branch (`const _x: never = parsed`). When adding a new button, edit the union, both functions, and the dispatcher together.
   - `callback-dispatcher.ts` — receives a parsed `CallbackData` plus a `DispatchDeps` bag (Prisma, `showList`, `showTaskDetail`, `InlineKeyboard`, etc.). It contains all callback business logic and is fully unit-testable without `BOT_TOKEN`/`DATABASE_URL`. Real deps are injected from `bot.ts`; tests pass fakes.
   - `callback-deduper.ts` — TTL+size-bounded `Map` to drop duplicate `callback_query.id` retries (Telegram redelivery). Created once per process in `bot.ts`.
   - `bot-logic.ts`, `utils.ts` — small pure helpers (`parseAddCommandText`, `escapeHtml`, `kbList`, `isTelegramMessageNotModifiedError`, `PAGE_SIZE`).

### Pending-action state machine

Multi-step UI flows (edit title, confirm draft add, "press ➕ then send text") are persisted as rows in the `PendingAction` table rather than in-memory. Each row carries `kind`, optional `taskId`, optional UI-return context (`panelMode`, `panelPage`, `panelMessageId`), and `draftTitle`. The `message:text` handler in `bot.ts` looks up the most recent `PendingAction` for the user and branches on `kind`. The `panelMessageId` is reused so we `editMessageText` the original panel instead of spamming new messages.

### "Message is not modified" handling

Telegram returns 400 when an `editMessageText` would produce identical content (very common when re-rendering the same list). Always wrap edits with `try/catch` and short-circuit via `isTelegramMessageNotModifiedError(e)`. Existing call sites in `bot.ts` and `callback-dispatcher.ts` follow this pattern — preserve it for any new edit.

## Data model (Prisma)

`prisma/schema.prisma`:
- `User` — keyed by UUID `id`; `numId` is a stable autoincrement for display, `telegramUserId` is `BigInt` (cast `BigInt(from.id)` when querying).
- `Task` — `numId` (autoincrement) is what's embedded into `callback_data`, NOT `id`. `status` is the `TaskStatus` enum (`open`/`done`); `assignedToId` scopes lists per viewer.
- `PendingAction` — see state machine above. `kind` is the `PendingActionKind` enum (`editTitle`, `addTask`, `addTaskDraft`).
- `Invite` — currently unused by handlers but defined.

Indexes on `(status, assignedToId)` and `(status, createdById)` back the list queries in `getTasksForMode`.

## Conventions

- ESM-only (`"type": "module"` in package.json). Always import with `.js` suffixes in TS source — required by Node ESM resolution.
- Node 22 (`.nvmrc`, `engines.node`).
- Tests live next to sources as `*.test.ts`; `tsconfig.json` excludes them from `tsc` output, and `vitest.config.ts` includes only them.
- Logs must not include full Telegram update bodies (truncate to 120 chars, see `server.ts`). Don't add verbose logging that could leak user text.
- Privacy: list queries are scoped to the viewer (`assignedToId = viewer.id`) — preserve this when adding new list queries.
