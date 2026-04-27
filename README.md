<p align="center">
  <img src="./assets/orbit-banner.svg" alt="Orbit TODO Bot" />
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-Telegram-26A5E4" />
  <img alt="runtime" src="https://img.shields.io/badge/runtime-Node.js-339933" />
  <img alt="db" src="https://img.shields.io/badge/db-PostgreSQL-336791" />
  <img alt="orm" src="https://img.shields.io/badge/ORM-Prisma-2D3748" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-informational" />
</p>

# Orbit TODO Bot

A small, private Telegram TODO bot for personal use, families, and small teams.

- Webhook-based (no long polling)
- PostgreSQL storage (Prisma)
- Inline keyboard UX (quick actions)

---

## Features

- Create tasks with `/add <text>`
- Two lists:
  - **⏳ В работе**
  - **🗂️ Выполненные**
- Task actions via inline buttons:
  - Done / Reopen
  - Edit title
  - Delete
- Minimal logs (no secrets)

---

## Tech stack

- **Node.js** (ESM)
- **grammY** (Telegram Bot API)
- **Express** (webhook HTTP server)
- **Prisma + PostgreSQL**
- **Vitest** (tests)

---

## Project structure

- `src/bot.ts` — bot commands, list rendering, task screens
- `src/callback-dispatcher.ts` — callback_data routing (DI-friendly, unit-tested)
- `src/server.ts` — webhook server (`POST /telegram/webhook`, `GET /healthz`)
- `prisma/schema.prisma` — DB schema

---

## Environment variables

Required:
- `BOT_TOKEN` — Telegram Bot token (BotFather)
- `DATABASE_URL` — Postgres connection string

Optional:
- `PORT` — server port (default `3000`)

---

## Local development

### Requirements
- Node.js **24** (see `.nvmrc`)
- A reachable Postgres instance (e.g. Railway Postgres) — set `DATABASE_URL` in `.env`

### Start

```bash
npm ci

npm run dev
```

Server:
- `POST /telegram/webhook`
- `GET /healthz` → `ok`

---

## Database

This repo uses Prisma migrations.

Typical flow:

```bash
npx prisma generate
npx prisma migrate deploy
```

---

## Tests

```bash
npm test
npm run typecheck
```

---

## Deployment

### Railway (recommended)

1) Create a **PostgreSQL** database (Railway Postgres)
2) Deploy this repo as a service — Railway picks up the `Dockerfile` automatically
3) Set environment variables:
   - `BOT_TOKEN`
   - `DATABASE_URL`

The image runs `npx prisma migrate deploy && node dist/server.js` on start.

After the service is up, register the Telegram webhook (one-time).

---

## Safety notes

- Do not commit `.env`
- Do not log request bodies fully (Telegram updates may contain personal text)
- Prefer private chats for usage

---

## License

MIT
