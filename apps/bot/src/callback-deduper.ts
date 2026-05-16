export type CallbackDeduper = {
  /**
   * Returns true if this callbackQueryId was already seen recently.
   */
  isDuplicate: (callbackQueryId: string) => boolean;
};

export function createCallbackDeduper(options?: {
  /** TTL in milliseconds (default: 60s) */
  ttlMs?: number;
  /** Max map size (best-effort) to avoid unbounded growth (default: 10k) */
  maxSize?: number;
}): CallbackDeduper {
  const ttlMs = options?.ttlMs ?? 60_000;
  const maxSize = options?.maxSize ?? 10_000;

  const seen = new Map<string, number>();

  function cleanup(nowMs: number) {
    // cheap cleanup pass; iterates in insertion order
    for (const [id, expiresAt] of seen) {
      if (expiresAt > nowMs) break;
      seen.delete(id);
    }

    // best-effort bound: if still too big, drop oldest entries
    if (seen.size <= maxSize) return;
    const overflow = seen.size - maxSize;
    let i = 0;
    for (const id of seen.keys()) {
      if (i >= overflow) break;
      seen.delete(id);
      i += 1;
    }
  }

  return {
    isDuplicate(callbackQueryId: string): boolean {
      const nowMs = Date.now();
      cleanup(nowMs);

      const expiresAt = seen.get(callbackQueryId);
      if (expiresAt !== undefined && expiresAt > nowMs) return true;

      seen.set(callbackQueryId, nowMs + ttlMs);
      return false;
    },
  };
}
