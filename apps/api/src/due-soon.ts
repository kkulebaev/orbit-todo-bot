/**
 * "Due-soon" cutoff computation.
 *
 * Ported from `apps/bot/src/bot-logic.ts` (computeDueSoonCutoff). Tasks with
 * `dueAt < cutoff` surface at the top of `/v1/tasks?mode=my` and the only
 * rows returned for `mode=due-soon`.
 *
 * Europe/Moscow is fixed UTC+3 (no DST since 2014). Anchor day boundaries to
 * that offset directly so we avoid Intl gymnastics.
 */

import { PAGE_SIZE } from "@orbit/contracts";

const BOT_TZ = "Europe/Moscow";
const BOT_TZ_OFFSET = "+03:00";

export const DUE_SOON_DAYS = 7;
export { PAGE_SIZE };

const dueDayOnlyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BOT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Exclusive upper bound for "due-soon" tasks: rows with `dueAt < cutoff` are
 * within `days` calendar days of `now` (inclusive) in `BOT_TZ`.
 * Equivalent to `startOfToday(BOT_TZ) + (days + 1) days`.
 */
export function computeDueSoonCutoff(now: Date, days: number): Date {
  const todayInTZ = dueDayOnlyFmt.format(now);
  const startOfToday = new Date(`${todayInTZ}T00:00:00${BOT_TZ_OFFSET}`);
  return new Date(startOfToday.getTime() + (days + 1) * 24 * 60 * 60 * 1000);
}
