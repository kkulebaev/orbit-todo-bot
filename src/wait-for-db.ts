import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const maxMs = Number(process.env.DB_WAIT_MAX_MS ?? 120_000);
  const intervalMs = Number(process.env.DB_WAIT_INTERVAL_MS ?? 5_000);

  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < maxMs) {
    attempt++;
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log(`DB ready (attempt ${attempt})`);
      return;
    } catch (e) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`Waiting for DB... attempt=${attempt} elapsed=${elapsed}s`);
      // Optional: log minimal error hint
      // console.log(String(e));
      await sleep(intervalMs);
    }
  }

  throw new Error(`DB not reachable after ${Math.round(maxMs / 1000)}s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
