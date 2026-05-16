<p align="center">
  <img src="./assets/orbit-banner.svg" alt="Orbit TODO" />
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-Telegram-26A5E4" />
  <img alt="runtime" src="https://img.shields.io/badge/runtime-Node.js-339933" />
  <img alt="db" src="https://img.shields.io/badge/db-PostgreSQL-336791" />
  <img alt="orm" src="https://img.shields.io/badge/ORM-Prisma-2D3748" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-informational" />
</p>

# Orbit TODO

A small, private Telegram TODO bot for personal use, families, and small teams.

- Two-service architecture: thin Telegram client + REST API
- Webhook-based (no long polling)
- PostgreSQL storage (Prisma, owned by API only)
- Inline keyboard UX (quick actions)

---

## Features

- Create tasks with `/add <text>`, or just send any text
- Lists:
  - **⏳ В работе** (open) with due-soon priority surface
  - **🗂️ Выполненные** (done)
- Task actions via inline buttons:
  - Done / Reopen
  - Edit title
  - Set due date (`DD.MM.YYYY [HH:MM]`)
  - Delete (cascades to pending sessions)
- Russian date rendering (`сегодня`, `завтра`, `через 3 дня`, `15 мая`)
- Atomic completion of state-machine flows (single API transaction)
- Minimal logs (no secrets, truncated to 120 chars)

---

## Tech stack

- **Node.js 24** (ESM)
- **pnpm 10** workspace
- **grammY** (Telegram Bot API)
- **Express 5** (webhook + REST)
- **Prisma 6 + PostgreSQL**
- **Zod** (shared wire contracts)
- **Vitest** (workspace tests; testcontainers for API integration)

---

## Workspace layout

```
orbit-todo/
├── apps/
│   ├── bot/                  # @orbit/bot — Telegram webhook, pure HTTP client
│   └── api/                  # @orbit/api — REST + Prisma
├── packages/
│   └── contracts/            # @orbit/contracts — Zod schemas + TS types
├── docs/
│   └── railway-deploy.md     # Deployment runbook
└── pnpm-workspace.yaml
```

`@orbit/contracts` is the single source of truth for the HTTP wire format
shared between bot and api.

The bot has **no** database access. Every persistent operation goes through
`@orbit/api` over Railway's private network.

---

## HTTP surface (`@orbit/api`)

Base: `http://<api-host>/v1`. All endpoints require:
- `Authorization: Bearer ${API_BOT_TOKEN}`
- `X-Telegram-User-Id: <bigint>`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/healthz` | Public, no auth |
| `GET` | `/v1/users/me` | Upserts viewer |
| `GET` | `/v1/tasks?mode=my\|due-soon\|done&page=N` | List |
| `GET` | `/v1/tasks/:numId` | 404 on owner mismatch |
| `POST` | `/v1/tasks` | Idempotency-Key |
| `PATCH` | `/v1/tasks/:numId` | 404 on owner mismatch |
| `DELETE` | `/v1/tasks/:numId` | Cascades to pending sessions |
| `GET` | `/v1/sessions/latest?kind=…` | Opaque payload |
| `POST` | `/v1/sessions` | Opaque payload |
| `PATCH` | `/v1/sessions/:id` | |
| `DELETE` | `/v1/sessions/:id` | |
| `POST` | `/v1/sessions/:id/commit` | Atomic task update + session delete |

---

## Environment variables

### `@orbit/bot`
- `BOT_TOKEN` — Telegram bot token (BotFather)
- `WEBHOOK_SECRET` — random secret for Telegram webhook validation
- `API_BASE_URL` — e.g. `http://<api-private-host>:8080`
- `BOT_PAT` — bot's Personal Access Token plaintext (`orbit_pat_…`); replaces the legacy `API_BOT_TOKEN`

### `@orbit/api`
- `DATABASE_URL` — PostgreSQL connection string
- `BOT_PAT_USER_ID` — fixed UUID for the bot's system user row (seeded on first deploy)
- `BOT_PAT_SHA256` — lowercase hex SHA-256 of `BOT_PAT` (seeded into DB; plaintext never stored)
- `BOT_PAT_ALLOWED_CIDR` — comma-separated CIDRs allowed for bot-PAT impersonation (e.g. `fd00::/8,::1`)
- `API_PUBLIC_EXPOSURE` — `true` to mount `/v1/*` on the public domain; `false` (default) for internal-only
- `PORT` — Railway injects this; defaults to 8080

See `.env.example` for a complete template.

---

## Local development

### Requirements
- Node.js **24** (see `.nvmrc`)
- pnpm **10** (`corepack enable`; version pinned in `package.json#packageManager`)
- PostgreSQL reachable via `DATABASE_URL` (e.g. a Railway preview DB)
- Docker (only for `pnpm --filter @orbit/api test` — `@testcontainers/postgresql`)

### Setup

