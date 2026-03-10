import 'dotenv/config';
import { Context, InlineKeyboard } from 'grammy';
import { PendingActionKind, PrismaClient, TaskStatus, User } from '@prisma/client';
import { bot } from './bot-instance.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('Missing DATABASE_URL in env');

const prisma = new PrismaClient();

function mustBePrivateChat(ctx: Context) {
  return ctx.chat?.type === 'private';
}

async function upsertUserFromCtx(ctx: Context) {
  const from = ctx.from;
  if (!from) throw new Error('No from in context');

  return prisma.user.upsert({
    where: { telegramUserId: BigInt(from.id) },
    update: {
      username: from.username ?? null,
      firstName: from.first_name ?? null,
    },
    create: {
      telegramUserId: BigInt(from.id),
      username: from.username ?? null,
      firstName: from.first_name ?? null,
    },
  });
}

function fmtUser(u: Pick<User, 'username' | 'firstName'>) {
  if (u.username) return `@${u.username}`;
  return u.firstName ?? 'user';
}

function fmtTaskLine(t: {
  id: string;
  title: string;
  status: TaskStatus;
  assignedTo: { firstName: string | null; username: string | null };
}) {
  const statusEmoji = t.status === 'done' ? '✅' : '📝';
  return `${statusEmoji} ${t.title}\n👤 ${fmtUser(t.assignedTo)}`;
}

type ListMode = 'my' | 'all' | 'done';

type PendingMode = 'my' | 'all' | 'done';
const PAGE_SIZE = 8;

async function getTasksForMode(mode: ListMode, viewer: User, page: number) {
  const where: any = {};
  if (mode === 'done') where.status = 'done';
  else where.status = 'open';

  if (mode === 'my') where.assignedToId = viewer.id;

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      // UX: show newer tasks first
      orderBy: [{ createdAt: 'desc' }],
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { assignedTo: true },
    }),
    prisma.task.count({ where }),
  ]);

  return { tasks, total };
}

function kbList(mode: ListMode, page: number, tasks: { numId: number; status: TaskStatus }[], total: number) {
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

function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function showList(ctx: Context, mode: ListMode, page: number, editMessageId?: number) {
  const viewer = await upsertUserFromCtx(ctx);
  const { tasks, total } = await getTasksForMode(mode, viewer, page);

  const title = mode === 'my'
    ? '🪐 <b>Orbit · Мои задачи</b>'
    : mode === 'all'
      ? '🪐 <b>Orbit · Все задачи</b>'
      : '🪐 <b>Orbit · Выполненные</b>';
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageInfo = total > 0 ? `\nСтраница: <b>${page + 1}</b> / <b>${totalPages}</b>` : '';

  let body = '';
  if (tasks.length === 0) {
    body = mode === 'done'
      ? 'Пока нет выполненных задач.'
      : 'Пока нет задач. Добавь первую командой:\n<code>/add купить молоко</code>';
  } else {
    body = tasks
      .map((t, idx) => {
        const n = page * PAGE_SIZE + idx + 1;
        const statusEmoji = t.status === 'done' ? '✅' : '⏳';
        return `${statusEmoji} <b>${n}.</b> ${escapeHtml(t.title)} — <i>${escapeHtml(fmtUser(t.assignedTo))}</i>`;
      })
      .join('\n');

    body += `\n\nНажми на номер задачи ниже, чтобы открыть действия.`;
  }

  const text = `${title}${pageInfo}\n\n${body}`;
  const reply_markup = kbList(mode, page, tasks, total);

  if (editMessageId) {
    try {
      await ctx.api.editMessageText(ctx.chat!.id, editMessageId, text, {
        parse_mode: 'HTML',
        reply_markup,
      });
    } catch (e) {
      // Fallback: if message can't be edited (or parse error), just send a fresh message.
      console.error('editMessageText failed, falling back to reply()', e);
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup });
    }
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup });
  }
}

