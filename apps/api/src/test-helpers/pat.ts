import { createHash, randomBytes } from "node:crypto";
import type {
  PersonalAccessToken,
  PrismaClient,
  User,
} from "@prisma/client";

/**
 * Mint a PAT row for integration-test fixtures.
 *
 * Returns the plaintext (only available here — server stores hash only),
 * the persisted row, and the bound User. Plaintext matches the AC-P2-12
 * regex `/^orbit_pat_[A-Za-z0-9_-]{43,}$/`.
 *
 * Pass `canImpersonate: true` for bot-PAT fixtures (the per-test bot user is
 * created with a random unique `telegramUserId`). Pass `canImpersonate: false`
 * (default) for user PAT fixtures bound to a specific subject user.
 *
 * If `userId` is omitted, a new User row is created (random `telegramUserId`
 * to avoid the `@unique` collision across tests).
 */
export async function createTestPat(
  prisma: PrismaClient,
  opts: {
    userId?: string;
    canImpersonate?: boolean;
    telegramUserId?: bigint;
    label?: string;
  } = {},
): Promise<{
  plaintext: string;
  row: PersonalAccessToken;
  user: User;
}> {
  const plaintext = `orbit_pat_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(plaintext).digest("hex");

  let userId = opts.userId;
  let user: User;
  if (!userId) {
    const tg =
      opts.telegramUserId ??
      BigInt(Math.floor(Date.now() + Math.random() * 1_000_000));
    user = await prisma.user.create({
      data: { telegramUserId: tg },
    });
    userId = user.id;
  } else {
    user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  }

  const row = await prisma.personalAccessToken.create({
    data: {
      userId,
      tokenHash,
      label: opts.label,
      canImpersonate: opts.canImpersonate ?? false,
    },
  });

  return { plaintext, row, user };
}
