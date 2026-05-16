import { BOT_TZ } from './date-format.js';

export type AddCommandParse = { kind: 'self'; title: string };

/**
 * Parses `/add` command text (without the leading `/add`).
 */
export function parseAddCommandText(raw: string): AddCommandParse | null {
  const text = raw.trim();
  if (!text) return null;

  // Assignment to other users is disabled.
  // Treat everything as the task title.
  return { kind: 'self', title: text };
}

export function clipTitle(raw: string, max = 200) {
  return raw.trim().slice(0, max);
}

export type ParseDueResult =
  | { ok: true; dueAt: Date; dueHasTime: boolean }
  | { ok: false; error: 'format' | 'past' };

// Europe/Moscow is fixed UTC+3 (no DST since 2014). Anchor parses to this
// offset directly so we avoid Intl gymnastics on input.
const BOT_TZ_OFFSET = '+03:00';

const dueDayOnlyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BOT_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Exclusive upper bound for "due-soon" tasks: rows with `dueAt < cutoff`
 * are within `days` calendar days of `now` (inclusive) in `BOT_TZ`.
 * Equivalent to `startOfToday(BOT_TZ) + (days + 1) days`.
 */
export function computeDueSoonCutoff(now: Date, days: number): Date {
  const todayInTZ = dueDayOnlyFmt.format(now);
  const startOfToday = new Date(`${todayInTZ}T00:00:00${BOT_TZ_OFFSET}`);
  return new Date(startOfToday.getTime() + (days + 1) * 24 * 60 * 60 * 1000);
}

function isRealCalendarDate(day: number, month: number, year: number): boolean {
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function parseDueDateInput(raw: string, now: Date = new Date()): ParseDueResult {
  const text = raw.trim();
  if (!text) return { ok: false, error: 'format' };

  const m = text.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!m) return { ok: false, error: 'format' };

  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const hourStr = m[4];
  const minuteStr = m[5];
  const hasTime = hourStr !== undefined;

  if (year < 1900 || year > 3000) return { ok: false, error: 'format' };
  if (!isRealCalendarDate(day, month, year)) return { ok: false, error: 'format' };
  if (hasTime) {
    if (Number(hourStr) > 23 || Number(minuteStr) > 59) return { ok: false, error: 'format' };
  }

  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const hh = hasTime ? hourStr! : '00';
  const mi = hasTime ? minuteStr! : '00';
  const dueAt = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:00${BOT_TZ_OFFSET}`);
  if (Number.isNaN(dueAt.getTime())) return { ok: false, error: 'format' };

  if (hasTime) {
    if (dueAt.getTime() < now.getTime()) return { ok: false, error: 'past' };
  } else {
    if (dueDayOnlyFmt.format(dueAt) < dueDayOnlyFmt.format(now)) {
      return { ok: false, error: 'past' };
    }
  }

  return { ok: true, dueAt, dueHasTime: hasTime };
}
