import { ORBIT_TZ } from '@orbit/contracts';

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

// Europe/Moscow is fixed UTC+3 (no DST since 2014). Anchor parses to this
// offset directly so we avoid Intl gymnastics on input.
const ORBIT_TZ_OFFSET = '+03:00';

const dueDayOnlyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: ORBIT_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Exclusive upper bound for "due-soon" tasks: rows with `dueAt < cutoff`
 * are within `days` calendar days of `now` (inclusive) in `ORBIT_TZ`.
 * Equivalent to `startOfToday(ORBIT_TZ) + (days + 1) days`.
 */
export function computeDueSoonCutoff(now: Date, days: number): Date {
  const todayInTZ = dueDayOnlyFmt.format(now);
  const startOfToday = new Date(`${todayInTZ}T00:00:00${ORBIT_TZ_OFFSET}`);
  return new Date(startOfToday.getTime() + (days + 1) * 24 * 60 * 60 * 1000);
}
