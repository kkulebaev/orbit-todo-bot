import { describe, expect, it } from 'vitest';
import {
  clipTitle,
  computeDueSoonCutoff,
  parseAddCommandText,
} from './bot-logic.js';

describe('bot-logic', () => {
  describe('parseAddCommandText', () => {
    it('returns null on empty', () => {
      expect(parseAddCommandText('')).toBeNull();
      expect(parseAddCommandText('   ')).toBeNull();
    });

    it('parses add as self (assignment disabled)', () => {
      expect(parseAddCommandText('купить молоко')).toEqual({ kind: 'self', title: 'купить молоко' });
      expect(parseAddCommandText('@kkulebaev купить молоко')).toEqual({ kind: 'self', title: '@kkulebaev купить молоко' });
    });
  });

  it('clipTitle trims and clips', () => {
    expect(clipTitle('  a  ', 2)).toBe('a');
    expect(clipTitle('abcdef', 3)).toBe('abc');
  });

  describe('computeDueSoonCutoff', () => {
    // 2026-04-27 15:00 MSK = 2026-04-27 12:00Z
    const noonMsk = new Date('2026-04-27T12:00:00Z');

    it('returns startOfToday + (days + 1) at MSK midnight', () => {
      // days = 7 → cutoff at 2026-05-05 00:00 MSK = 2026-05-04 21:00Z
      expect(computeDueSoonCutoff(noonMsk, 7).toISOString()).toBe('2026-05-04T21:00:00.000Z');
    });

    it('does not depend on the time-of-day component of now', () => {
      // 2026-04-27 23:59 MSK = 2026-04-27 20:59Z — same calendar day in MSK
      const lateMsk = new Date('2026-04-27T20:59:00Z');
      expect(computeDueSoonCutoff(lateMsk, 7).toISOString()).toBe('2026-05-04T21:00:00.000Z');
    });

    it('rolls the day forward when "now" sits in the next MSK day', () => {
      // 2026-04-27 23:00Z = 2026-04-28 02:00 MSK — next calendar day in TZ
      const earlyNextDay = new Date('2026-04-27T23:00:00Z');
      expect(computeDueSoonCutoff(earlyNextDay, 7).toISOString()).toBe('2026-05-05T21:00:00.000Z');
    });

    it('handles month/year boundary', () => {
      // 2026-12-31 12:00 MSK
      const newYearsEve = new Date('2026-12-31T09:00:00Z');
      // days = 7 → cutoff at 2027-01-08 00:00 MSK = 2027-01-07 21:00Z
      expect(computeDueSoonCutoff(newYearsEve, 7).toISOString()).toBe('2027-01-07T21:00:00.000Z');
    });

    it('with days = 0 returns the start of tomorrow MSK', () => {
      // 2026-04-28 00:00 MSK = 2026-04-27 21:00Z. Only "today" tasks count as in-zone.
      expect(computeDueSoonCutoff(noonMsk, 0).toISOString()).toBe('2026-04-27T21:00:00.000Z');
    });
  });
});
