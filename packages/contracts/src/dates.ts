export const ORBIT_TZ = 'Europe/Moscow';

const dateOnlyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: ORBIT_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: ORBIT_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const absoluteFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: ORBIT_TZ,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const dayMonthFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: ORBIT_TZ,
  day: 'numeric',
  month: 'long',
});

function partsToString(parts: Intl.DateTimeFormatPart[]): string {
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value;
  return year ? `${day} ${month} ${year}` : `${day} ${month}`;
}

function formatAbsolute(d: Date): string {
  return partsToString(absoluteFmt.formatToParts(d));
}

function formatDayMonth(d: Date): string {
  return partsToString(dayMonthFmt.formatToParts(d));
}

const yearFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: ORBIT_TZ,
  year: 'numeric',
});

function dateOnlyInTZ(d: Date): string {
  return dateOnlyFmt.format(d);
}

function yearInTZ(d: Date): number {
  return Number(yearFmt.format(d));
}

function absoluteInTZ(d: Date, now: Date): string {
  return yearInTZ(d) === yearInTZ(now) ? formatDayMonth(d) : formatAbsolute(d);
}

function diffDaysInTZ(later: Date, earlier: Date): number {
  const a = new Date(`${dateOnlyInTZ(earlier)}T00:00:00Z`);
  const b = new Date(`${dateOnlyInTZ(later)}T00:00:00Z`);
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

function dayWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}

export function formatSmart(date: Date, now: Date = new Date()): string {
  const diff = diffDaysInTZ(now, date);

  if (diff <= 0) return `сегодня в ${timeFmt.format(date)}`;
  if (diff === 1) return `вчера в ${timeFmt.format(date)}`;
  if (diff <= 7) return `${diff} ${dayWord(diff)} назад`;
  return formatAbsolute(date);
}

export function formatDueSmart(
  dueAt: Date,
  hasTime: boolean,
  now: Date = new Date(),
): { text: string; overdue: boolean } {
  const overdue = hasTime
    ? dueAt.getTime() < now.getTime()
    : dateOnlyInTZ(now) > dateOnlyInTZ(dueAt);

  if (overdue) {
    return { text: `просрочено · ${absoluteInTZ(dueAt, now)}`, overdue: true };
  }

  const diff = diffDaysInTZ(dueAt, now);
  const time = hasTime ? ` в ${timeFmt.format(dueAt)}` : '';

  if (diff <= 0) return { text: `сегодня${time}`, overdue: false };
  if (diff === 1) return { text: `завтра${time}`, overdue: false };
  if (diff <= 7) return { text: `через ${diff} ${dayWord(diff)}${time}`, overdue: false };
  return { text: `${absoluteInTZ(dueAt, now)}${time}`, overdue: false };
}

// ── parseDueDateInput (date-portion only; moved from apps/bot/src/bot-logic.ts) ──

export type ParseDueResult =
  | { ok: true; dueAt: Date; dueHasTime: boolean }
  | { ok: false; error: 'format' | 'past' };

// Europe/Moscow is fixed UTC+3 (no DST since 2014). Anchor parses to this
// offset directly so we avoid Intl gymnastics on input.
const ORBIT_TZ_OFFSET = '+03:00';

const dueDayOnlyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: ORBIT_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

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
  const dueAt = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:00${ORBIT_TZ_OFFSET}`);
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
