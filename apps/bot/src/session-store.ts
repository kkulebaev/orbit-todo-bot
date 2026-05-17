/**
 * SessionStore — unified read/write surface for the bot's pending-action state
 * machine. After P5 the only implementation is API-backed via `@orbit/api`.
 *
 * Both the interface and the API store expose the same row shape: a `kind`
 * (SessionKind from @orbit/contracts) plus a decoded `SessionPayload`. The
 * interface is kept so call sites in `bot.ts` and `callback-dispatcher.ts`
 * remain testable with a simple mock.
 */

import { randomUUID } from 'node:crypto';
import type { SessionKind, UpdateTaskInput } from '@orbit/contracts';
import type { ApiClient } from '@orbit/api-client';
import type { ViewerView } from './viewer-view.js';
import { decodePayload, encodePayload, type SessionPayload } from './session-payload.js';

export type SessionRow = {
  id: string;
  kind: SessionKind;
  payload: SessionPayload;
};

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
    opts?: { taskNumId?: number },
  ): Promise<SessionRow>;

  /** Replaces the payload on an existing session. */
  updatePayload(viewer: ViewerView, id: string, payload: SessionPayload): Promise<void>;

  /** Deletes a single session by id (no-op if it doesn't exist). */
  delete(viewer: ViewerView, id: string): Promise<void>;

  /** Deletes every session belonging to the viewer (best-effort). */
  deleteAll(viewer: ViewerView): Promise<void>;

  /**
   * Atomically: optional `task.update(taskPatch)` + `session.delete` via
   * `POST /v1/sessions/:id/commit`.
   *
   * Returns `false` when the session or its linked task no longer exists
   * (API 404) — callers should surface a "task already gone" UX message.
   */
  commit(
    viewer: ViewerView,
    id: string,
    taskPatch?: UpdateTaskInput,
  ): Promise<boolean>;
}

// ── API implementation ──────────────────────────────────────────────────────

export function createApiSessionStore(api: ApiClient): SessionStore {
  function view(viewer: ViewerView) {
    return api.asViewer(String(viewer.telegramUserId));
  }

  return {
    async findLatest(viewer) {
      const session = await view(viewer).getLatestSession();
      if (!session) return null;
      return {
        id: session.id,
        kind: session.kind,
        payload: decodePayload(session.payload),
      };
    },

    async findLatestOfKind(viewer, kind) {
      const session = await view(viewer).getLatestSession(kind);
      if (!session) return null;
      return {
        id: session.id,
        kind: session.kind,
        payload: decodePayload(session.payload),
      };
    },

    async create(viewer, kind, payload, opts) {
      const session = await view(viewer).createSession(
        {
          kind,
          payload: encodePayload(payload),
          ttlSeconds: 3600,
          ...(opts?.taskNumId !== undefined ? { taskNumId: opts.taskNumId } : {}),
        },
        randomUUID(),
      );
      return {
        id: session.id,
        kind: session.kind,
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
      // Best-effort: walk the latest session (any kind) and delete until empty.
      // Used by /start, /cancel, /my, /done.
      const v = view(viewer);
      // Safety cap to avoid an unbounded loop if the API misbehaves.
      for (let i = 0; i < 16; i++) {
        const s = await v.getLatestSession();
        if (!s) return;
        await v.deleteSession(s.id, randomUUID());
      }
    },

    async commit(viewer, id, taskPatch) {
      const result = await view(viewer).commitSession(
        id,
        { taskPatch, deleteSession: true },
        randomUUID(),
      );
      // commitSession returns null when the session or its linked task is gone
      // (API 404). With no taskPatch the server returns 204 → api-client also
      // returns null, but "session deleted" is exactly what callers want —
      // treat null-without-patch as success.
      if (taskPatch === undefined) return true;
      return result !== null;
    },
  };
}
