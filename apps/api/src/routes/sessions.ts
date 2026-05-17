import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import {
  CommitSessionInputSchema,
  CreateSessionInputSchema,
  UpdateSessionInputSchema,
} from "@orbit/contracts";
import { toSessionDto, toTaskDto } from "../mappers/dto.js";
import {
  LatestSessionQuerySchema,
  SessionIdParamSchema,
} from "../schemas.js";
import { badRequest, notFound } from "../http-errors.js";

/**
 * `/v1/sessions` routes (PA-2 opaque endpoints).
 *
 * The bot is the sole producer/consumer of `payload` — API treats it as
 * an opaque string (AC-23: additive evolution, no `v: 1` bump-and-clear).
 *
 * All queries scope by `userId = req.viewer.id`. Owner-mismatch → 404 (AC-4).
 *
 * `POST /:id/commit` finalises a state-machine flow (editTitle, setDueDate,
 * addTask) atomically via `prisma.$transaction` (AC-25): the optional task
 * update and the session delete commit together or not at all.
 */
export function sessionsRoutes(prisma: PrismaClient): Router {
  const r = Router();

  // GET /v1/sessions/latest?kind=
  r.get("/latest", async (req, res, next) => {
    try {
      const parsed = LatestSessionQuerySchema.safeParse(req.query);
      if (!parsed.success) throw badRequest("invalid query");
      const { kind } = parsed.data;
      const session = await prisma.pendingAction.findFirst({
        where: {
          userId: req.viewer!.id,
          ...(kind ? { kind } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
      if (!session) throw notFound();
      res.json(toSessionDto(session));
    } catch (e) {
      next(e);
    }
  });

  // Sessions expire one hour after creation. Hardcoded server-side — the
  // wire format no longer accepts a client-supplied TTL.
  const SESSION_TTL_MS = 3600_000;

  // POST /v1/sessions
  r.post("/", async (req, res, next) => {
    try {
      const parsed = CreateSessionInputSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("invalid body");
      const { kind, payload, taskNumId } = parsed.data;
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

      // Optional task linkage (enables atomic `commit` with a taskPatch).
      // We resolve numId → internal id with an owner check; mismatch → 404.
      let taskId: string | null = null;
      if (taskNumId !== undefined) {
        const owned = await prisma.task.findFirst({
          where: { numId: taskNumId, ownerId: req.viewer!.id },
          select: { id: true },
        });
        if (!owned) throw notFound();
        taskId = owned.id;
      }

      const session = await prisma.pendingAction.create({
        data: {
          kind,
          payload,
          expiresAt,
          userId: req.viewer!.id,
          ...(taskId ? { taskId } : {}),
        },
      });
      res.status(201).json(toSessionDto(session));
    } catch (e) {
      next(e);
    }
  });

  // PATCH /v1/sessions/:id
  r.patch("/:id", async (req, res, next) => {
    try {
      const { id } = parseSessionIdOrThrow(req.params);
      const parsed = UpdateSessionInputSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("invalid body");
      const { payload } = parsed.data;

      const existing = await prisma.pendingAction.findFirst({
        where: { id, userId: req.viewer!.id },
        select: { id: true },
      });
      if (!existing) throw notFound();

      const data: { payload?: string } = {};
      if (payload !== undefined) data.payload = payload;

      const session = await prisma.pendingAction.update({
        where: { id: existing.id },
        data,
      });
      res.json(toSessionDto(session));
    } catch (e) {
      next(e);
    }
  });

  // DELETE /v1/sessions/:id
  r.delete("/:id", async (req, res, next) => {
    try {
      const { id } = parseSessionIdOrThrow(req.params);
      const result = await prisma.pendingAction.deleteMany({
        where: { id, userId: req.viewer!.id },
      });
      if (result.count === 0) throw notFound();
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // POST /v1/sessions/:id/commit
  // Atomic: task.update + session.delete inside one $transaction.
  // `taskPatch` is required — bot deletes sessions without a patch via
  // DELETE /v1/sessions/:id.
  r.post("/:id/commit", async (req, res, next) => {
    try {
      const { id } = parseSessionIdOrThrow(req.params);
      const parsed = CommitSessionInputSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest("invalid body");
      const { taskPatch } = parsed.data;
      const viewerId = req.viewer!.id;

      const session = await prisma.pendingAction.findFirst({
        where: { id, userId: viewerId },
        select: { id: true, taskId: true },
      });
      if (!session) throw notFound();

      // Verify the task is owned by the viewer (AC-4/AC-5) before opening
      // the transaction. Verification outside the transaction is safe: the
      // same `id`+`ownerId` is checked inside the update via `where`, so a
      // concurrent reassign (which we do not support) would result in
      // `count: 0` and a 404.
      if (!session.taskId) throw notFound();
      const owned = await prisma.task.findFirst({
        where: { id: session.taskId, ownerId: viewerId },
        select: { id: true },
      });
      if (!owned) throw notFound();
      const taskDbId = owned.id;

      const data: {
        title?: string;
        dueAt?: Date | null;
        dueHasTime?: boolean;
        status?: "open" | "done";
        doneAt?: Date | null;
      } = {};
      if (taskPatch.title !== undefined) data.title = taskPatch.title;
      if (taskPatch.dueAt !== undefined) {
        data.dueAt =
          taskPatch.dueAt === null ? null : new Date(taskPatch.dueAt);
      }
      if (taskPatch.dueHasTime !== undefined) {
        data.dueHasTime = taskPatch.dueHasTime;
      }
      if (taskPatch.status !== undefined) {
        data.status = taskPatch.status;
        data.doneAt = taskPatch.status === "done" ? new Date() : null;
      }

      const [updatedTask] = await prisma.$transaction([
        prisma.task.update({
          where: { id: taskDbId },
          data,
        }),
        prisma.pendingAction.delete({ where: { id: session.id } }),
      ]);

      res.json(toTaskDto(updatedTask));
    } catch (e) {
      next(e);
    }
  });

  return r;
}

function parseSessionIdOrThrow(params: unknown): { id: string } {
  const parsed = SessionIdParamSchema.safeParse(params);
  if (!parsed.success) throw notFound();
  return { id: parsed.data.id };
}
