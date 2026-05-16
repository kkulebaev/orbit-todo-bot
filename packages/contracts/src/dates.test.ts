import { describe, expect, it } from 'vitest';
import { formatDueSmart, formatSmart, parseDueDateInput } from './dates.js';

// Reference: Europe/Moscow is fixed UTC+3 (no DST since 2014).
// MSK = UTC + 3h. So 12:00Z = 15:00 MSK; 22:00Z on day N = 01:00 MSK on day N+1.

const now = new Date('2026-04-27T12:00:00Z'); // 2026-04-27 15:00 MSK

describe('formatSmart', () => {
  it('returns "сегодня в HH:MM" for the same MSK day', () => {
    expect(formatSmart(new Date('2026-04-27T08:00:00Z'), now)).toBe('сегодня в 11:00');
    expect(formatSmart(new Date('2026-04-27T00:30:00Z'), now)).toBe('сегодня в 03:30');
  });

  it('treats late-evening UTC as the next MSK day (today)', () => {
    // 2026-04-26 22:00Z = 2026-04-27 01:00 MSK — same MSK day as `now`
    expect(formatSmart(new Date('2026-04-26T22:00:00Z'), now)).toBe('сегодня в 01:00');
  });

  it('returns "вчера в HH:MM" for the previous MSK day', () => {
    // 2026-04-26 20:00Z = 2026-04-26 23:00 MSK (one MSK day before now)
    expect(formatSmart(new Date('2026-04-26T20:00:00Z'), now)).toBe('вчера в 23:00');
    // 2026-04-25 21:00Z = 2026-04-26 00:00 MSK (still yesterday MSK)
    expect(formatSmart(new Date('2026-04-25T21:00:00Z'), now)).toBe('вчера в 00:00');
  });

  it('returns "N дней назад" for 2..7 days back with correct pluralization', () => {
    // diff=2..4 → "дня", diff=5..7 → "дней"
    expect(formatSmart(new Date('2026-04-25T12:00:00Z'), now)).toBe('2 дня назад');
    expect(formatSmart(new Date('2026-04-23T12:00:00Z'), now)).toBe('4 дня назад');
    expect(formatSmart(new Date('2026-04-22T12:00:00Z'), now)).toBe('5 дней назад');
    expect(formatSmart(new Date('2026-04-20T12:00:00Z'), now)).toBe('7 дней назад');
  });

  it('returns "D MMMM YYYY" for >7 days back', () => {
    expect(formatSmart(new Date('2026-04-19T12:00:00Z'), now)).toBe('19 апреля 2026');
    expect(formatSmart(new Date('2025-12-31T12:00:00Z'), now)).toBe('31 декабря 2025');
  });

  it('clamps a future-or-equal timestamp to "сегодня"', () => {
    // Slightly in the future: still treated as today.
    expect(formatSmart(new Date('2026-04-27T20:00:00Z'), now)).toBe('сегодня в 23:00');
  });
});

describe('formatDueSmart', () => {
  // now = 2026-04-27 15:00 MSK

  describe('overdue', () => {
    it('day-only: yesterday and earlier MSK days are overdue', () => {
      // 2026-04-26 00:00 MSK = 2026-04-25 21:00Z
      expect(formatDueSmart(new Date('2026-04-25T21:00:00Z'), false, now)).toEqual({
        text: 'просрочено · 26 апреля',
        overdue: true,
      });
      // Other year
      expect(formatDueSmart(new Date('2025-11-30T21:00:00Z'), false, now)).toEqual({
        text: 'просрочено · 1 декабря 2025',
        overdue: true,
      });
    });

    it('day-only: same MSK day is NOT overdue', () => {
      // 2026-04-27 00:00 MSK = 2026-04-26 21:00Z
      expect(formatDueSmart(new Date('2026-04-26T21:00:00Z'), false, now)).toEqual({
        text: 'сегодня',
        overdue: false,
      });
    });

    it('day+time: timestamp before now is overdue, even on the same day', () => {
      // 2026-04-27 12:00 MSK (= 09:00Z), now is 15:00 MSK → overdue
      expect(formatDueSmart(new Date('2026-04-27T09:00:00Z'), true, now)).toEqual({
        text: 'просрочено · 27 апреля',
        overdue: true,
      });
    });

    it('day+time: timestamp after now today is NOT overdue', () => {
      // 2026-04-27 18:00 MSK = 15:00Z
      expect(formatDueSmart(new Date('2026-04-27T15:00:00Z'), true, now)).toEqual({
        text: 'сегодня в 18:00',
        overdue: false,
      });
    });
  });

  describe('today and tomorrow', () => {
    it('day-only today', () => {
      expect(formatDueSmart(new Date('2026-04-26T21:00:00Z'), false, now)).toEqual({
        text: 'сегодня',
        overdue: false,
      });
    });

    it('day-only tomorrow', () => {
      // 2026-04-28 00:00 MSK = 2026-04-27 21:00Z
      expect(formatDueSmart(new Date('2026-04-27T21:00:00Z'), false, now)).toEqual({
        text: 'завтра',
        overdue: false,
      });
    });

    it('day+time tomorrow', () => {
      // 2026-04-28 09:00 MSK = 2026-04-28 06:00Z
      expect(formatDueSmart(new Date('2026-04-28T06:00:00Z'), true, now)).toEqual({
        text: 'завтра в 09:00',
        overdue: false,
      });
    });
  });

  describe('through 2..7 days', () => {
    it('day-only with russian plural', () => {
      // +3 days, 2026-04-30 00:00 MSK = 2026-04-29 21:00Z
      expect(formatDueSmart(new Date('2026-04-29T21:00:00Z'), false, now)).toEqual({
        text: 'через 3 дня',
        overdue: false,
      });
      // +5 days
      expect(formatDueSmart(new Date('2026-05-01T21:00:00Z'), false, now)).toEqual({
        text: 'через 5 дней',
        overdue: false,
      });
      // +7 days
      expect(formatDueSmart(new Date('2026-05-03T21:00:00Z'), false, now)).toEqual({
        text: 'через 7 дней',
        overdue: false,
      });
    });

    it('day+time appends time', () => {
      // +3 days at 18:00 MSK
      expect(formatDueSmart(new Date('2026-04-30T15:00:00Z'), true, now)).toEqual({
        text: 'через 3 дня в 18:00',
        overdue: false,
      });
    });
  });

  describe('absolute > 7 days', () => {
    it('current year shows "D MMMM"', () => {
      // +8 days, 2026-05-05 00:00 MSK = 2026-05-04 21:00Z
      expect(formatDueSmart(new Date('2026-05-04T21:00:00Z'), false, now)).toEqual({
        text: '5 мая',
        overdue: false,
      });
    });

    it('current year with time', () => {
      // +30 days at 09:00 MSK
      expect(formatDueSmart(new Date('2026-05-27T06:00:00Z'), true, now)).toEqual({
        text: '27 мая в 09:00',
        overdue: false,
      });
    });

    it('other year shows "D MMMM YYYY"', () => {
      // 2027-01-15 00:00 MSK = 2027-01-14 21:00Z
      expect(formatDueSmart(new Date('2027-01-14T21:00:00Z'), false, now)).toEqual({
        text: '15 января 2027',
        overdue: false,
      });
    });

    it('other year with time', () => {
      // 2027-01-15 09:00 MSK = 2027-01-15 06:00Z
      expect(formatDueSmart(new Date('2027-01-15T06:00:00Z'), true, now)).toEqual({
        text: '15 января 2027 в 09:00',
        overdue: false,
      });
    });
  });
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
