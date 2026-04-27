import { describe, expect, it } from 'vitest';
import { formatCallbackData, parseCallbackData } from './callback-data.js';

describe('callback-data', () => {
  it('parses noop', () => {
    expect(parseCallbackData('noop')).toEqual({ kind: 'noop' });
  });

  it('parses view list', () => {
    expect(parseCallbackData('v:list:my:0')).toEqual({ kind: 'v:list', mode: 'my', page: 0 });
    expect(parseCallbackData('v:list:done:12')).toEqual({ kind: 'v:list', mode: 'done', page: 12 });
  });

  it('parses view task', () => {
    expect(parseCallbackData('v:task:10:my:2')).toEqual({ kind: 'v:task', taskNumId: 10, mode: 'my', page: 2 });
  });

  it('parses task actions', () => {
    expect(parseCallbackData('t:delask:5:my:0')).toEqual({ kind: 't:delask', taskNumId: 5, mode: 'my', page: 0 });
    expect(parseCallbackData('t:delyes:5:my:0')).toEqual({ kind: 't:delyes', taskNumId: 5, mode: 'my', page: 0 });
    expect(parseCallbackData('t:done:5:my:0')).toEqual({ kind: 't:done', taskNumId: 5, mode: 'my', page: 0 });
    expect(parseCallbackData('t:reopen:5:done:0')).toEqual({ kind: 't:reopen', taskNumId: 5, mode: 'done', page: 0 });
    expect(parseCallbackData('t:setDue:7:my:1')).toEqual({ kind: 't:setDue', taskNumId: 7, mode: 'my', page: 1 });
  });

  it('parses v:clearDue', () => {
    expect(parseCallbackData('v:clearDue')).toEqual({ kind: 'v:clearDue' });
  });

  it('returns null on unknown', () => {
    expect(parseCallbackData('t:unknown:1')).toBeNull();
    expect(parseCallbackData('')).toBeNull();
  });

  it('format + parse roundtrip', () => {
    const samples = [
      { kind: 'v:cancel' as const },
      { kind: 'v:clearDue' as const },
      { kind: 'v:addDraft' as const, action: 'confirm' as const },
      { kind: 'v:list' as const, mode: 'my' as const, page: 3 },
      { kind: 't:done' as const, taskNumId: 9, mode: 'my' as const, page: 0 },
      { kind: 't:setDue' as const, taskNumId: 9, mode: 'my' as const, page: 0 },
    ];

    for (const s of samples) {
      const encoded = formatCallbackData(s as any);
      const decoded = parseCallbackData(encoded);
      expect(decoded).toEqual(s);
    }
  });
});
