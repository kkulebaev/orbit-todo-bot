import { describe, expect, it } from 'vitest';
import { formatSmart } from './date-format.js';

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
