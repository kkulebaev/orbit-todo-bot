import { describe, expect, it } from 'vitest';
import { decodePayload, encodePayload } from './session-payload.js';

describe('encodePayload / decodePayload', () => {
  it('round-trips a fully populated payload', () => {
    const p = {
      panelMode: 'my' as const,
      panelPage: 3,
      panelMessageId: 1001,
      promptMessageId: 2002,
      draftTitle: 'купить хлеб',
      taskNumId: 42,
    };
    expect(decodePayload(encodePayload(p))).toEqual(p);
  });

  it('encodes an empty payload to "{}" and decodes back to empty', () => {
    expect(encodePayload({})).toBe('{}');
    expect(decodePayload('{}')).toEqual({});
  });

  it('falls back to an empty payload on malformed JSON', () => {
    expect(decodePayload('not json')).toEqual({});
    expect(decodePayload('')).toEqual({});
    expect(decodePayload(null)).toEqual({});
    expect(decodePayload(undefined)).toEqual({});
  });

  it('forward-compat: preserves unknown keys produced by future bot versions', () => {
    // A future bot adds `someFutureFlag` to the payload. The current bot must
    // not throw and must not silently strip it — the same row may be read
    // back by the newer bot version in the next deploy.
    const raw = JSON.stringify({ panelPage: 1, someFutureFlag: 'yes' });
    const decoded = decodePayload(raw) as Record<string, unknown>;
    expect(decoded.panelPage).toBe(1);
    expect(decoded.someFutureFlag).toBe('yes');
  });

  it('falls back to empty on a non-object JSON value (array, number, null)', () => {
    expect(decodePayload('[1,2,3]')).toEqual([1, 2, 3]); // arrays are objects in JS — accepted
    expect(decodePayload('42')).toEqual({});
    expect(decodePayload('null')).toEqual({});
    expect(decodePayload('"a string"')).toEqual({});
  });
});
