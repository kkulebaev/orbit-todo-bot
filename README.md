<p align="center">
  <img src="./assets/orbit-banner.svg" alt="Orbit TODO Bot banner" />
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-Telegram-26A5E4" />
  <img alt="db" src="https://img.shields.io/badge/db-PostgreSQL-336791" />
  <img alt="orm" src="https://img.shields.io/badge/ORM-Prisma-2D3748" />
  <img alt="runtime" src="https://img.shields.io/badge/runtime-Node.js-339933" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-informational" />
</p>

# Orbit TODO Bot 🪐

Telegram TODO bot for small teams and families.

## Features

- Create tasks for yourself or another user
- Lists with inline buttons (Done/Reopen/Assign/Edit/Delete)
- PostgreSQL storage (via Prisma)

## Deploy on Render (recommended)

1) Create a **PostgreSQL** instance on Render
2) Create a **Web Service** from this repo
3) Set env vars:
   - `BOT_TOKEN`
   - `DATABASE_URL` (from Render Postgres)
   - `PUBLIC_URL` (your Render service URL, e.g. `https://orbit-todo-bot.onrender.com`)
4) Build Command:

```bash
npm ci && npm run build && npx prisma generate
```

5) Start Command:

```bash
npx prisma db push && npm start
```

The service will auto-register Telegram webhook at:
`$PUBLIC_URL/telegram/webhook`

## Development

### Requirements
- Node.js **22**
- Docker (for local Postgres)

### Environment variables
Create `.env` (not committed) with at least:
- `BOT_TOKEN` — Telegram bot token
- `PUBLIC_URL` — public https URL where Telegram can reach the webhook
  - for local dev you can use a tunnel (ngrok/cloudflared) and set it here

`DATABASE_URL` is taken from the environment. In `docker-compose.yml` it is set to a local Postgres inside the compose network.

### Local run (webhook server + DB)
Start Postgres + app in dev mode:

```bash
docker compose up -d
```

The server exposes:
- `POST /telegram/webhook`
- `GET /healthz` → `ok`

### Tests
```bash
npm ci
npm test
```

### Typecheck
```bash
npm run typecheck
```

## CI
GitHub Actions runs on every PR and on pushes to `main`:
- `npm test`
- `npm run typecheck`

## Production deploy (SSH + Docker Compose)
On the prod server (`n8n-vps`), the project lives in `/opt/orbit-todo-bot`.

Typical deploy:
```bash
ssh n8n-vps
cd /opt/orbit-todo-bot

git pull --ff-only origin main

docker compose -f docker-compose.prod.yml build --pull

docker compose -f docker-compose.prod.yml up -d

docker compose -f docker-compose.prod.yml ps

docker compose -f docker-compose.prod.yml logs --tail=80 orbit-bot
```

## Notes

- `.env` is intentionally not committed.
- Local DB data is stored in a Docker volume (`todo_pg`).
