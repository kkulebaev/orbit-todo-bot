# Railway Deployment Guide

This guide covers deploying the `orbit-todo-bot` monorepo to Railway as two separate services:
- **bot** — grammY webhook server (`@orbit/bot`)
- **api** — REST API with Prisma (`@orbit/api`)

---

## Architecture Overview

```
Telegram ──webhook──▶ bot (Railway service)
                         │
                         │ HTTP (private network)
                         ▼
                      api (Railway service)  ◀──▶  Postgres plugin
```

The bot communicates with the API over Railway's private network at
`http://api.railway.internal:8080`. No TLS is required on the internal network.

---

## Prerequisites

- Railway project created
- Postgres plugin provisioned (attached to the **api** service only)
- Telegram bot token obtained from @BotFather
- `API_BOT_TOKEN` generated (a shared secret, e.g. `openssl rand -hex 32`)

---

## Step 1 — Create the `api` Service

1. **New Service → Empty Service**, name it `api`.
2. Set **Source → GitHub repo** (root of this repo).
3. Under **Settings → Build**:
   ```
   RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile
   ```
4. Under **Settings → Deploy**:
   - **Release Command**: `pnpm exec prisma migrate deploy`
   - **Num Replicas**: `1`

   > **Why `numReplicas: 1`?** The idempotency guard is an in-memory LRU cache
   > (10k entries / 24h TTL). Multiple replicas would cause cache misses on
   > repeated requests routed to different instances. If you later need
   > horizontal scaling, replace the in-memory cache with a Redis-backed store.

5. **Connect Postgres plugin** to the `api` service so `DATABASE_URL` is
   injected automatically.

6. Set environment variables for `api`:

   | Variable | Value | Notes |
   |---|---|---|
   | `DATABASE_URL` | *(injected by Postgres plugin)* | Postgres connection string |
   | `API_BOT_TOKEN` | `<shared secret>` | Bearer token the bot presents; use Railway shared variable |
   | `PORT` | *(injected by Railway)* | Default 8080 |
   | `NODE_ENV` | `production` | |
   | `LOG_LEVEL` | `info` | Optional; pino log level |

---

## Step 2 — Create the `bot` Service

1. **New Service → Empty Service**, name it `bot`.
2. Set **Source → GitHub repo** (same root).
3. Under **Settings → Build**:
   ```
   RAILWAY_DOCKERFILE_PATH=apps/bot/Dockerfile
   ```
4. Set environment variables for `bot`:

   | Variable | Value | Notes |
   |---|---|---|
   | `BOT_TOKEN` | `<Telegram bot token>` | From @BotFather |
   | `WEBHOOK_SECRET` | `<random secret>` | Validates Telegram secret_token header |
   | `API_BASE_URL` | `http://api.railway.internal:8080` | Private network URL of the api service |
   | `API_BOT_TOKEN` | `<shared secret>` | Must match api's `API_BOT_TOKEN`; use Railway shared variable |
   | `DATABASE_URL` | *(set on P0–P4 only)* | Remove after P5 cutover (bot stops using Prisma) |
   | `PORT` | *(injected by Railway)* | Default 3000 |
   | `NODE_ENV` | `production` | |

   > **After P5**: remove `DATABASE_URL` from bot's environment entirely.
   > Do NOT attach the Postgres plugin to the bot service.

---

## Step 3 — Register the Telegram Webhook

After the bot service has a public URL (e.g. `https://bot-production.railway.app`), register the webhook once:

```bash
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://bot-production.railway.app/telegram/webhook",
    "secret_token": "'${WEBHOOK_SECRET}'"
  }'
```

---

## Step 4 — Smoke Tests

After both services are deployed, verify:

```bash
# API healthz (from a machine with Railway private-network access, or via Railway shell)
curl http://api.railway.internal:8080/healthz
# Expected: {"ok":true,"service":"api"}

# Bot healthz (public URL)
curl https://bot-production.railway.app/healthz
# Expected: ok

# API bearer auth (replace <token> and <telegram-user-id>)
curl -H "Authorization: Bearer <API_BOT_TOKEN>" \
     -H "X-Telegram-User-Id: 123456789" \
     http://api.railway.internal:8080/v1/users/me
# Expected: 200 UserDto
```

---

## Env Variable Matrix (summary)

