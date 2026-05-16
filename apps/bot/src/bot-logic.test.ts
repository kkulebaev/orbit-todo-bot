import { describe, expect, it } from 'vitest';
import {
  clipTitle,
  computeDueSoonCutoff,
  parseAddCommandText,
  parseDueDateInput,
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

  describe('parseDueDateInput', () => {
    // now = 2026-04-27 15:00 MSK = 2026-04-27 12:00Z
    const now = new Date('2026-04-27T12:00:00Z');

    it('parses dd.mm.yyyy as day-only at 00:00 MSK', () => {
      const r = parseDueDateInput('30.04.2026', now);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.dueHasTime).toBe(false);
      // 2026-04-30 00:00 MSK = 2026-04-29 21:00Z
      expect(r.dueAt.toISOString()).toBe('2026-04-29T21:00:00.000Z');
    });

    it('parses dd.mm.yyyy HH:mm as day+time in MSK', () => {
      const r = parseDueDateInput('30.04.2026 18:30', now);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.dueHasTime).toBe(true);
      // 18:30 MSK = 15:30Z
      expect(r.dueAt.toISOString()).toBe('2026-04-30T15:30:00.000Z');
    });

    it('accepts today as day-only (not past)', () => {
      const r = parseDueDateInput('27.04.2026', now);
      expect(r.ok).toBe(true);
    });

    it('rejects yesterday as past', () => {
      expect(parseDueDateInput('26.04.2026', now)).toEqual({ ok: false, error: 'past' });
    });

    it('rejects today day+time before now', () => {
      // now is 15:00 MSK, 14:00 MSK same day = past
      expect(parseDueDateInput('27.04.2026 14:00', now)).toEqual({ ok: false, error: 'past' });
    });

    it('accepts today day+time after now', () => {
      const r = parseDueDateInput('27.04.2026 23:59', now);
      expect(r.ok).toBe(true);
    });

    it('rejects garbage and partial formats', () => {
      expect(parseDueDateInput('', now)).toEqual({ ok: false, error: 'format' });
      expect(parseDueDateInput('27.04', now)).toEqual({ ok: false, error: 'format' });
      expect(parseDueDateInput('27.04.26', now)).toEqual({ ok: false, error: 'format' });
      expect(parseDueDateInput('завтра', now)).toEqual({ ok: false, error: 'format' });
      expect(parseDueDateInput('30.04.2026 8:30', now)).toEqual({ ok: false, error: 'format' });
      expect(parseDueDateInput('30.04.2026 18:60', now)).toEqual({ ok: false, error: 'format' });
      expect(parseDueDateInput('30.04.2026 24:00', now)).toEqual({ ok: false, error: 'format' });
    });

    it('rejects impossible calendar dates', () => {
      expect(parseDueDateInput('31.02.2026', now)).toEqual({ ok: false, error: 'format' });
      expect(parseDueDateInput('29.02.2027', now)).toEqual({ ok: false, error: 'format' });
      // 2028 is leap → 29.02 valid
      const leap = parseDueDateInput('29.02.2028', now);
      expect(leap.ok).toBe(true);
    });

    it('trims surrounding whitespace', () => {
      const r = parseDueDateInput('  30.04.2026 18:30  ', now);
      expect(r.ok).toBe(true);
    });
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
