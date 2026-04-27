export const BOT_TZ = 'Europe/Moscow';

const dateOnlyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BOT_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: BOT_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const absoluteFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: BOT_TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function dateOnlyInTZ(d: Date): string {
  return dateOnlyFmt.format(d);
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
  return absoluteFmt.format(date);
}