| Variable | `bot` | `api` | Notes |
|---|---|---|---|
| `BOT_TOKEN` | ✅ required | — | Telegram |
| `WEBHOOK_SECRET` | ✅ required | — | Telegram webhook validation |
| `API_BASE_URL` | ✅ required | — | `http://api.railway.internal:8080` |
| `API_BOT_TOKEN` | ✅ required | ✅ required | Shared Bearer; Railway shared variable |
| `SHADOW_MODE` | optional | — | `true` to enable P2 schema-canary; default `false` |
| `READ_FROM_API` | optional | — | `true` to route task READs through api (P3); default `false` |
| `DATABASE_URL` | P0–P4 only | ✅ required | Postgres plugin on api; remove from bot after P5 |
| `PORT` | ✅ injected | ✅ injected | Railway sets this automatically |
| `NODE_ENV` | `production` | `production` | |
| `LOG_LEVEL` | optional | optional | pino level; default `info` |

---

## Release Command vs Start Command

> **AC-10**: `prisma migrate deploy` runs in the **Release Command** of the `api`
> service, not inside the Docker `CMD`.

Railway runs the release command *before* traffic is shifted to the new deploy.
If the migration fails, the deploy is aborted and the previous version keeps serving traffic.

Setting it in `CMD` would run it on every container restart, which is slow and
risky (e.g. during autoscaling or crash loops).

**Railway api service settings:**
- Release Command: `pnpm exec prisma migrate deploy`
- Start Command: *(leave blank — Docker `CMD` handles it)*

---

## Rollback

### API rollback
In Railway dashboard → `api` service → **Deployments** → click the previous
deployment → **Redeploy**.

If a migration was applied: manually revert using Prisma migration squash or
restore from the Postgres plugin backup. Railway Postgres has point-in-time
recovery enabled by default.

### Bot rollback
Railway dashboard → `bot` service → **Deployments** → **Redeploy** previous.

Feature-flag rollback (P2–P4): set `READ_FROM_API=false` or `WRITE_VIA_API=false`
and redeploy — no migration needed.

---

## P2 Rollout (shadow mode)

Shadow mode is a **schema-canary**: the bot makes a parallel HTTP call to the
API for each READ flow and validates the response with Zod. The user always
receives the Prisma result — the API call is fire-and-forget.

After the `api` service is deployed and healthy:

1. Add to the `bot` service environment variables:
   - `API_BASE_URL=http://<api-internal-hostname>.railway.internal:8080`
     (copy the private-network hostname from the `api` service Settings page)
   - `API_BOT_TOKEN=<same value as the api service>` (Railway shared variable)
   - `SHADOW_MODE=true`
2. Redeploy the `bot` service.
3. Observe Railway bot logs for **24 hours**. Expect entries like:
   ```
   shadow call { shadow: 'listTasks:my:p0', status: 'ok', ms: 12 }
   ```
   Warnings (`shadow call diverged`) indicate a schema mismatch between
   `@orbit/api` and `@orbit/contracts`. Target: **< 0.5% divergence rate**.
4. If the divergence rate is high — inspect the warning log's `issues` field to
   find the contract drift. **Do NOT proceed to P3** until resolved.
5. If green for 24 h — ready for P3 (`READ_FROM_API=true`).

**Rollback**: set `SHADOW_MODE=false` and redeploy — zero database impact.

---

## P3 Rollout (READ via API)

Prereq: P2 shadow stable ≥ 24h with divergence < 0.5%.

1. In Railway bot service variables, ADD:
   - `READ_FROM_API=true`

   > Keep `SHADOW_MODE=false` — enabling both would double API calls for the same reads.
   > Turn `SHADOW_MODE` off before enabling `READ_FROM_API`.

2. Redeploy the bot service.
3. Monitor for **48h**:
   - Bot logs: `[read-from-api]` warnings indicate API failures → bot falls back to Prisma
     (user-visible result is OK, but each warning is an observability red flag).
   - Target: API success rate > 99.5%, p95 latency < 200ms (Railway internal network).
4. If green for 48h → ready for P4 (WRITE_VIA_API + Railway recreate strategy + cutover).
5. Rollback: set `READ_FROM_API=false` and redeploy. Bot returns to Prisma direct reads.

> **Note**: `mode=done` task list always uses Prisma until P4 — the API currently exposes only
> `mode=my|due-soon`.

---

## P4 Cutover Notes (replicas)

During P4 cutover (`WRITE_VIA_API=true`):

1. Set bot service **Num Replicas** to `1` and **Deploy Strategy** to `Recreate`.
2. This causes a ~30–60s downtime while the single bot instance restarts.
3. Document this maintenance window to users beforehand.
4. After cutover is stable (30+ min monitoring), revert bot to rolling deploy.

**Auto-abort trigger**: if error-rate exceeds 2% over 5 minutes, set
`WRITE_VIA_API=false` and use the Railway rollback button.
