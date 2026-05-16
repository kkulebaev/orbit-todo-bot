import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient, Task } from "@prisma/client";
import {
  CreateTaskInputSchema,
  UpdateTaskInputSchema,
} from "@orbit/contracts";
import { toTaskDto } from "../mappers/dto.js";
import { computeDueSoonCutoff, DUE_SOON_DAYS, PAGE_SIZE } from "../due-soon.js";
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

  // GET /v1/tasks?mode=my|due-soon&page=N
  r.get("/", async (req, res, next) => {
    try {
      const parsed = ListTasksQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw badRequest("invalid query");
      }
      const { mode, page } = parsed.data;
      const viewer = req.viewer!;
      const skip = page * PAGE_SIZE;

      if (mode === "due-soon") {
        const cutoff = computeDueSoonCutoff(new Date(), DUE_SOON_DAYS);
        const where = {
          status: "open" as const,
          assignedToId: viewer.id,
          dueAt: { lt: cutoff, not: null },
        };
        const [tasks, total] = await Promise.all([
          prisma.task.findMany({
            where,
            orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
            skip,
            take: PAGE_SIZE,
            include: { assignedTo: true, createdBy: true },
          }),
          prisma.task.count({ where }),
        ]);
        res.json({
          items: tasks.map(toTaskDto),
          page,
          total,
        });
        return;
      }

      // mode === "my": due-soon zone first (dueAt within DUE_SOON_DAYS in
      // BOT_TZ, including overdue), then everything else by createdAt DESC.
      // Prisma orderBy can't express the CASE; use $queryRaw for the page
      // and a normal count for total. Mirrors apps/bot/src/bot.ts:74-86.
      const cutoff = computeDueSoonCutoff(new Date(), DUE_SOON_DAYS);
      const where = { status: "open" as const, assignedToId: viewer.id };
      const [rawTasks, total] = await Promise.all([
        prisma.$queryRaw<Task[]>`
          SELECT *
          FROM "Task"
          WHERE "status" = 'open'::"TaskStatus" AND "assignedToId" = ${viewer.id}
          ORDER BY
            CASE WHEN "dueAt" IS NOT NULL AND "dueAt" < ${cutoff} THEN 0 ELSE 1 END ASC,
            CASE WHEN "dueAt" IS NOT NULL AND "dueAt" < ${cutoff} THEN "dueAt" END ASC NULLS LAST,
            "createdAt" DESC
          LIMIT ${PAGE_SIZE} OFFSET ${skip}
        `,
        prisma.task.count({ where }),
      ]);

      // $queryRaw doesn't follow `include`, so fetch the related users once.
      const fullTasks = await prisma.task.findMany({
        where: { id: { in: rawTasks.map((t) => t.id) } },
        include: { assignedTo: true, createdBy: true },
      });
      // Preserve the raw query ordering.
      const byId = new Map(fullTasks.map((t) => [t.id, t]));
      const items = rawTasks
        .map((t) => byId.get(t.id))
        .filter((t): t is (typeof fullTasks)[number] => t != null)
        .map(toTaskDto);

      res.json({ items, page, total });
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
