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
    expect(parseCallbackData('v:task:10:all:2')).toEqual({ kind: 'v:task', taskNumId: 10, mode: 'all', page: 2 });
  });

  it('parses task actions', () => {
    expect(parseCallbackData('t:delask:5:my:0')).toEqual({ kind: 't:delask', taskNumId: 5, mode: 'my', page: 0 });
    expect(parseCallbackData('t:delyes:5:my:0')).toEqual({ kind: 't:delyes', taskNumId: 5, mode: 'my', page: 0 });
    expect(parseCallbackData('t:done:5:my:0')).toEqual({ kind: 't:done', taskNumId: 5, mode: 'my', page: 0 });
    expect(parseCallbackData('t:reopen:5:my:0')).toEqual({ kind: 't:reopen', taskNumId: 5, mode: 'my', page: 0 });
    expect(parseCallbackData('t:assign:5:my:0')).toEqual({ kind: 't:assign', taskNumId: 5, mode: 'my', page: 0 });
    expect(parseCallbackData('t:assignTo:5:2:my:0')).toEqual({ kind: 't:assignTo', taskNumId: 5, toUserNumId: 2, mode: 'my', page: 0 });
  });

  it('returns null on unknown', () => {
    expect(parseCallbackData('t:unknown:1')).toBeNull();
    expect(parseCallbackData('')).toBeNull();
  });

  it('format + parse roundtrip', () => {
    const samples = [
      { kind: 'v:cancel' as const },
      { kind: 'v:addDraft' as const, action: 'confirm' as const },
      { kind: 'v:list' as const, mode: 'all' as const, page: 3 },
      { kind: 't:assignTo' as const, taskNumId: 9, toUserNumId: 1, mode: 'my' as const, page: 0 },
    ];

    for (const s of samples) {
      const encoded = formatCallbackData(s as any);
      const decoded = parseCallbackData(encoded);
      expect(decoded).toEqual(s);
    }
  });
});
