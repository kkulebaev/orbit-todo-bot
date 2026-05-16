import type { Request, Response, NextFunction } from "express";
import type { PrismaClient, User } from "@prisma/client";

declare module "express-serve-static-core" {
  interface Request {
    viewer?: User;
  }
}

/**
 * Bearer authentication middleware.
 *
 * Compares the `Authorization: Bearer <token>` header against the shared
 * `API_BOT_TOKEN`. On miss returns 401 without details (AC-8) so we don't
 * leak whether the header was absent vs wrong.
 *
 * Note: AC-28 follow-up tracks switching to `crypto.timingSafeEqual` for
 * constant-time comparison. The single-tenant Railway internal network makes
 * the timing channel low-risk for P1.
 */
export function requireBearer(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.header("authorization");
    if (!auth?.startsWith("Bearer ") || auth.slice(7) !== token) {
      res
        .status(401)
        .json({ error: { code: "unauthorized", message: "unauthorized" } });
      return;
    }
    next();
  };
}

/**
 * Viewer-resolution middleware.
 *
 * Reads `X-Telegram-User-Id` (stringified BigInt), upserts the User row, and
 * exposes it on `req.viewer`. All downstream handlers MUST scope their
 * queries by `req.viewer.id` (AC-5).
 *
 * Returns 401 (not 400) on missing/malformed header — it's still an auth
 * failure: we can't identify the caller.
 */
export function resolveViewer(prisma: PrismaClient) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const header = req.header("x-telegram-user-id");
    if (!header || !/^\d+$/.test(header)) {
      res.status(401).json({
        error: {
          code: "missing_identity",
          message: "X-Telegram-User-Id required",
        },
      });
      return;
    }
    try {
      const telegramUserId = BigInt(header);
      const user = await prisma.user.upsert({
        where: { telegramUserId },
        update: {},
        create: { telegramUserId },
      });
      req.viewer = user;
      next();
    } catch (e) {
      next(e);
    }
  };
}
