import type { User, Task, PendingAction } from "@prisma/client";
import type { UserDto, TaskDto, SessionDto } from "@orbit/contracts";

/**
 * Map Prisma User → UserDto.
 *
 * BigInt → string is explicit here. Do NOT add `BigInt.prototype.toJSON`
 * (AC-11) — keep the conversion local to mappers so the API surface is the
 * single boundary between wire format and Prisma types.
 */
export function toUserDto(u: User): UserDto {
  return {
    numId: u.numId,
    telegramUserId: u.telegramUserId.toString(),
    username: u.username,
    firstName: u.firstName,
  };
}

/**
 * Map Prisma Task (with createdBy and assignedTo relations) → TaskDto.
 *
 * Caller must include `{ assignedTo: true, createdBy: true }` in the Prisma
 * query so we can surface the stable `numId` of each user.
 */
export function toTaskDto(
  t: Task & { assignedTo: User; createdBy: User },
): TaskDto {
  return {
    numId: t.numId,
    title: t.title,
    status: t.status,
    dueAt: t.dueAt?.toISOString() ?? null,
    dueHasTime: t.dueHasTime,
    createdAt: t.createdAt.toISOString(),
    doneAt: t.doneAt?.toISOString() ?? null,
    createdByNumId: t.createdBy.numId,
    assignedToNumId: t.assignedTo.numId,
  };
}

/**
 * Map Prisma PendingAction → SessionDto.
 *
 * The `PendingAction` model is repurposed as the persisted session store
 * (PA-2 opaque endpoints). The bot is the sole producer/consumer of `payload`
 * — API treats it as an opaque string and stores it in `draftTitle`.
 *
 * `expiresAt` is always set on the create path (see sessionsRoutes), so we
 * non-null assert here.
 */
export function toSessionDto(p: PendingAction): SessionDto {
  return {
    id: p.id,
    kind: p.kind,
    payload: p.draftTitle ?? "",
    expiresAt: p.expiresAt!.toISOString(),
    createdAt: p.createdAt.toISOString(),
  };
}
