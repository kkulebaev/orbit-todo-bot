import 'dotenv/config';
import { Bot, Context, InlineKeyboard } from 'grammy';
import { PendingActionKind, PrismaClient, TaskStatus, User } from '@prisma/client';

const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN in env');
if (!DATABASE_URL) throw new Error('Missing DATABASE_URL in env');

const prisma = new PrismaClient();
const bot = new Bot(BOT_TOKEN);

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
  const statusEmoji = t.status === 'done' ? '✅' : '🟦';
  return `${statusEmoji} ${t.title}\n👤 ${fmtUser(t.assignedTo)}`;
}

type ListMode = 'my' | 'all' | 'done';
const PAGE_SIZE = 8;

async function getTasksForMode(mode: ListMode, viewer: User, page: number) {
  const where: any = {};
  if (mode === 'done') where.status = 'done';
  else where.status = 'open';

  if (mode === 'my') where.assignedToId = viewer.id;

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
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
    const emoji = t.status === 'done' ? '✅' : '🟦';
    kb.text(`${emoji} ${n}`, `v:task:${t.numId}:${mode}:${page}`);
    if ((idx + 1) % 4 === 0) kb.row();
  });
  kb.row();

  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const prevEnabled = page > 0;
  const nextEnabled = page < maxPage;

  kb.text(prevEnabled ? '⬅️ Prev' : '·', prevEnabled ? `v:list:${mode}:${page - 1}` : 'noop');
  kb.text('🔄 Refresh', `v:list:${mode}:${page}`);
  kb.text(nextEnabled ? 'Next ➡️' : '·', nextEnabled ? `v:list:${mode}:${page + 1}` : 'noop');
  kb.row();

  kb.text(mode === 'my' ? '👤 My ✅' : '👤 My', `v:list:my:0`);
  kb.text(mode === 'all' ? '👥 All ✅' : '👥 All', `v:list:all:0`);
  kb.text(mode === 'done' ? '🏁 Done ✅' : '🏁 Done', `v:list:done:0`);

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
        const statusEmoji = t.status === 'done' ? '✅' : '🟦';
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
  if (status === 'open') kb.text('✅ Done', `t:done:${taskNumId}:${mode}:${page}`);
  else kb.text('🔁 Reopen', `t:reopen:${taskNumId}:${mode}:${page}`);
  kb.text('👤 Assign', `t:assign:${taskNumId}:${mode}:${page}`);
  kb.text('📝 Edit', `t:edit:${taskNumId}:${mode}:${page}`);
  kb.row();
  kb.text('🗑 Delete', `t:del:${taskNumId}:${mode}:${page}`);
  kb.text('⬅️ Back', `v:list:${mode}:${page}`);
  return kb;
}

async function showTaskDetail(ctx: Context, taskNumId: number, mode: ListMode, page: number, editMessageId: number) {
  const viewer = await upsertUserFromCtx(ctx);
  const task = await prisma.task.findUnique({
    where: { numId: taskNumId },
    include: { assignedTo: true, createdBy: true },
  });

  if (!task) {
    await ctx.answerCallbackQuery({ text: 'Задача не найдена 🙃' });
    await showList(ctx, mode, page, editMessageId);
    return;
  }

  if (task.createdById !== viewer.id && task.assignedToId !== viewer.id) {
    await ctx.answerCallbackQuery({ text: 'Нет доступа' });
    return;
  }

  const statusLine = task.status === 'done' ? '✅ Выполнено' : '🟦 В работе';
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
      `Быстрый старт:\n` +
      `• Добавить: <code>/add купить молоко</code>\n` +
      `• Назначить Даше: <code>/add @kulebaevadaria_nv купить молоко</code>\n` +
      `• Открыть панель: /my\n\n` +
      `Дальше всё через кнопки 👇`,
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
    await next();
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

    await ctx.reply(`✏️ Обновил задачу: \n\n${fmtTaskLine({ ...task, title: newTitle })}`);
    await showList(ctx, 'my', 0);
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

bot.callbackQuery(/^v:task:(\d+):(my|all|done):(\d+)$/, async (ctx) => {
  (ctx as any)._matchedCallbackHandled = true;
  const taskNumId = Number(ctx.match[1]);
  const mode = ctx.match[2] as ListMode;
  const page = Number(ctx.match[3]);
  const messageId = ctx.callbackQuery.message?.message_id;
  if (!messageId) return;
  await ctx.answerCallbackQuery();
  await showTaskDetail(ctx, taskNumId, mode, page, messageId);
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
        await ctx.answerCallbackQuery({ text: 'Не понял кнопку 🙃 Обнови список: 🔄 Refresh' });
      } catch {
        // ignore
      }
    }
    return;
  }
  await next();
});

// --- Task actions (from detail view) ---

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
  if (task.createdById !== me.id && task.assignedToId !== me.id) {
    return;
  }

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

bot.callbackQuery(/^t:(done|reopen|del):(\d+):(my|all|done):(\d+)$/, async (ctx) => {
  (ctx as any)._matchedCallbackHandled = true;

  // answer early
  try {
    await ctx.answerCallbackQuery();
  } catch {
    // ignore
  }

  const action = ctx.match[1] as 'done' | 'reopen' | 'del';
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

  if (task.createdById !== me.id && task.assignedToId !== me.id) {
    return;
  }

  if (action === 'del') {
    await prisma.task.delete({ where: { numId: taskNumId } });
    await showList(ctx, mode, page, messageId);
    return;
  }

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
  if (task.createdById !== me.id && task.assignedToId !== me.id) {
    return;
  }

  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  const kb = new InlineKeyboard();
  for (const u of users) {
    kb.text(fmtUser(u), `t:assignTo:${taskNumId}:${u.numId}:${mode}:${page}`).row();
  }
  kb.text('⬅️ Back', `v:task:${taskNumId}:${mode}:${page}`);

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
  if (task.createdById !== me.id && task.assignedToId !== me.id) {
    return;
  }

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

bot.start({
  onStart: async () => {
    console.log('TODO bot started');
    console.log('DATABASE_URL:', process.env.DATABASE_URL);
    try {
      await prisma.user.count();
      console.log('DB check: OK');
    } catch (e) {
      console.error('DB check: FAILED', e);
    }
  },
});
