import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import { pinoHttp } from "pino-http";
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { requireBearer, resolveViewer } from "./auth.js";
import { idempotencyGuard } from "./idempotency.js";
import { prisma as defaultPrisma } from "./prisma.js";
import { usersRoutes } from "./routes/users.js";
import { tasksRoutes } from "./routes/tasks.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { startSessionCleanup } from "./cron/cleanup-sessions.js";

export interface CreateAppOptions {
  apiToken: string;
  prisma: PrismaClient;
}

/**
 * Build the Express app.
 *
 * Exported separately from the listen() call so tests can mount it with a
 * fake Prisma client and supertest. The shape mirrors `apps/bot/src/server.ts`
 * where `createApp(bot)` is reused by integration tests.
 */
export function createApp(opts: CreateAppOptions): Express {
  const { apiToken, prisma } = opts;
  const app = express();

  app.use(
    pinoHttp({
      genReqId: (req) =>
        (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
      // AC-14: include reqId, route, status, latency on every log line.
      customProps: (req) => ({ reqId: (req as Request).id }),
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    }),
  );
  app.use(express.json({ limit: "16kb" }));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true, service: "api" });
  });

  // Authenticated v1 router. Order matters: Bearer first (reject unknown
  // callers cheap), then viewer upsert, then idempotency replay.
  const v1 = express.Router();
  v1.use(requireBearer(apiToken));
  v1.use(resolveViewer(prisma));
  v1.use(idempotencyGuard);

  v1.use("/users", usersRoutes());
  v1.use("/tasks", tasksRoutes(prisma));
  v1.use("/sessions", sessionsRoutes(prisma));

  app.use("/v1", v1);

  // Centralized error handler. Routes throw `{ status, code, message }`-shaped
  // errors (see routes/*) and this turns them into ApiErrorBody.
  app.use(
    (
      err: { status?: number; code?: string; message?: string },
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      const status = err.status ?? 500;
      res.status(status).json({
        error: {
          code: err.code ?? "internal",
          message: err.message ?? "internal error",
        },
      });
    },
  );

  return app;
}

const isEntrypoint =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isEntrypoint) {
  const apiToken = process.env.API_BOT_TOKEN;
  if (!apiToken) throw new Error("Missing API_BOT_TOKEN");
  const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
  const app = createApp({ apiToken, prisma: defaultPrisma });
  const stopCleanup = startSessionCleanup({
    prisma: defaultPrisma,
    logger,
  });
  const PORT = Number(process.env.PORT ?? 8080);
  // Bind dual-stack (IPv6 + IPv4 via mapping). Railway internal networking
  // resolves `*.railway.internal` over IPv6; an IPv4-only bind ("0.0.0.0") is
  // unreachable from sibling services.
  const server = app.listen(PORT, "::", () => {
    logger.info({ port: PORT }, "orbit-api listening");
  });
  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, "shutting down");
    stopCleanup();
    server.close(() => {
      void defaultPrisma.$disconnect().finally(() => process.exit(0));
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