function kbTaskDetail(taskNumId: number, status: TaskStatus, mode: ListMode, page: number) {
  const kb = new InlineKeyboard();
  if (status === 'open') kb.text('✅ Готово', `t:done:${taskNumId}:${mode}:${page}`);
  else kb.text('🔁 Вернуть', `t:reopen:${taskNumId}:${mode}:${page}`);
  kb.text('👤 Назначить', `t:assign:${taskNumId}:${mode}:${page}`);
  kb.text('📝 Изменить', `t:edit:${taskNumId}:${mode}:${page}`);
  kb.row();
  kb.text('🗑 Удалить', `t:delask:${taskNumId}:${mode}:${page}`);
  kb.text('⬅️ Назад', `v:list:${mode}:${page}`);
  return kb;
}

async function showTaskDetail(ctx: Context, taskNumId: number, mode: ListMode, page: number, editMessageId: number) {
  const viewer = await upsertUserFromCtx(ctx);
  const task = await prisma.task.findUnique({
    where: { numId: taskNumId },
    include: { assignedTo: true, createdBy: true },
  });

  if (!task) {
    // Don't rely on callback popups (we may have already answered the callback).
    await ctx.api.editMessageText(ctx.chat!.id, editMessageId, '🙃 Задача не найдена.', {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('⬅️ Назад', `v:list:${mode}:${page}`),
    });
    return;
  }

  // UX: allow viewing tasks in the shared workspace (2-person bot). Actions are still gated elsewhere.
  // If you want stricter privacy later, re-enable creator/assignee check.

  const statusLine = task.status === 'done' ? '✅ Выполнено' : '⏳ В работе';
  const text =
    `📝 <b>Задача</b>\n\n` +
    `<b>${escapeHtml(task.title)}</b>\n\n` +
    `${statusLine}\n` +
    `👤 Исполнитель: <b>${escapeHtml(fmtUser(task.assignedTo))}</b>\n` +
    `✍️ Создал: <b>${escapeHtml(fmtUser(task.createdBy))}</b>`;

  await ctx.api.editMessageText(ctx.chat!.id, editMessageId, text, {
    parse_mode: 'HTML',
    reply_markup: kbTaskDetail(task.numId, task.status, mode, page),
  });
}

bot.command('start', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;

  const user = await upsertUserFromCtx(ctx);

  await ctx.reply(
    `Привет, ${escapeHtml(fmtUser(user))}! ✨\n\n` +
      `Я <b>Orbit</b> 🪐 — ваш милый TODO-бот.\n\n` +
      `Открой панель: /my\n` +
      `Быстро добавить: <code>/add купить молоко</code>\n\n` +
      `Но удобнее — через кнопку <b>➕ Добавить</b> в панели 👇`,
    { parse_mode: 'HTML' },
  );

  await showList(ctx, 'my', 0);
});

bot.command('help', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;
  await ctx.reply(
    `🪐 Orbit · help\n\n` +
      `📌 Команды:\n` +
      `/add <text> — создать задачу себе\n` +
      `/add @username <text> — создать задачу другому (нужно, чтобы он/она сделал(а) /start)\n` +
      `/my — мои открытые\n` +
      `/all — все открытые\n` +
      `/done — выполненные\n` +
      `/cancel — отменить ввод (например редактирование)`,
  );
});

bot.command('cancel', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;
  const me = await upsertUserFromCtx(ctx);
  await prisma.pendingAction.deleteMany({ where: { userId: me.id } });
  await ctx.reply('Ок, отменил ✅🪐');
});

bot.command('add', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;

  const me = await upsertUserFromCtx(ctx);
  const text = (ctx.match as string | undefined)?.trim() ?? '';
  if (!text) {
    await ctx.reply('Напиши так: <code>/add купить молоко</code> или <code>/add @username купить молоко</code>', { parse_mode: 'HTML' });
    return;
  }

  const m = text.match(/^@([A-Za-z0-9_]{5,})\s+(.+)$/);
  let assignedTo = me;
  let title = text;

  if (m) {
    const username = m[1];
    title = m[2];

    const other = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
    });

    if (!other) {
      await prisma.invite.upsert({
        where: { username },
        update: { invitedById: me.id },
        create: { username, invitedById: me.id },
      });
      await ctx.reply(`Я ещё не знаком с @${username} 🙃\nПусть он/она откроет этого бота и отправит /start — и всё заработает.`);
      return;
    }

    assignedTo = other;
  }

  const task = await prisma.task.create({
    data: {
      title,
      createdById: me.id,
      assignedToId: assignedTo.id,
    },
    include: { assignedTo: true },
  });

  await ctx.reply(`✅ Создал задачу!\n\n${fmtTaskLine(task)}`);
  await showList(ctx, 'my', 0);
});

