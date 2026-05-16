import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { randomBytes, createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { MintCliTokenInputSchema } from "@orbit/contracts";
import { badRequest, notFound, HttpError } from "../http-errors.js";
import { SessionIdParamSchema } from "../schemas.js";

/**
 * `/v1/cli/tokens` routes.
 *
 * POST   /v1/cli/tokens        — mint (requires canImpersonate=true)
 * GET    /v1/cli/tokens        — list caller's non-revoked tokens
 * DELETE /v1/cli/tokens/:id    — revoke; 404 on owner-mismatch (privacy-preserving)
 */
export function cliTokensRoutes(prisma: PrismaClient): Router {
  const r = Router();

  // POST /v1/cli/tokens — mint a new user PAT on behalf of a Telegram user.
  // Requires the calling PAT to have canImpersonate=true (bot-PAT only).
  r.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth?.canImpersonate) {
        throw new HttpError(403, "forbidden", "forbidden");
      }

      const parsed = MintCliTokenInputSchema.safeParse(req.body);
      if (!parsed.success) {
        throw badRequest("invalid body");
      }
      const { telegramUserId, label, ttlDays } = parsed.data;

      // Upsert the target user by their Telegram ID.
      const targetUser = await prisma.user.upsert({
        where: { telegramUserId: BigInt(telegramUserId) },
        update: {},
        create: { telegramUserId: BigInt(telegramUserId) },
      });

      // Generate plaintext. randomBytes(32).toString("base64url") = 43 chars,
      // prefix gives orbit_pat_ + 43 chars — matches AC-P2-12 regex.
      const plaintext = `orbit_pat_${randomBytes(32).toString("base64url")}`;
      const tokenHash = createHash("sha256").update(plaintext).digest("hex");

      const expiresAt = ttlDays
        ? new Date(Date.now() + ttlDays * 86400e3)
        : null;

      const pat = await prisma.personalAccessToken.create({
        data: {
          userId: targetUser.id,
          tokenHash,
          label: label ?? null,
          expiresAt,
          canImpersonate: false,
        },
      });

      res.status(201).json({
        id: pat.id,
        token: plaintext,
        label: pat.label,
        expiresAt: pat.expiresAt ? pat.expiresAt.toISOString() : null,
      });
    } catch (e) {
      next(e);
    }
  });

  // GET /v1/cli/tokens — list caller's non-revoked tokens.
  r.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const viewer = req.viewer!;
      const tokens = await prisma.personalAccessToken.findMany({
        where: {
          userId: viewer.id,
          revokedAt: null,
        },
        orderBy: { createdAt: "desc" },
      });

      res.json(
        tokens.map((t) => ({
          id: t.id,
          label: t.label,
          createdAt: t.createdAt.toISOString(),
          lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
          expiresAt: t.expiresAt ? t.expiresAt.toISOString() : null,
        })),
      );
    } catch (e) {
      next(e);
    }
  });

  // DELETE /v1/cli/tokens/:id — revoke. Privacy-preserving 404 on owner mismatch.
  r.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const paramParsed = SessionIdParamSchema.safeParse(req.params);
      if (!paramParsed.success) throw notFound();
      const { id } = paramParsed.data;
      const viewer = req.viewer!;

      // Look up by id with owner check — privacy-preserving: if not found or
      // not owned, return 404 (never 403).
      const pat = await prisma.personalAccessToken.findFirst({
        where: { id, userId: viewer.id },
        select: { id: true, revokedAt: true },
      });
      if (!pat) throw notFound();

      // Idempotent: if already revoked, still return 204.
      if (!pat.revokedAt) {
        await prisma.personalAccessToken.update({
          where: { id: pat.id },
          data: { revokedAt: new Date() },
        });
      }

      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return r;
}
