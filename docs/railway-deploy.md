# Railway Deployment Guide

This guide covers deploying the `orbit-todo` monorepo to Railway as two separate services:
- **bot** — grammY webhook server (`@orbit/bot`), pure HTTP client of `@orbit/api`
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
   - **Healthcheck Path**: `/healthz`
   - **Num Replicas**: `1`

   > **Why `numReplicas: 1`?** The idempotency guard is an in-memory LRU cache
   > (10k entries / 24h TTL). Multiple replicas would cause cache misses on
   > repeated requests routed to different instances. If you later need
   > horizontal scaling, replace the in-memory cache with a Redis-backed store.

   Migrations are applied automatically by the API's Docker `CMD` at every
   container start. Prisma's advisory lock makes parallel container starts safe.

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
   | `PORT` | *(injected by Railway)* | Default 3000 |
   | `NODE_ENV` | `production` | |

   > **Do NOT** attach the Postgres plugin to the bot service. `DATABASE_URL` is
   > not used by the bot. The bot is a pure HTTP client of `@orbit/api`.

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
| `DATABASE_URL` | ❌ **not set** | ✅ required | Postgres plugin on api only |
| `PORT` | ✅ injected | ✅ injected | Railway sets this automatically |
| `NODE_ENV` | `production` | `production` | |
| `LOG_LEVEL` | optional | optional | pino level; default `info` |

---

## Migrations: where they run

`prisma migrate deploy` is part of the API container's Docker `CMD`:

```dockerfile
CMD ["sh", "-c", "pnpm --filter @orbit/api exec prisma migrate deploy && node …/server.js"]
```

Rationale:
- Railway does not have a service-level "release command" that runs out-of-band
  before the container starts (only per-deploy commands inside the container).
- Prisma uses a PostgreSQL advisory lock during `migrate deploy`, so concurrent
  container starts can't corrupt migration state.
- With `numReplicas: 1` (required for the LRU idempotency invariant), there is
  exactly one migrate per deploy anyway.

The trade-off is that a failing migration crashes the new container instead of
being detected before traffic shift. With manual deploys and small migrations
this is acceptable; revisit if you move to blue/green.

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

---

## P5 — Post-cutover (stable state)

The bot has no DB access. `@prisma/client` and `DATABASE_URL` are removed from
`@orbit/bot`. The bot is a pure HTTP client of `@orbit/api`.

**Railway settings (post-P5):**
- `bot` service: default rolling deploy strategy (recreate no longer needed).
- `api` service: `numReplicas=1` invariant preserved (in-memory LRU idempotency).

**Bot env vars (P5+):** `BOT_TOKEN`, `WEBHOOK_SECRET`, `API_BASE_URL`, `API_BOT_TOKEN`.

The following flags were removed in P5 and are no longer recognised by the bot:
`WRITE_VIA_API`, `READ_FROM_API`, `SHADOW_MODE`, `DATABASE_URL`.
Setting them has no effect.

---

## Rolling deploy: PAT migration (P2)

The P2 release replaces the shared API_BOT_TOKEN auth path with PATs. The
operational sequence (testable as AC-P2-22) is:

1. **Generate the bot's PAT and seed env vars** (one-time, off-Railway):
   ```
   BOT_PAT=orbit_pat_$(openssl rand -base64 32 | tr -d '=' | tr '/+' '_-')
   BOT_PAT_SHA256=$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$BOT_PAT")
   BOT_PAT_USER_ID=$(uuidgen | tr 'A-Z' 'a-z')
   echo "BOT_PAT=$BOT_PAT"
   echo "BOT_PAT_USER_ID=$BOT_PAT_USER_ID"
   echo "BOT_PAT_SHA256=$BOT_PAT_SHA256"
   ```
   Record these three values in a secure secret manager — `BOT_PAT` is shown
   once; the rest are derivable from it.

2. **Set Railway env vars (api service):**
   - `API_PUBLIC_EXPOSURE=false` (keep public traffic disabled during cutover)
   - `BOT_PAT_USER_ID=<from step 1>`
   - `BOT_PAT_SHA256=<from step 1>`
   - `BOT_PAT_ALLOWED_CIDR=fd00::/8,::1` (Railway internal IPv6 + loopback)
   - `RATE_LIMIT_PER_MIN=60` (optional, default 60)

3. **Deploy the api service.** The Docker CMD now runs `prisma migrate deploy &&
   prisma db seed && node dist/server.js`. The seed reads BOT_PAT_USER_ID +
   BOT_PAT_SHA256 and writes the bot's PAT row. With API_PUBLIC_EXPOSURE=false
   the public domain returns 404 on /v1/*; internal traffic from the (still-old)
   bot fails because the old bot still sends API_BOT_TOKEN.

   _Bot may be temporarily broken between steps 3 and 5 — expected._

4. **Set Railway env vars (bot service):**
   - `BOT_PAT=<plaintext from step 1>`
   - **Remove** `API_BOT_TOKEN`.

5. **Deploy the bot service.** The new bot uses BOT_PAT and reaches the new
   api via internal IPv6. Bot is back online.

6. **Flip the public exposure:**
   - On the api service: `API_PUBLIC_EXPOSURE=true`.
   - This causes a redeploy of the api with /v1/* mounted on the public
     domain (`orbit-todo-api.up.railway.app`).

7. **Remove legacy:** `API_BOT_TOKEN` should now be absent from both services'
   env. Verify with the Railway CLI: `railway variables --service api | grep -c
   API_BOT_TOKEN` returns 0 for both.

8. **Smoke test (legacy rejection):**
   ```
   curl -s -o /dev/null -w '%{http_code}\n' \
     -H "Authorization: Bearer <old-API_BOT_TOKEN-value>" \
     -H "X-Telegram-User-Id: <any>" \
     https://orbit-todo-api.up.railway.app/v1/users/me
   ```
   Expect: `401`.

### PAT rotation procedure

To rotate the bot's PAT in the future:
1. Generate a new `BOT_PAT2 / BOT_PAT2_SHA256` (same recipe).
2. Manually insert the new PAT row in the DB (or extend the seed to be additive).
3. Set `BOT_PAT=<new>` on the bot service; deploy.
4. Mark the old row `revokedAt = NOW()`.

---

## Historical: P2–P4 Migration Phases

> The P2 (shadow mode), P3 (READ via API), and P4 (WRITE via API) phased
> migration is **complete**. These sections are kept for reference only.
> The system is now fully on P5 (stable state). No feature flags are needed.

### P2 — Shadow mode (schema-canary)
Shadow mode fired parallel API reads alongside Prisma reads and validated Zod
schema shape. Zero data-canary — users always received the Prisma result.
**Completed.** Flag removed: `SHADOW_MODE`.

### P3 — READ via API
Bot task READs (list + detail) routed through `@orbit/api` with Prisma fallback
on error. **Completed.** Flag removed: `READ_FROM_API`.

### P4 — WRITE via API (cutover)
All task mutations and pending-action sessions routed through `@orbit/api`. No
Prisma fallback — API failure surfaced as "сервис временно недоступен".
Deployed with `Recreate` strategy to avoid dual-writer window.
**Completed.** Flag removed: `WRITE_VIA_API`.
