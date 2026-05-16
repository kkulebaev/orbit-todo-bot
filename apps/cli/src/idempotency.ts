import { randomUUID } from 'node:crypto';

/**
 * Returns the user-supplied idempotency key when present (forwarded verbatim),
 * otherwise a fresh `randomUUID()` per call.
 */
export function getIdempotencyKey(explicit?: string): string {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  return randomUUID();
}
