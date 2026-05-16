import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import { pinoHttp } from "pino-http";
import { pino } from "pino";
import type { Logger } from "pino";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { parseCidrsFromEnv, resolveCredential } from "./auth.js";
import { idempotencyGuard } from "./idempotency.js";
import { prisma as defaultPrisma } from "./prisma.js";
import { usersRoutes } from "./routes/users.js";
import { tasksRoutes } from "./routes/tasks.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { cliTokensRoutes } from "./routes/cli-tokens.js";
import { versionRoutes } from "./routes/version.js";
import { startSessionCleanup } from "./cron/cleanup-sessions.js";

export interface CreateAppOptions {
  prisma: PrismaClient;
  /** CIDRs allowed for `canImpersonate=true` PATs (e.g. bot-PAT). */
  allowedCidrs?: string[];
  /** Logger injected into `resolveCredential` for impersonation audit lines. */
  logger?: Pick<Logger, "info" | "warn">;
  /**
   * Override for API_PUBLIC_EXPOSURE env var. When false (default), /v1/*
   * router is not mounted; when true, it is.
   */
  publicExposure?: boolean;
}

/**
 * Build the Express app.
 *
 * Exported separately from the listen() call so tests can mount it with a
 * fake Prisma client and supertest. Mirrors `apps/bot/src/server.ts` where
 * `createApp(bot)` is reused by integration tests.
 */
export function createApp(opts: CreateAppOptions): Express {
  const { prisma, allowedCidrs = [], logger } = opts;

  // AC-P2-6: feature flag gating /v1/*. Defaults to false (unexposed).
  const publicExposure =
    opts.publicExposure ??
    (process.env.API_PUBLIC_EXPOSURE === "true");

  const app = express();

  // AC-P2-5: honor a single X-Forwarded-For hop (Railway edge).
  app.set("trust proxy", 1);

  // AC-P2-10: HSTS on every response (top of chain).
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=15552000; includeSubDomains",
    );
    next();
  });

  app.use(
    pinoHttp({
      logger: logger as Logger | undefined,
      genReqId: (req) =>
        (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
      // AC-P2-14: redact Authorization header so PAT plaintext never appears
      // in logs. The header value is replaced with "[REDACTED]".
      serializers: {
        req: (req) => {
          const headers = { ...(req.headers as Record<string, string>) };
          if (headers["authorization"]) {
            headers["authorization"] = "[REDACTED]";
          }
          return { ...req, headers };
        },
      },
      // AC-P2-14..18: enrich every authed log line with auth + user-agent fields.
      customProps: (req) => {
        const typedReq = req as Request;
        const base: Record<string, unknown> = {
          reqId: typedReq.id,
          "user.agent": req.headers["user-agent"],
        };
        if (typedReq.auth) {
          base["auth.path"] = typedReq.auth.path;
          base["auth.patId"] = typedReq.auth.patId;
          base["auth.canImpersonate"] = typedReq.auth.canImpersonate;
          if (typedReq.auth.impersonation) {
            base["auth.impersonation"] = typedReq.auth.impersonation;
          }
        }
        return base;
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    }),
  );
  app.use(express.json({ limit: "16kb" }));

  // /healthz — AC-P2-11: body is exactly { ok: true, service: 'api' }.
  // Exempt from rate limiting and auth.
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true, service: "api" });
  });

  // AC-P2-6: conditionally mount /v1/* based on API_PUBLIC_EXPOSURE.
  if (publicExposure) {
    // AC-P2-9: per-IP rate limit, 60 req/min by default. /healthz is already
    // mounted above and is exempt. canImpersonate PATs are exempt (they are
    // already CIDR-restricted at the auth layer).
    const rateLimitPerMin = Number(
      process.env.RATE_LIMIT_PER_MIN ?? "60",
    );
    const limiter = rateLimit({
      windowMs: 60 * 1000,
      max: rateLimitPerMin,
      standardHeaders: true,
      legacyHeaders: false,
      // Skip rate limiting for canImpersonate=true PATs (bot PATs).
      // resolveCredential runs before the limiter, so req.auth is set.
      skip: (req) => !!(req as Request).auth?.canImpersonate,
      handler: (req, res) => {
        const ip = req.ip ?? "unknown";
        // AC-P2-21: log the rejected IP at warn level.
        (req as Request).log?.warn({ ip }, "rate limit exceeded");
        res.status(429).json({
          error: { code: "rate_limited", message: "Too many requests" },
        });
      },
    });

    // Authenticated v1 router. Order matters: PAT credential resolution first
    // (reject unknown callers cheap), then rate-limit, then idempotency replay.
    const v1 = express.Router();
    v1.use(resolveCredential(prisma, { allowedCidrs, logger }));
    v1.use(limiter);
    v1.use(idempotencyGuard);

    v1.use("/users", usersRoutes());
    v1.use("/tasks", tasksRoutes(prisma));
    v1.use("/sessions", sessionsRoutes(prisma));
    v1.use("/cli/tokens", cliTokensRoutes(prisma));
    v1.use("/version", versionRoutes());

    app.use("/v1", v1);
  }

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
  const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
  // Default CIDRs match Railway internal IPv6 (`fd00::/8`) + IPv6 loopback
  // (`::1`) + IPv4 loopback (`127.0.0.1`) for local-dev / health-check probes.
  const allowedCidrs = parseCidrsFromEnv(
    process.env.BOT_PAT_ALLOWED_CIDR ?? "fd00::/8,::1,127.0.0.1/32",
  );
  const app = createApp({ prisma: defaultPrisma, allowedCidrs, logger });
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
