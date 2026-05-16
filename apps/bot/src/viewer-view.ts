/**
 * ViewerView — a normalized view of the current Telegram user, decoupled from
 * the Prisma `User` model.
 *
 * Why: when `WRITE_VIA_API=true` (P4 cutover), the bot has no direct DB access
 * for the user upsert path — it talks to `@orbit/api` which returns a
 * `UserDto`. We need a single shape that all downstream code can consume,
 * regardless of source.
 *
 * Caveat: `id` (Prisma UUID) is only meaningful on the Prisma path. When
 * obtained from the API (`fromApiUser`), `id` is an empty string. All uses of
 * `viewer.id` must therefore live inside Prisma-only branches.
 */

import type { User as PrismaUser } from "@prisma/client";
import type { UserDto } from "@orbit/contracts";

export type ViewerView = {
  /** Prisma UUID. Empty string when constructed from a UserDto (API path). */
  id: string;
  numId: number;
  telegramUserId: bigint;
  username: string | null;
  firstName: string | null;
};

export function fromPrismaUser(u: PrismaUser): ViewerView {
  return {
    id: u.id,
    numId: u.numId,
    telegramUserId: u.telegramUserId,
    username: u.username,
    firstName: u.firstName,
  };
}

export function fromApiUser(dto: UserDto): ViewerView {
  return {
    id: "",
    numId: dto.numId,
    telegramUserId: BigInt(dto.telegramUserId),
    username: dto.username,
    firstName: dto.firstName,
  };
}
