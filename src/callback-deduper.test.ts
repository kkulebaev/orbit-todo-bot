import { describe, expect, it, vi } from 'vitest';

import { createCallbackDeduper } from './callback-deduper.js';

describe('callback-deduper', () => {
  it('dedupes same callbackQueryId within TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const d = createCallbackDeduper({ ttlMs: 1000 });

    expect(d.isDuplicate('abc')).toBe(false);
    expect(d.isDuplicate('abc')).toBe(true);

    vi.advanceTimersByTime(999);
    expect(d.isDuplicate('abc')).toBe(true);

    vi.advanceTimersByTime(2);
    expect(d.isDuplicate('abc')).toBe(false);

    vi.useRealTimers();
  });

  it('does not dedupe different ids', () => {
    const d = createCallbackDeduper({ ttlMs: 1000 });
    expect(d.isDuplicate('a')).toBe(false);
    expect(d.isDuplicate('b')).toBe(false);
  });
});
