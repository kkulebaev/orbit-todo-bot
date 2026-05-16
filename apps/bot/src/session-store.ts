/**
 * SessionStore — unified read/write surface for the bot's pending-action state
 * machine. Encapsulates the Prisma-vs-API switch behind one interface so the
 * call sites in `bot.ts` and `callback-dispatcher.ts` don't need to branch on
 * `WRITE_VIA_API` for every operation.
 *
 * Conceptually:
 *   - Prisma store: writes columns directly on the `PendingAction` table.
 *   - API store:    writes `payload` (opaque JSON) + optional `taskNumId` via
 *                   `/v1/sessions`. `commit` uses `POST /v1/sessions/:id/commit`
 *                   for atomic task.update + session.delete.
 *
 * Both stores expose the same row shape: a `kind` plus a `SessionPayload`.
 * The `taskId` Prisma column is exposed only via `prismaTaskId` so Prisma-only
 * callers (like raw `prisma.task.update({ where: { id: ... } })`) can still
 * use it. The API store always returns `prismaTaskId: undefined`.
 */

import { randomUUID } from 'node:crypto';
import type { PendingActionKind, PrismaClient } from '@prisma/client';
import type { SessionKind, UpdateTaskInput } from '@orbit/contracts';
import type { ApiClient } from './api-client.js';
import type { ViewerView } from './viewer-view.js';
import { decodePayload, encodePayload, type SessionPayload } from './session-payload.js';

export type SessionRow = {
  id: string;
  kind: PendingActionKind;
  payload: SessionPayload;
  /** Only set on the Prisma path. Undefined for API rows. */
  prismaTaskId?: string;
};

/** The four kinds the bot persists. Mirrors `PendingActionKind` 1:1. */
const ALL_KINDS: readonly SessionKind[] = [
  'editTitle',
  'addTask',
  'addTaskDraft',
  'setDueDate',
];

export interface SessionStore {
  /** Returns the most recent session for the viewer, across all kinds. */
  findLatest(viewer: ViewerView): Promise<SessionRow | null>;

  /** Returns the most recent session of a specific kind, or null. */
  findLatestOfKind(viewer: ViewerView, kind: SessionKind): Promise<SessionRow | null>;

  /**
   * Creates a session. When `taskNumId` is provided the row is linked to that
   * task (required for an atomic `commit({ taskPatch })` later).
   */
  create(
    viewer: ViewerView,
    kind: SessionKind,
    payload: SessionPayload,
    opts?: { taskNumId?: number; prismaTaskId?: string },
  ): Promise<SessionRow>;

  /** Replaces the payload on an existing session. */
  updatePayload(viewer: ViewerView, id: string, payload: SessionPayload): Promise<void>;

  /** Deletes a single session by id (no-op if it doesn't exist). */
  delete(viewer: ViewerView, id: string): Promise<void>;

  /** Deletes every session belonging to the viewer (best-effort). */
  deleteAll(viewer: ViewerView): Promise<void>;

  /**
   * Atomically: optional `task.update(taskPatch)` + `session.delete`.
   * The Prisma store uses `$transaction`. The API store uses
   * `POST /v1/sessions/:id/commit`.
   *
   * Returns `false` when the session or its linked task no longer exists —
   * callers should surface a "task already gone" UX in that case.
   */
  commit(
    viewer: ViewerView,
    id: string,
    taskPatch?: UpdateTaskInput,
  ): Promise<boolean>;
}

// ── Prisma implementation ────────────────────────────────────────────────────

type PrismaPendingActionRow = {
  id: string;
  kind: PendingActionKind;
  taskId: string | null;
  panelMode: string | null;
  panelPage: number | null;
  panelMessageId: number | null;
  promptMessageId: number | null;
  draftTitle: string | null;
};

function fromPrismaRow(r: PrismaPendingActionRow): SessionRow {
  return {
    id: r.id,
    kind: r.kind,
    prismaTaskId: r.taskId ?? undefined,
    payload: {
      panelMode: (r.panelMode as SessionPayload['panelMode']) ?? undefined,
      panelPage: r.panelPage ?? undefined,
      panelMessageId: r.panelMessageId ?? undefined,
      promptMessageId: r.promptMessageId ?? undefined,
      draftTitle: r.draftTitle ?? undefined,
    },
  };
}

