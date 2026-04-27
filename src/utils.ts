import { InlineKeyboard } from 'grammy';
import type { TaskStatus, User } from '@prisma/client';

export function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function fmtUser(u: Pick<User, 'username' | 'firstName'>) {
  if (u.username) return `@${u.username}`;
  return u.firstName ?? 'user';
}

export function fmtTaskLine(t: {
  id: string;
  title: string;
  status: TaskStatus;
}) {
  const statusEmoji = t.status === 'done' ? '✅' : '📝';
  return `${statusEmoji} ${t.title}`;
}

export function truncate(s: string, max = 60) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export type ListMode = 'my' | 'done';

export const PAGE_SIZE = 8;

// Open tasks with a deadline within this many calendar days (inclusive)
// are surfaced above the rest, sorted by deadline ascending.
export const DUE_SOON_DAYS = 7;

export function isTelegramMessageNotModifiedError(e: unknown) {
  const msg = String((e as any)?.description ?? (e as any)?.message ?? '').toLowerCase();
  return msg.includes('message is not modified');
}

export function kbList(
  mode: ListMode,
  page: number,
  tasks: { numId: number; status: TaskStatus }[],
  total: number,
) {
  const kb = new InlineKeyboard();

  // Task picker buttons
  tasks.forEach((t, idx) => {
    const n = page * PAGE_SIZE + idx + 1;
    kb.text(`${n}`, `v:task:${t.numId}:${mode}:${page}`);
    if ((idx + 1) % 4 === 0) kb.row();
  });
  kb.row();

  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const prevEnabled = page > 0;
  const nextEnabled = page < maxPage;

  kb.text('➕ Добавить', `v:add:${mode}:${page}`);
  kb.row();

  kb.text(prevEnabled ? '⬅️' : '·', prevEnabled ? `v:list:${mode}:${page - 1}` : 'noop');
  kb.text(nextEnabled ? '➡️' : '·', nextEnabled ? `v:list:${mode}:${page + 1}` : 'noop');
  kb.row();

  kb.text(mode === 'my' ? '⏳ В работе ✅' : '⏳ В работе', `v:list:my:0`);
  kb.text(mode === 'done' ? '🗂️ Выполненные ✅' : '🗂️ Выполненные', `v:list:done:0`);

  return kb;
}
