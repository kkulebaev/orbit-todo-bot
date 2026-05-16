import type { PrismaClient } from "@prisma/client";

/**
 * Periodic cleanup of expired sessions (AC-19).
 *
 * `PendingAction` rows with `expiresAt < now()` are deleted every 15 minutes.
 * Index on `PendingAction.expiresAt` (see schema.prisma) keeps the scan
 * bounded as the table grows.
 *
 * Single-replica API (AC-9) means we can run the tick in-process without
 * leader election. If the API ever scales horizontally, this needs to move
 * to an external scheduler or use advisory locks.
 */

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

interface CleanupLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface SessionCleanupOptions {
  prisma: PrismaClient;
  logger: CleanupLogger;
  /** Override the tick interval. Tests pass shorter values; prod uses the default. */
  intervalMs?: number;
}

/**
 * Start the cleanup loop. Returns a stop function that clears the interval —
 * call it during graceful shutdown (`SIGTERM`).
 *
 * Runs one tick immediately so a freshly-started API doesn't wait 15 minutes
 * to clear stale rows from before the deploy.
 */
export function startSessionCleanup(opts: SessionCleanupOptions): () => void {
  const { prisma, logger, intervalMs = FIFTEEN_MINUTES_MS } = opts;

  const tick = async () => {
    try {
      const result = await prisma.pendingAction.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (result.count > 0) {
        logger.info({ cleaned: result.count }, "session cleanup tick");
      }
    } catch (e) {
      logger.error({ err: e }, "session cleanup failed");
    }
  };

  void tick();
  const handle = setInterval(() => void tick(), intervalMs);
  // Don't keep the event loop alive solely for the cleanup timer; the HTTP
  // server keeps the process running, and unref-ing makes test teardown clean.
  handle.unref?.();
  return () => clearInterval(handle);
}
