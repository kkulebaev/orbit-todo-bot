import { describe, expect, it } from 'vitest';

import { getIdempotencyKey } from './idempotency.js';

describe('getIdempotencyKey', () => {
  it('forwards an explicit key verbatim', () => {
    expect(getIdempotencyKey('my-custom-key')).toBe('my-custom-key');
  });

  it('returns a fresh randomUUID() when no explicit key is given', () => {
    const a = getIdempotencyKey();
    const b = getIdempotencyKey();
    expect(a).not.toBe(b);
    // RFC 4122 v4 UUID shape.
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('treats an empty string as "no explicit key" and generates a UUID', () => {
    const out = getIdempotencyKey('');
    expect(out).not.toBe('');
    expect(out.length).toBeGreaterThan(0);
  });
});