export function createPrismaSessionStore(prisma: PrismaClient): SessionStore {
  return {
    async findLatest(viewer) {
      const row = await prisma.pendingAction.findFirst({
        where: { userId: viewer.id },
        orderBy: { createdAt: 'desc' },
      });
      return row ? fromPrismaRow(row) : null;
    },

    async findLatestOfKind(viewer, kind) {
      const row = await prisma.pendingAction.findFirst({
        where: { userId: viewer.id, kind: kind as PendingActionKind },
        orderBy: { createdAt: 'desc' },
      });
      return row ? fromPrismaRow(row) : null;
    },

    async create(viewer, kind, payload, opts) {
      const row = await prisma.pendingAction.create({
        data: {
          kind: kind as PendingActionKind,
          userId: viewer.id,
          ...(opts?.prismaTaskId ? { taskId: opts.prismaTaskId } : {}),
          panelMode: payload.panelMode ?? null,
          panelPage: payload.panelPage ?? null,
          panelMessageId: payload.panelMessageId ?? null,
          promptMessageId: payload.promptMessageId ?? null,
          draftTitle: payload.draftTitle ?? null,
        },
      });
      return fromPrismaRow(row);
    },

    async updatePayload(_viewer, id, payload) {
      await prisma.pendingAction.update({
        where: { id },
        data: {
          panelMode: payload.panelMode ?? null,
          panelPage: payload.panelPage ?? null,
          panelMessageId: payload.panelMessageId ?? null,
          promptMessageId: payload.promptMessageId ?? null,
          draftTitle: payload.draftTitle ?? null,
        },
      });
    },

    async delete(viewer, id) {
      await prisma.pendingAction.deleteMany({ where: { id, userId: viewer.id } });
    },

    async deleteAll(viewer) {
      await prisma.pendingAction.deleteMany({ where: { userId: viewer.id } });
    },

    async commit(viewer, id, taskPatch) {
      const session = await prisma.pendingAction.findFirst({
        where: { id, userId: viewer.id },
        select: { id: true, taskId: true },
      });
      if (!session) return false;

      if (taskPatch) {
        if (!session.taskId) return false;
        // Verify the linked task still exists and is owned by the viewer.
        const owned = await prisma.task.findFirst({
          where: { id: session.taskId, assignedToId: viewer.id },
          select: { id: true },
        });
        if (!owned) {
          // Task is gone — drop the dangling session and signal failure.
          await prisma.pendingAction.delete({ where: { id: session.id } });
          return false;
        }
        const data: {
          title?: string;
          dueAt?: Date | null;
          dueHasTime?: boolean;
          status?: 'open' | 'done';
          doneAt?: Date | null;
        } = {};
        if (taskPatch.title !== undefined) data.title = taskPatch.title;
        if (taskPatch.dueAt !== undefined) {
          data.dueAt = taskPatch.dueAt === null ? null : new Date(taskPatch.dueAt);
        }
        if (taskPatch.dueHasTime !== undefined) data.dueHasTime = taskPatch.dueHasTime;
        if (taskPatch.status !== undefined) {
          data.status = taskPatch.status;
          data.doneAt = taskPatch.status === 'done' ? new Date() : null;
        }
        await prisma.$transaction([
          prisma.task.update({ where: { id: session.taskId }, data }),
          prisma.pendingAction.delete({ where: { id: session.id } }),
        ]);
      } else {
        await prisma.pendingAction.delete({ where: { id: session.id } });
      }
      return true;
    },
  };
}

// ── API implementation ──────────────────────────────────────────────────────

export function createApiSessionStore(api: ApiClient): SessionStore {
  function view(viewer: ViewerView) {
    return api.asViewer(String(viewer.telegramUserId));
  }

  return {
    async findLatest(viewer) {
      // The API has no "any kind" endpoint, so we fan out across the four
      // known kinds and pick the most recently created result. This is the
      // documented compromise for P4 (see plan).
      const v = view(viewer);
      const results = await Promise.all(ALL_KINDS.map((k) => v.getLatestSession(k)));
      const sessions = results.filter((s): s is NonNullable<typeof s> => s !== null);
      if (sessions.length === 0) return null;
      sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latest = sessions[0];
      return {
        id: latest.id,
        kind: latest.kind as PendingActionKind,
        payload: decodePayload(latest.payload),
      };
    },

    async findLatestOfKind(viewer, kind) {
      const session = await view(viewer).getLatestSession(kind);
      if (!session) return null;
      return {
        id: session.id,
        kind: session.kind as PendingActionKind,
        payload: decodePayload(session.payload),
      };
    },

    async create(viewer, kind, payload, opts) {
      const session = await view(viewer).createSession(
        {
          kind,
          payload: encodePayload(payload),
          // Default TTL is 3600s server-side; keep that.
          ttlSeconds: 3600,
          ...(opts?.taskNumId !== undefined ? { taskNumId: opts.taskNumId } : {}),
        },
        randomUUID(),
      );
      return {
        id: session.id,
        kind: session.kind as PendingActionKind,
        payload: decodePayload(session.payload),
      };
    },

    async updatePayload(viewer, id, payload) {
      await view(viewer).updateSession(id, { payload: encodePayload(payload) }, randomUUID());
    },

    async delete(viewer, id) {
      await view(viewer).deleteSession(id, randomUUID());
    },

    async deleteAll(viewer) {
      // Best-effort: list per kind, delete each. Used by /start, /cancel, /my, /done.
      const v = view(viewer);
      const results = await Promise.all(ALL_KINDS.map((k) => v.getLatestSession(k)));
      await Promise.all(
        results
          .filter((s): s is NonNullable<typeof s> => s !== null)
          .map((s) => v.deleteSession(s.id, randomUUID())),
      );
    },

    async commit(viewer, id, taskPatch) {
      const result = await view(viewer).commitSession(
        id,
        { taskPatch, deleteSession: true },
        randomUUID(),
      );
      // commitSession returns null when the session or its linked task is gone
      // (API 404). With no taskPatch the server returns 204 → api-client also
      // returns null, but in that case "success" means "session deleted" which
      // is exactly what callers want — treat null-without-patch as success.
      if (taskPatch === undefined) return true;
      return result !== null;
    },
  };
}
