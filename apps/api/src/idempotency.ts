import { LRUCache } from "lru-cache";
import type { Request, Response, NextFunction } from "express";

type CachedResponse = { status: number; body: unknown };

/**
 * Idempotency cache.
 *
 * 10k entries / 24h TTL (AC-6). Key includes viewer.id so two users sending
 * the same `Idempotency-Key` value cannot collide on each other's writes.
 *
 * Sized for single-replica API (AC-9). When the API scales to N replicas
 * this needs to move to Redis or similar shared store, otherwise a duplicate
 * POST routed to a different replica will write twice.
 */
const cache = new LRUCache<string, CachedResponse>({
  max: 10_000,
  ttl: 24 * 60 * 60 * 1000,
});

const MUTATING_METHODS = new Set(["POST", "PATCH", "DELETE"]);

/**
 * Idempotency-Key middleware.
 *
 * Only acts on mutating methods (`POST`/`PATCH`/`DELETE`). When the header
 * is present, the first response is cached and replayed on subsequent calls
 * with the same key+viewer+route. Non-mutating requests pass through.
 *
 * The cache stores only the status code and JSON body — headers are not
 * replayed, so endpoints that depend on response headers should set them
 * unconditionally.
 */
export function idempotencyGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  const key = req.header("idempotency-key");
  if (!key) {
    next();
    return;
  }

  const viewerId = req.viewer?.id ?? "anon";
  // req.originalUrl includes mounted prefixes (e.g. /v1/tasks); use path
  // without query string to keep keys stable across pagination cursors.
  const cacheKey = `${viewerId}|${req.method}|${req.baseUrl}${req.path}|${key}`;

  const hit = cache.get(cacheKey);
  if (hit) {
    res.status(hit.status).json(hit.body);
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 500) {
      cache.set(cacheKey, { status: res.statusCode, body });
    }
    return originalJson(body);
  }) as typeof res.json;

  next();
}

/** Exposed for tests; not part of the public API surface. */
export const _idempotencyCache = cache;
