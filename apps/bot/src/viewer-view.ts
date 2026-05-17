/**
 * ViewerView — a normalized view of the current Telegram user, decoupled from
 * the Prisma `User` model. After P5 the bot talks only to `@orbit/api` and
 * constructs this view exclusively from UserDto responses.
 *
 * The `id` field is kept for backward compat with tests but is always an
 * empty string on the API path.
 */

import type { UserDto } from "@orbit/contracts";

export type ViewerView = {
  /** Always empty string on the API path (P5+). Kept for type compat. */
  id: string;
  numId: number;
  telegramUserId: bigint;
};

export function fromApiUser(dto: UserDto): ViewerView {
  return {
    id: "",
    numId: dto.numId,
    telegramUserId: BigInt(dto.telegramUserId),
  };
}