```bash
pnpm install --frozen-lockfile
pnpm --filter @orbit/contracts build
pnpm --filter @orbit/api exec prisma generate
```

### Run

```bash
# API (port 8080)
pnpm --filter @orbit/api dev

# Bot (port 3000), in a separate shell
API_BASE_URL=http://localhost:8080 API_BOT_TOKEN=<token> \
  pnpm --filter @orbit/bot dev
```

API endpoints:
- `POST /telegram/webhook` (bot)
- `GET /healthz` (both services)

---

## Database

This repo uses Prisma migrations. They live in `apps/api/prisma/migrations/`
and are owned by `@orbit/api` only.

```bash
pnpm --filter @orbit/api exec prisma generate
pnpm --filter @orbit/api exec prisma migrate deploy
```

In production, `prisma migrate deploy` runs from the API's Docker `CMD`
on every container start (Prisma's advisory lock makes it parallel-safe).

---

## Tests

```bash
pnpm -r typecheck
pnpm -r test
```

Totals: 26 (contracts) + 94 (bot) + 28 (api integration via testcontainers).

```bash
pnpm --filter @orbit/bot lint   # ESLint blocks @prisma/client imports
```

---

## Deployment

See **[docs/railway-deploy.md](./docs/railway-deploy.md)** for the full Railway runbook —
two services, env matrix, IPv6 binding, migrations-in-CMD, rollback procedure.

After services are healthy, register the Telegram webhook once:

```bash
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://<bot-public-url>/telegram/webhook\",\"secret_token\":\"${WEBHOOK_SECRET}\"}"
```

---

## Safety notes

- Do not commit `.env` (`.env.example` is the template).
- Webhook logs are truncated to 120 chars — keep that invariant.
- List queries are scoped by `assignedToId = viewer.id` in API (mutations
  return 404, not 403, on owner mismatch — privacy preserved).

---

## CLI installation

```bash
# 1. Build
pnpm --filter @orbit/contracts build
pnpm --filter @orbit/api-client build
pnpm --filter @orbit/cli build

# 2. Link globally (run from the repo root — pnpm link --global must be run inside the package dir)
cd apps/cli && pnpm link --global && cd -
```

This exposes an `orbit` binary on your PATH via pnpm's global bin directory
(`pnpm root -g`/`../bin` — add that to `PATH` if not already present).

> `npm publish` is a future follow-up (F4). For now the dev recipe above is the
> only install path.

---

## CLI commands

Obtain a PAT first:

1. In Telegram: `/cli_link [optional label]`. The bot DMs a token matching
   `orbit_pat_…`.
2. `orbit login --token <pasted-token>` — saves to config.
3. `orbit whoami` — confirms the connection.

| Command | Purpose |
|---|---|
| `orbit login --token <pat>` | Save a PAT minted via `/cli_link` in the bot |
| `orbit logout` | Delete local config (does not revoke the PAT server-side) |
| `orbit whoami [--json]` | Show authenticated user |
| `orbit list [--mode my\|due-soon\|done] [--page N] [--json]` | List tasks |
| `orbit show <numId> [--json]` | Show one task by numeric id |
| `orbit add <text...> [--due "DD.MM.YYYY [HH:MM]"] [--json]` | Create a task |
| `orbit done <numId> [--json]` | Mark a task done |
| `orbit reopen <numId> [--json]` | Reopen a done task |
| `orbit edit <numId> --title T \| --due D \| --no-due [--json]` | Update title or due date |
| `orbit rm <numId> --yes` | Delete a task (requires `--yes`) |
| `orbit tokens list [--json]` | List your PATs |
| `orbit tokens revoke <id>` | Revoke a PAT by id |

**Exit codes:** 0 ok · 1 generic · 2 auth · 3 not-found · 4 network.

`--json` is supported on every command. `--idempotency-key <key>` is accepted
on every mutation (`add`, `done`, `reopen`, `edit`, `rm`, `tokens revoke`);
omit to auto-generate a `randomUUID()`.

**Config file:** `$XDG_CONFIG_HOME/orbit/config.json` (default
`~/.config/orbit/config.json`), written with mode `0600`. Add to `.gitignore`:

```
.config/orbit/config.json
```

**Env overrides:** `ORBIT_API_BASE_URL`, `ORBIT_TOKEN` (override config
without touching the file — useful for scripting and CI).

---

## Smoke test

`scripts/smoke.sh` exercises the deployed Railway API end-to-end. Requires a
real PAT (mint one via `/cli_link` in the bot):

```bash
ORBIT_TOKEN=orbit_pat_… bash scripts/smoke.sh
# or with a custom base URL:
ORBIT_TOKEN=orbit_pat_… ORBIT_API_BASE_URL=https://orbit-todo-api.up.railway.app bash scripts/smoke.sh
```

This script is intentionally not wired into CI (it requires live secrets).
Run it manually after deploy to verify the production API.

---

## License

MIT