// Text input handler for pending actions (e.g., editing task title)
bot.on('message:text', async (ctx, next) => {
  if (!mustBePrivateChat(ctx)) return;

  const from = ctx.from;
  if (!from) return;

  const text = ctx.message.text.trim();
  if (!text) return;

  // let commands pass through
  if (text.startsWith('/')) {
    await next();
    return;
  }

  const me = await upsertUserFromCtx(ctx);
  const pending = await prisma.pendingAction.findFirst({
    where: { userId: me.id },
    orderBy: { createdAt: 'desc' },
  });

  if (!pending) {
    // UX: allow adding a task by simply sending a text message (without pressing ➕)
    // Ask for confirmation to avoid accidental task creation from random chat messages
    const titleDraft = text.slice(0, 200);

    await prisma.pendingAction.deleteMany({ where: { userId: me.id } });
    await prisma.pendingAction.create({
      data: {
        kind: PendingActionKind.addTaskDraft,
        userId: me.id,
        draftTitle: titleDraft,
      },
    });

    const kb = new InlineKeyboard()
      .text('✅ Добавить', 'v:addDraft:confirm')
      .text('❌ Не добавлять', 'v:addDraft:cancel');

    await ctx.reply(`Добавить задачу?\n\n📝 ${escapeHtml(titleDraft)}`, {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
    return;
  }

  if (pending.kind === PendingActionKind.editTitle && pending.taskId) {
    const newTitle = text.slice(0, 200);

    const task = await prisma.task.findUnique({ where: { id: pending.taskId }, include: { assignedTo: true } });
    if (!task) {
      await prisma.pendingAction.deleteMany({ where: { userId: me.id } });
      await ctx.reply('Задача уже не существует 🙃');
      return;
    }

    await prisma.task.update({ where: { id: pending.taskId }, data: { title: newTitle } });
    await prisma.pendingAction.deleteMany({ where: { userId: me.id } });

    await ctx.reply(`✏️ Обновил задачу:\n\n${fmtTaskLine({ ...task, title: newTitle })}`);

    const mode = (pending.panelMode as PendingMode | null) ?? 'my';
    const page = pending.panelPage ?? 0;
    const panelMessageId = pending.panelMessageId ?? undefined;
    await showList(ctx, mode, page, panelMessageId);
    return;
  }

  if (pending.kind === PendingActionKind.addTask) {
    const title = text.slice(0, 200);

    await prisma.task.create({
      data: {
        title,
        createdById: me.id,
        assignedToId: me.id,
      },
    });

    await prisma.pendingAction.deleteMany({ where: { userId: me.id } });

    const mode = (pending.panelMode as PendingMode | null) ?? 'my';
    const page = pending.panelPage ?? 0;
    const panelMessageId = pending.panelMessageId ?? undefined;
    await showList(ctx, mode, page, panelMessageId);
    return;
  }

  if (pending.kind === PendingActionKind.addTaskDraft) {
    // If user sends another message while draft is pending, treat it as updating the draft
    const titleDraft = text.slice(0, 200);

    await prisma.pendingAction.update({
      where: { id: pending.id },
      data: { draftTitle: titleDraft },
    });

    const kb = new InlineKeyboard()
      .text('✅ Добавить', 'v:addDraft:confirm')
      .text('❌ Не добавлять', 'v:addDraft:cancel');

    await ctx.reply(`Добавить задачу?\n\n📝 ${escapeHtml(titleDraft)}`, {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
    return;
  }

  await next();
});

bot.command('my', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;
  await showList(ctx, 'my', 0);
});

bot.command('all', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;
  await showList(ctx, 'all', 0);
});

bot.command('done', async (ctx) => {
  if (!mustBePrivateChat(ctx)) return;
  await showList(ctx, 'done', 0);
});

// --- View navigation ---
bot.callbackQuery(/^v:list:(my|all|done):(\d+)$/, async (ctx) => {
  (ctx as any)._matchedCallbackHandled = true;
  const mode = ctx.match[1] as ListMode;
  const page = Number(ctx.match[2]);
  const messageId = ctx.callbackQuery.message?.message_id;
  if (!messageId) return;
  await ctx.answerCallbackQuery();
  await showList(ctx, mode, page, messageId);
});

bot.callbackQuery(/^v:add:(my|all|done):(\d+)$/, async (ctx) => {
  (ctx as any)._matchedCallbackHandled = true;
  try {
    await ctx.answerCallbackQuery();
  } catch {}

  const mode = ctx.match[1] as ListMode;
  const page = Number(ctx.match[2]);
  const messageId = ctx.callbackQuery.message?.message_id;
  if (!messageId) return;

  const me = await upsertUserFromCtx(ctx);
  await prisma.pendingAction.deleteMany({ where: { userId: me.id } });
  await prisma.pendingAction.create({
    data: {
      kind: PendingActionKind.addTask,
      userId: me.id,
      panelMode: mode,
      panelPage: page,
      panelMessageId: messageId,
    },
  });

  const kb = new InlineKeyboard().text('❌ Отмена', 'v:cancel');

  await ctx.api.editMessageText(ctx.chat!.id, messageId, '✍️ Напиши текст задачи одним сообщением.', {
    parse_mode: 'HTML',
    reply_markup: kb,
  });
});

bot.callbackQuery(/^v:cancel$/, async (ctx) => {
  (ctx as any)._matchedCallbackHandled = true;
  try {
    await ctx.answerCallbackQuery();
  } catch {}

  const messageId = ctx.callbackQuery.message?.message_id;
  if (!messageId) return;

  const me = await upsertUserFromCtx(ctx);
  const pending = await prisma.pendingAction.findFirst({ where: { userId: me.id }, orderBy: { createdAt: 'desc' } });
  await prisma.pendingAction.deleteMany({ where: { userId: me.id } });

  const mode = (pending?.panelMode as PendingMode | null) ?? 'my';
  const page = pending?.panelPage ?? 0;
  await showList(ctx, mode, page, messageId);
});

// --- Quick add draft (message → confirm) ---
bot.callbackQuery(/^v:addDraft:(confirm|cancel)$/, async (ctx) => {
  (ctx as any)._matchedCallbackHandled = true;
  try {
    await ctx.answerCallbackQuery();
  } catch {}

  const action = ctx.match[1] as 'confirm' | 'cancel';
  const me = await upsertUserFromCtx(ctx);

  const pending = await prisma.pendingAction.findFirst({
    where: { userId: me.id, kind: PendingActionKind.addTaskDraft },
    orderBy: { createdAt: 'desc' },
  });

  if (!pending) {
    await ctx.reply('Черновик задачи не найден 🙃');
    return;
  }

  if (action === 'cancel') {
    await prisma.pendingAction.delete({ where: { id: pending.id } });
    await ctx.reply('Ок, не добавляю ✅');
    return;
  }

  const title = (pending as any).draftTitle?.trim();
  if (!title) {
    await prisma.pendingAction.delete({ where: { id: pending.id } });
    await ctx.reply('Пустой черновик, нечего добавлять 🙃');
    return;
  }

  const task = await prisma.task.create({
    data: {
      title: title.slice(0, 200),
      createdById: me.id,
      assignedToId: me.id,
    },
    include: { assignedTo: true },
  });

  await prisma.pendingAction.delete({ where: { id: pending.id } });

  await ctx.reply(`✅ Создал задачу!\n\n${fmtTaskLine(task)}`);
  await showList(ctx, 'my', 0);
});

bot.callbackQuery(/^v:task:(\d+):(my|all|done):(\d+)$/, async (ctx) => {
  (ctx as any)._matchedCallbackHandled = true;
  const taskNumId = Number(ctx.match[1]);
  const mode = ctx.match[2] as ListMode;
  const page = Number(ctx.match[3]);
  const messageId = ctx.callbackQuery.message?.message_id;
  if (!messageId) return;

  try {
    await ctx.answerCallbackQuery();
  } catch {}

  try {
    await showTaskDetail(ctx, taskNumId, mode, page, messageId);
  } catch (e) {
    console.error('showTaskDetail failed', { taskNumId, mode, page, e });
    try {
      await ctx.answerCallbackQuery({ text: 'Не получилось открыть задачу 😕 Попробуй 🔄 Обновить' });
    } catch {}
    await showList(ctx, mode, page, messageId);
  }
});

bot.callbackQuery('noop', async (ctx) => {
  (ctx as any)._matchedCallbackHandled = true;
  await ctx.answerCallbackQuery();
});

// Debug/fallback: log any callback data that wasn't matched above
bot.on('callback_query:data', async (ctx, next) => {
  console.log('callback_query:data', ctx.callbackQuery.data);
  await next();
});

bot.use(async (ctx, next) => {
  // catch-all for unmatched callback queries (helps UX)
  if (ctx.callbackQuery?.data) {
    const before = (ctx as any)._matchedCallbackHandled;
    await next();
    const after = (ctx as any)._matchedCallbackHandled;
    if (!before && !after) {
      try {
        await ctx.answerCallbackQuery({ text: 'Не понял кнопку 🙃 Обнови список: 🔄 Обновить' });
      } catch {
        // ignore
      }
    }
    return;
  }
  await next();
});

// --- Task actions (from detail view) ---

bot.callbackQuery(/^t:delask:(\d+):(my|all|done):(\d+)$/, async (ctx) => {
  (ctx as any)._matchedCallbackHandled = true;

  try {
    await ctx.answerCallbackQuery();
  } catch {}

  const taskNumId = Number(ctx.match[1]);
  const mode = ctx.match[2] as ListMode;
  const page = Number(ctx.match[3]);
  const messageId = ctx.callbackQuery.message?.message_id;
  if (!messageId) return;

  const kb = new InlineKeyboard()
    .text('✅ Да, удалить', `t:delyes:${taskNumId}:${mode}:${page}`)
    .row()
    .text('❌ Отмена', `v:task:${taskNumId}:${mode}:${page}`);

  await ctx.api.editMessageText(ctx.chat!.id, messageId, '🗑 Удалить задачу? Это действие нельзя отменить.', {
    parse_mode: 'HTML',
    reply_markup: kb,
  });
});

bot.callbackQuery(/^t:delyes:(\d+):(my|all|done):(\d+)$/, async (ctx) => {
  (ctx as any)._matchedCallbackHandled = true;

  try {
    await ctx.answerCallbackQuery({ text: 'Удаляю…' });
  } catch {}

  const taskNumId = Number(ctx.match[1]);
  const mode = ctx.match[2] as ListMode;
  const page = Number(ctx.match[3]);
  const messageId = ctx.callbackQuery.message?.message_id;
  if (!messageId) return;

  await prisma.task.delete({ where: { numId: taskNumId } });
  await showList(ctx, mode, page, messageId);
});

bot.callbackQuery(/^t:edit:(\d+):(my|all|done):(\d+)$/, async (ctx) => {
  (ctx as any)._matchedCallbackHandled = true;

  // answer early
  try {
    await ctx.answerCallbackQuery();
  } catch {}

  const taskNumId = Number(ctx.match[1]);
  const mode = ctx.match[2] as ListMode;
  const page = Number(ctx.match[3]);
  const messageId = ctx.callbackQuery.message?.message_id;
  if (!messageId) return;

  const me = await upsertUserFromCtx(ctx);
  const task = await prisma.task.findUnique({ where: { numId: taskNumId } });
  if (!task) {
    await showList(ctx, mode, page, messageId);
    return;
  }
  // Access checks disabled for now (2-person bot). We'll add roles/permissions later.

  await prisma.pendingAction.deleteMany({ where: { userId: me.id } });
  await prisma.pendingAction.create({
    data: {
      kind: PendingActionKind.editTitle,
      userId: me.id,
      taskId: task.id,
    },
  });

  await ctx.reply(
    `✏️ Ок! Пришли новым сообщением <b>новый текст задачи</b>.\n\n` +
      `Отмена: /cancel`,
    { parse_mode: 'HTML' },
  );
});

bot.callbackQuery(/^t:(done|reopen):(\d+):(my|all|done):(\d+)$/, async (ctx) => {
  (ctx as any)._matchedCallbackHandled = true;

  // answer early
  try {
    await ctx.answerCallbackQuery();
  } catch {
    // ignore
  }

  const action = ctx.match[1] as 'done' | 'reopen';
  const taskNumId = Number(ctx.match[2]);
  const mode = ctx.match[3] as ListMode;
  const page = Number(ctx.match[4]);
  const messageId = ctx.callbackQuery.message?.message_id;
  if (!messageId) return;

  const me = await upsertUserFromCtx(ctx);
  const task = await prisma.task.findUnique({ where: { numId: taskNumId }, include: { assignedTo: true, createdBy: true } });
  if (!task) {
    await showList(ctx, mode, page, messageId);
    return;
  }

  // Access checks disabled for now (2-person bot). We'll add roles/permissions later.


  const updated = await prisma.task.update({
    where: { numId: taskNumId },
    data: {
      status: action === 'done' ? 'done' : 'open',
      doneAt: action === 'done' ? new Date() : null,
    },
    include: { assignedTo: true, createdBy: true },
  });

  await showTaskDetail(ctx, updated.numId, mode, page, messageId);
});

bot.callbackQuery(/^t:assign:(\d+):(my|all|done):(\d+)$/, async (ctx) => {
  (ctx as any)._matchedCallbackHandled = true;

  // Answer immediately to avoid Telegram callback timeout
  try {
    await ctx.answerCallbackQuery();
  } catch {
    // ignore
  }

  const taskNumId = Number(ctx.match[1]);
  const mode = ctx.match[2] as ListMode;
  const page = Number(ctx.match[3]);
  const messageId = ctx.callbackQuery.message?.message_id;
  if (!messageId) return;

  const me = await upsertUserFromCtx(ctx);
  const task = await prisma.task.findUnique({ where: { numId: taskNumId } });
  if (!task) {
    await showList(ctx, mode, page, messageId);
    return;
  }
  // Access checks disabled for now (2-person bot). We'll add roles/permissions later.

  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  const kb = new InlineKeyboard();
  for (const u of users) {
    kb.text(fmtUser(u), `t:assignTo:${taskNumId}:${u.numId}:${mode}:${page}`).row();
  }
  kb.text('⬅️ Назад', `v:task:${taskNumId}:${mode}:${page}`);

  try {
    await ctx.api.editMessageText(ctx.chat!.id, messageId, 'Кому назначить? 👇', { reply_markup: kb });
  } catch (e) {
    console.error('editMessageText(assign) failed, fallback to reply()', e);
    await ctx.reply('Кому назначить? 👇', { reply_markup: kb });
  }
});

bot.callbackQuery(/^t:assignTo:(\d+):(\d+):(my|all|done):(\d+)$/, async (ctx) => {
  (ctx as any)._matchedCallbackHandled = true;

  // Answer immediately to avoid Telegram callback timeout
  try {
    await ctx.answerCallbackQuery({ text: 'Назначаю…' });
  } catch {
    // ignore
  }

  const taskNumId = Number(ctx.match[1]);
  const toUserNumId = Number(ctx.match[2]);
  const mode = ctx.match[3] as ListMode;
  const page = Number(ctx.match[4]);
  const messageId = ctx.callbackQuery.message?.message_id;
  if (!messageId) return;

  const me = await upsertUserFromCtx(ctx);
  const task = await prisma.task.findUnique({ where: { numId: taskNumId } });
  if (!task) {
    await showList(ctx, mode, page, messageId);
    return;
  }
  // Access checks disabled for now (2-person bot). We'll add roles/permissions later.

  const toUser = await prisma.user.findUnique({ where: { numId: toUserNumId } });
  if (!toUser) {
    await showTaskDetail(ctx, taskNumId, mode, page, messageId);
    return;
  }

  const updated = await prisma.task.update({
    where: { numId: taskNumId },
    data: { assignedToId: toUser.id },
    include: { assignedTo: true, createdBy: true },
  });

  // Render the updated task screen
  await showTaskDetail(ctx, updated.numId, mode, page, messageId);
});

bot.catch((err) => {
  console.error('Bot error', err.error);
});

// Note: bot.start() (long polling) is disabled for Render/webhook deployments.
// Webhook server is implemented in src/server.ts and calls bot.handleUpdate().
export async function diagnostics() {
  console.log('Orbit bot handlers loaded');
  console.log('DATABASE_URL:', process.env.DATABASE_URL);
  try {
    await prisma.user.count();
    console.log('DB check: OK');
  } catch (e) {
    console.error('DB check: FAILED', e);
  }
}
