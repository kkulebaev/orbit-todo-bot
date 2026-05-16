/**
 * Prisma seed — registered via package.json#prisma.seed (run with `prisma db seed`).
 *
 * Seeds the bot's synthetic system user + its PAT row. The row exists so the
 * api-side `resolveCredential` can find the PAT by its SHA-256 hash; the bot's
 * PAT plaintext is set on the bot service via env (`BOT_PAT`) and never
 * appears in this script or in the DB.
 *
 * Idempotent: re-running with the same `BOT_PAT_USER_ID` / `BOT_PAT_SHA256`
 * is a no-op (upsert on unique constraints).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const userId = process.env.BOT_PAT_USER_ID;
  const tokenHash = process.env.BOT_PAT_SHA256;
  if (!userId || !tokenHash) {
    console.log(
      "[seed] BOT_PAT_USER_ID or BOT_PAT_SHA256 not set; skipping bot PAT seed.",
    );
    return;
  }
  // The bot's synthetic User row carries telegramUserId=0 as a sentinel —
  // it is never the viewer of any request (canImpersonate=true PATs always
  // resolve the viewer from the X-Telegram-User-Id header).
  await prisma.user.upsert({
    where: { telegramUserId: BigInt(0) },
    update: {},
    create: {
      id: userId,
      telegramUserId: BigInt(0),
      username: "orbit-bot",
      firstName: "Orbit Bot",
    },
  });
  await prisma.personalAccessToken.upsert({
    where: { tokenHash },
    update: {},
    create: {
      userId,
      tokenHash,
      label: "orbit-bot",
      canImpersonate: true,
    },
  });
  console.log("[seed] bot PAT seeded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
