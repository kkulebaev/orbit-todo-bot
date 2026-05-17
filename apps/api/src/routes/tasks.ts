import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import {
  CreateTaskInputSchema,
  PAGE_SIZE,
  UpdateTaskInputSchema,
} from "@orbit/contracts";
import { toTaskDto } from "../mappers/dto.js";
import {
  ListTasksQuerySchema,
  NumIdParamSchema,
} from "../schemas.js";
import { badRequest, notFound } from "../http-errors.js";

/**
 * `/v1/tasks` routes.
 *
 * All mutates and reads are scoped by `req.viewer.id` (AC-5). Owner-mismatch
 * surfaces as **404**, not 403 (AC-4) — we never leak whether a task exists
 * but belongs to someone else.
 *
 * Pagination contract mirrors the bot UI: PAGE_SIZE rows, page index from 0,
 * total count returned for client-side clamping.
 */
export function tasksRoutes(prisma: PrismaClient): Router {
  const r = Router();

  // GET /v1/tasks?mode=my|done&page=N
  r.get("/", async (req, res, next) => {
    try {
      const parsed = ListTasksQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw badRequest("invalid query");
      }
      const { mode, page } = parsed.data;
      const viewer = req.viewer!;
      const skip = page * PAGE_SIZE;

      if (mode === "done") {
        const where = { status: "done" as const, assignedToId: viewer.id };
        const [tasks, total] = await Promise.all([
          prisma.task.findMany({
            where,
            orderBy: [{ doneAt: "desc" }, { createdAt: "desc" }],
            skip,
            take: PAGE_SIZE,
            include: { assignedTo: true, createdBy: true },
          }),
          prisma.task.count({ where }),
        ]);
        res.json({ items: tasks.map(toTaskDto), page, total });
        return;
      }

      // mode === "my": open tasks sorted by dueAt ASC (NULLS LAST), then by
      // createdAt DESC. Tasks with a due date always surface above ones
      // without, irrespective of whether they are overdue.
      const where = { status: "open" as const, assignedToId: viewer.id };
      const [tasks, total] = await Promise.all([
        prisma.task.findMany({
          where,
          orderBy: [
            { dueAt: { sort: "asc", nulls: "last" } },
            { createdAt: "desc" },
          ],
          skip,
          take: PAGE_SIZE,
          include: { assignedTo: true, createdBy: true },
        }),
        prisma.task.count({ where }),
      ]);
      res.json({ items: tasks.map(toTaskDto), page, total });
    } catch (e) {
      next(e);
    }
  });

  // GET /v1/tasks/:numId
  r.get(
    "/:numId",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { numId } = parseNumIdOrThrow(req);
        const task = await prisma.task.findFirst({
          where: { numId, assignedToId: req.viewer!.id },
          include: { assignedTo: true, createdBy: true },
        });
        if (!task) throw notFound();
        res.json(toTaskDto(task));
      } catch (e) {
        next(e);
      }
    },
  );

  // POST /v1/tasks
  r.post("/", async (req, res, next) => {
    try {
      const parsed = CreateTaskInputSchema.safeParse(req.body);
      if (!parsed.success) {
        throw badRequest("invalid body");
      }
      const { title, dueAt, dueHasTime } = parsed.data;
      const viewer = req.viewer!;
      const task = await prisma.task.create({
        data: {
          title,
          dueAt: dueAt ? new Date(dueAt) : null,
          dueHasTime: dueHasTime ?? false,
          createdById: viewer.id,
          assignedToId: viewer.id,
        },
        include: { assignedTo: true, createdBy: true },
      });
      res.status(201).json(toTaskDto(task));
    } catch (e) {
      next(e);
    }
  });

  // PATCH /v1/tasks/:numId
  r.patch("/:numId", async (req, res, next) => {
    try {
      const { numId } = parseNumIdOrThrow(req);
      const parsed = UpdateTaskInputSchema.safeParse(req.body);
      if (!parsed.success) {
        throw badRequest("invalid body");
      }
      const patch = parsed.data;
      const existing = await prisma.task.findFirst({
        where: { numId, assignedToId: req.viewer!.id },
        select: { id: true },
      });
      if (!existing) throw notFound();

      // Derive doneAt from status transitions. Setting status=done stamps
      // doneAt=now(); status=open clears it. Other fields pass through.
      const data: {
        title?: string;
        dueAt?: Date | null;
        dueHasTime?: boolean;
        status?: "open" | "done";
        doneAt?: Date | null;
      } = {};
      if (patch.title !== undefined) data.title = patch.title;
      if (patch.dueAt !== undefined) {
        data.dueAt = patch.dueAt === null ? null : new Date(patch.dueAt);
      }
      if (patch.dueHasTime !== undefined) data.dueHasTime = patch.dueHasTime;
      if (patch.status !== undefined) {
        data.status = patch.status;
        data.doneAt = patch.status === "done" ? new Date() : null;
      }

      const task = await prisma.task.update({
        where: { id: existing.id },
        data,
        include: { assignedTo: true, createdBy: true },
      });
      res.json(toTaskDto(task));
    } catch (e) {
      next(e);
    }
  });

  // DELETE /v1/tasks/:numId
  r.delete("/:numId", async (req, res, next) => {
    try {
      const { numId } = parseNumIdOrThrow(req);
      // Owner-scoped delete in a single statement to avoid TOCTOU between the
      // existence check and the delete. PendingAction rows cascade via FK.
      const result = await prisma.task.deleteMany({
        where: { numId, assignedToId: req.viewer!.id },
      });
      if (result.count === 0) throw notFound();
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return r;
}

function parseNumIdOrThrow(req: Request): { numId: number } {
  const parsed = NumIdParamSchema.safeParse(req.params);
  if (!parsed.success) throw notFound();
  return { numId: parsed.data.numId };
}
