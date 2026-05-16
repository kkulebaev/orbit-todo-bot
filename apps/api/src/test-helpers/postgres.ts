import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";

export interface TestDb {
  container: StartedPostgreSqlContainer;
  prisma: PrismaClient;
  url: string;
}

/**
 * Start a fresh PostgreSQL container and run all Prisma migrations against it.
 *
 * Designed for `beforeAll` in integration tests. Use `stopTestDb` in
 * `afterAll`. Each test file should spin its own container so tests are
 * isolated at the file level; tests within a file isolate via `beforeEach`
 * row cleanup.
 */
export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer(
    "postgres:16-alpine",
  ).start();
  const url = container.getConnectionUri();

  // The migrations folder only contains delta files (cascade + expiresAt) with
  // no baseline creation migration — the base tables existed before migrations
  // were introduced. Use `db push` to apply the full current schema to the fresh
  // container without needing a baseline. `--skip-generate` avoids regenerating
  // the already-built Prisma client.
  execSync("pnpm exec prisma db push --skip-generate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();
  return { container, prisma, url };
}

export async function stopTestDb(db: TestDb): Promise<void> {
  await db.prisma.$disconnect();
  await db.container.stop();
}
