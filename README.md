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

Telegram TODO bot for personal use (Kostya + Dasha).

## Features

- Create tasks for yourself or another user
- Lists with inline buttons (Done/Reopen/Assign/Edit/Delete)
- PostgreSQL storage (via Prisma)

## Local run (dev)

1) Create `.env` from `.env.example`
2) Start services:

```bash
docker compose up -d
```

## Notes

- `.env` is intentionally not committed.
- Database data is stored in a Docker volume (`todo_pg`).
