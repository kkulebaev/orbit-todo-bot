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
  assignedTo: { firstName: string | null; username: string | null };
}) {
  const statusEmoji = t.status === 'done' ? '✅' : '📝';
  return `${statusEmoji} ${t.title}\n👤 ${fmtUser(t.assignedTo)}`;
}

export type ListMode = 'my' | 'all' | 'done';

export const PAGE_SIZE = 8;

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
    const emoji = t.status === 'done' ? '✅' : '⏳';
    kb.text(`${emoji} ${n}`, `v:task:${t.numId}:${mode}:${page}`);
    if ((idx + 1) % 4 === 0) kb.row();
  });
  kb.row();

  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const prevEnabled = page > 0;
  const nextEnabled = page < maxPage;

  kb.text('➕ Добавить', `v:add:${mode}:${page}`);
  kb.text('🔄 Обновить', `v:list:${mode}:${page}`);
  kb.row();

  kb.text(prevEnabled ? '⬅️' : '·', prevEnabled ? `v:list:${mode}:${page - 1}` : 'noop');
  kb.text(nextEnabled ? '➡️' : '·', nextEnabled ? `v:list:${mode}:${page + 1}` : 'noop');
  kb.row();

  kb.text(mode === 'my' ? '👤 Мои ✅' : '👤 Мои', `v:list:my:0`);
  kb.text(mode === 'all' ? '👥 Все ✅' : '👥 Все', `v:list:all:0`);
  kb.text(mode === 'done' ? '🏁 Готово ✅' : '🏁 Готово', `v:list:done:0`);

  return kb;
}
