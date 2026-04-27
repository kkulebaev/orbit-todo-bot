import { describe, expect, it } from 'vitest';
import { formatDueSmart, formatSmart } from './date-format.js';

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

  it('returns "DD.MM.YYYY" for >7 days back', () => {
    expect(formatSmart(new Date('2026-04-19T12:00:00Z'), now)).toBe('19.04.2026');
    expect(formatSmart(new Date('2025-12-31T12:00:00Z'), now)).toBe('31.12.2025');
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
        text: 'просрочено · 26.04',
        overdue: true,
      });
      // Other year
      expect(formatDueSmart(new Date('2025-11-30T21:00:00Z'), false, now)).toEqual({
        text: 'просрочено · 01.12.2025',
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
        text: 'просрочено · 27.04',
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
    it('current year shows DD.MM', () => {
      // +8 days, 2026-05-05 00:00 MSK = 2026-05-04 21:00Z
      expect(formatDueSmart(new Date('2026-05-04T21:00:00Z'), false, now)).toEqual({
        text: '05.05',
        overdue: false,
      });
    });

    it('current year with time', () => {
      // +30 days at 09:00 MSK
      expect(formatDueSmart(new Date('2026-05-27T06:00:00Z'), true, now)).toEqual({
        text: '27.05 в 09:00',
        overdue: false,
      });
    });

    it('other year shows DD.MM.YYYY', () => {
      // 2027-01-15 00:00 MSK = 2027-01-14 21:00Z
      expect(formatDueSmart(new Date('2027-01-14T21:00:00Z'), false, now)).toEqual({
        text: '15.01.2027',
        overdue: false,
      });
    });

    it('other year with time', () => {
      // 2027-01-15 09:00 MSK = 2027-01-15 06:00Z
      expect(formatDueSmart(new Date('2027-01-15T06:00:00Z'), true, now)).toEqual({
        text: '15.01.2027 в 09:00',
        overdue: false,
      });
    });
  });
});
